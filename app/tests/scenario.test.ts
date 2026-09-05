/**
 * 시나리오 — 루프 전체를 날짜로 돌려본다
 *
 * 단위 테스트가 부품을 보증한다면, 여기서는 "등록 → 알림 → 응답 → 재설정"이
 * 몇 달에 걸쳐 실제로 맞물려 도는지를 본다.
 *
 * 이 파일이 Phase 3 이식의 최종 판정 기준이다 — Swift·Kotlin이 같은 입력에
 * 같은 알림 순서를 내면 이식이 끝난 것이다.
 */
import { describe, it, expect } from 'vitest';
import { addDays, diffDays } from '../src/core/date';
import { applyReplaced, applyStillGood, createItem, daysRemaining } from '../src/core/cycle';
import { buildDailyDigest, markDigestSent, markStageSent } from '../src/core/notify';
import { applySeasonPause, applySeasonResume, seasonAction } from '../src/core/season';
import { onboardingPicks } from '../src/core/catalog';
import { suggestCycle } from '../src/core/selfCorrect';
import { DEFAULT_SETTINGS, type Item, type ItemEvent, type UserSettings } from '../src/core/types';
import { buildCatalogIndex } from '../src/core/catalog';
import rawCatalog from '../src/data/catalog.json';
import type { CatalogItem } from '../src/core/types';
import { event } from './helpers';

const CATALOG = buildCatalogIndex(rawCatalog.items as CatalogItem[]);
const START = '2026-09-05';

interface World {
  items: Item[];
  events: ItemEvent[];
  settings: UserSettings;
  log: Array<{ on: string; kind: string; title: string; body: string }>;
}

function register(codes: string[], on = START): World {
  const items = codes.map((code, i) => {
    const catalog = CATALOG.byCode.get(code);
    if (!catalog) throw new Error(`카탈로그에 ${code}가 없어요`);
    return createItem({
      id: `i${i}`,
      catalog,
      baseDate: on,
      now: `${on}T00:00:00.000Z`,
    });
  });
  return { items, events: [], settings: { ...DEFAULT_SETTINGS }, log: [] };
}

/**
 * 하루를 산다. `respond`가 그날 알림에 어떻게 답할지 정한다.
 * null을 돌려주면 무응답이다.
 */
function liveOneDay(
  world: World,
  today: string,
  respond: (kind: string) => 'replaced' | 'still_good' | 'season_yes' | null,
): void {
  // 시즌이 끝난 품목을 멈춘다 — 앱이 열릴 때마다 하는 정리
  world.items = world.items.map((i) =>
    seasonAction(i, today) === 'pause' ? applySeasonPause(i, today) : i,
  );

  const digest = buildDailyDigest({
    items: world.items,
    settings: world.settings,
    today,
    joinedOn: START,
  });
  if (!digest) return;

  world.log.push({ on: today, kind: digest.kind, title: digest.title, body: digest.body });
  world.settings = markDigestSent(world.settings, today);

  // 보낸 단계를 기록해 같은 단계가 두 번 가지 않게 한다
  if (digest.stage) {
    const stage = digest.stage;
    world.items = world.items.map((i) =>
      digest.itemIds.includes(i.id) ? markStageSent(i, stage) : i,
    );
  }

  const answer = respond(digest.kind);
  if (!answer) return;

  world.items = world.items.map((item) => {
    if (!digest.itemIds.includes(item.id)) return item;
    if (answer === 'replaced') {
      world.events.push(event(item.id, 'replaced', today));
      return applyReplaced(item, today);
    }
    if (answer === 'still_good') {
      world.events.push(event(item.id, 'still_good', today));
      return applyStillGood(item, today);
    }
    world.events.push(event(item.id, 'season_start', today));
    return applySeasonResume(item, today);
  });
}

function live(world: World, days: number, respond: (kind: string) => 'replaced' | 'still_good' | 'season_yes' | null): World {
  for (let d = 0; d < days; d++) {
    liveOneDay(world, addDays(START, d), respond);
  }
  return world;
}

describe('첫 알림까지', () => {
  it('온보딩 기본 선택으로 등록하면 2주 안에 첫 알림이 온다 — 치명적 리스크의 방어선', () => {
    const picks = onboardingPicks(CATALOG, ['욕실', '주방', '침실']);
    const world = register(picks.map((p) => p.code));

    live(world, 14, () => null);

    expect(world.log.length).toBeGreaterThan(0);
    const first = world.log[0];
    expect(diffDays(START, first.on)).toBeLessThanOrEqual(14);
  });

  it('긴 주기만 등록하면 첫 알림이 멀다 — 그래서 온보딩이 짧은 주기를 기본 체크한다', () => {
    // 매트리스(7~10년) 하나만. 미리 알림(D-7)조차 몇 년 뒤다.
    const world = register(['bed_mattress']);
    live(world, 30, () => null);
    // 등록 유도 알림만 오고, 교체 알림은 오지 않는다
    expect(world.log.every((l) => l.kind === 'add_more')).toBe(true);
  });
});

describe('네 단계 루프', () => {
  it('등록 → 알림 → 바꿨어요 → 기준일 재설정이 몇 주기를 돌아도 어긋나지 않는다', () => {
    const world = register(['kit_sponge']); // 수세미 30일
    live(world, 100, (kind) => (kind === 'due_single' ? 'replaced' : null));

    const dues = world.log.filter((l) => l.kind === 'due_single');
    expect(dues.length).toBe(3); // 30 · 60 · 90일째
    expect(dues.map((d) => d.on)).toEqual(['2026-10-05', '2026-11-04', '2026-12-04']);
    expect(dues[0].title).toBe('수세미 바꿀 때예요');

    // 마지막 교체 이후 다시 30일을 세고 있다
    expect(world.items[0].baseDate).toBe('2026-12-04');
    expect(daysRemaining(world.items[0], '2026-12-13')).toBe(21);
  });

  it('하루에 한 건만 간다 — 여러 품목이 걸려도 알림은 하나', () => {
    const world = register(['kit_sponge', 'kit_dishcloth', 'kit_gloves']); // 셋 다 30일
    live(world, 40, () => null);

    const onDue = world.log.filter((l) => l.on === '2026-10-05');
    expect(onDue).toHaveLength(1);
    expect(onDue[0].kind).toBe('due_bundle');
    expect(onDue[0].title).toBe('오늘 바꿀 것 3개');
  });

  it('무응답이면 D+3, D+10에 한 번씩만 다시 묻고 그 뒤로는 조용하다', () => {
    const world = register(['kit_sponge']);
    live(world, 60, () => null);

    const kinds = world.log.filter((l) => l.kind !== 'add_more');
    expect(kinds.map((l) => `${l.on} ${l.kind}`)).toEqual([
      '2026-09-28 pre', // 30일 주기는 1개월 이상이라 미리 알림을 받는다
      '2026-10-05 due_single',
      '2026-10-08 followup',
      '2026-10-15 followup',
    ]);
  });
});

describe('아직 멀쩡해요', () => {
  it('누를 때마다 주기의 30%씩 미뤄지고, 기준일은 그대로다', () => {
    const world = register(['kit_sponge']);
    live(world, 60, (kind) => (kind === 'followup' ? 'still_good' : null));

    const item = world.items[0];
    expect(item.baseDate).toBe(START); // 기준일 불변
    expect(item.deferDays).toBeGreaterThanOrEqual(9);
  });

  it('세 번 누적되면 주기 자체를 늘릴지 제안한다', () => {
    const world = register(['kit_sponge']);
    live(world, 200, (kind) => (kind === 'followup' ? 'still_good' : null));

    const suggestion = suggestCycle(world.items[0], world.events);
    expect(suggestion).not.toBeNull();
    expect(suggestion!.reason).toBe('still_good');
    expect(suggestion!.suggestedCycleDays).toBeGreaterThan(30);
  });
});

describe('자기교정', () => {
  /** 교체를 n번 기록한 상태를 만든다. 간격 3개를 얻으려면 4번이 필요하다. */
  const afterReplacements = (code: string, gap: number, times: number) => {
    const catalog = CATALOG.byCode.get(code)!;
    let item = createItem({ id: 'x', catalog, baseDate: START, now: `${START}T00:00:00Z` });
    const events: ItemEvent[] = [];
    let on = START;
    for (let i = 0; i < times; i++) {
      on = addDays(on, gap);
      events.push(event('x', 'replaced', on));
      item = applyReplaced(item, on);
    }
    return { item, events, catalog };
  };

  it('실제로 늦게 바꾸는 사람에게는 그 사람의 주기를 제안한다', () => {
    // 칫솔 90일인데 매번 135일에 바꾸는 사람
    const { item, events } = afterReplacements('bath_toothbrush', 135, 4);

    const suggestion = suggestCycle(item, events);
    expect(suggestion).not.toBeNull();
    expect(suggestion!.currentCycleDays).toBe(90);
    expect(suggestion!.suggestedCycleDays).toBe(135);
  });

  it('교체 기록이 세 번뿐이면 아직 제안하지 않는다 — 간격이 두 개라 근거가 얕다', () => {
    const { item, events } = afterReplacements('bath_toothbrush', 135, 3);
    expect(suggestCycle(item, events)).toBeNull();
  });

  it('안전 품목은 아무리 늦게 바꿔도 주기를 건드리지 않는다', () => {
    const { item, events, catalog } = afterReplacements('saf_smoke_battery', 730, 4);
    expect(catalog.safety_locked).toBe(true);
    expect(suggestCycle(item, events)).toBeNull();
    expect(item.cycleDays).toBe(catalog.cycle_days);
  });
});

describe('계절 품목', () => {
  it('겨울에 선풍기 알림이 뜨지 않는다 — 뜨는 순간 신뢰가 끝난다', () => {
    const world = register(['liv_fan_clean']); // 선풍기 청소, 여름
    // 9월 5일부터 1년. 10월에 시즌이 끝나고 이듬해 5월에 다시 열린다.
    live(world, 365, () => null);

    const winterAlerts = world.log.filter((l) => {
      const month = Number(l.on.slice(5, 7));
      return (month >= 10 || month <= 4) && l.kind !== 'add_more';
    });
    expect(winterAlerts).toEqual([]);
  });

  it('시즌이 열리면 한 번 묻고, 답한 날이 새 기준일이 된다', () => {
    const world = register(['liv_fan_clean']);
    live(world, 300, (kind) => (kind === 'season_start' ? 'season_yes' : null));

    const asked = world.log.find((l) => l.kind === 'season_start');
    expect(asked).toBeDefined();
    expect(asked!.title).toBe('선풍기 청소 꺼내셨어요?');
    expect(Number(asked!.on.slice(5, 7))).toBe(5); // 5월에 시즌이 열린다
    expect(world.items[0].baseDate).toBe(asked!.on);
    expect(world.items[0].status).toBe('active');
  });
});

describe('밀린 항목 폭탄', () => {
  it('한참 방치하면 목록 대신 정리 제안 하나로 접힌다', () => {
    const world = register([
      'kit_sponge',
      'kit_dishcloth',
      'kit_gloves',
      'bed_sheet_wash',
      'bed_pillowcase_wash',
      'bath_razor',
      'lau_washer_clean',
    ]);
    live(world, 120, () => null);

    const last = world.log[world.log.length - 1];
    expect(last.kind).toBe('overdue_many');
    expect(last.body).toBe('한 번에 정리해드릴까요?');
    // 붉은 항목을 하나하나 세어 보여주지 않는다
    expect(last.title).toMatch(/^밀린 게 \d+개 있어요$/);
  });
});

describe('휴면', () => {
  it('쉬는 동안에는 아무 알림도 가지 않는다', () => {
    const world = register(['kit_sponge']);
    world.settings = { ...world.settings, dormantFrom: START, dormantUntil: addDays(START, 45) };
    live(world, 45, () => null);
    expect(world.log).toEqual([]);
  });
});
