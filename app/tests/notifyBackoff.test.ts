/**
 * 알림이 무한히 반복되던 경로들에 대한 회귀 테스트.
 *
 * 여기 있는 케이스는 전부 한 번 실제로 일어났던 동작이다. 고친 코드가
 * 맞는지보다, 예전 동작으로 되돌아가지 않는지를 지키는 것이 목적이다.
 */
import { describe, expect, it } from 'vitest';

import {
  buildDailyDigest,
  markStageSent,
  OVERDUE_COLLAPSE,
  OVERDUE_NUDGE_INTERVAL_DAYS,
  type DigestContext,
} from '../src/core/notify';
import { addDays } from '../src/core/date';
import { cycleLabel, sinceLabel } from '../src/core/humanize';
import { applySeasonNotYet } from '../src/core/season';
import { IGNORE_ASK_THRESHOLD } from '../src/core/cycle';
import { DEFAULT_SETTINGS, type Item, type UserSettings } from '../src/core/types';

const TODAY = '2026-06-15';

function item(over: Partial<Item> = {}): Item {
  return {
    id: over.id ?? 'i1',
    catalogCode: null,
    name: '칫솔',
    zone: '욕실',
    inputType: 'list',
    metric: 'time',
    season: 'all',
    safetyLocked: false,
    cycleDays: 90,
    cycleSource: 'catalog',
    cycleUsage: null,
    unit: null,
    baseDate: '2026-01-01',
    baseUsage: null,
    deferDays: 0,
    groupCount: 1,
    status: 'active',
    pauseReason: null,
    pausedAt: null,
    seasonAskedAt: null,
    ignoreStreak: 0,
    lastStage: null,
    lastStageDue: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...over,
  };
}

/** 예정일이 today로부터 offset일 뒤가 되도록 baseDate를 역산한다. */
function dueIn(offset: number, over: Partial<Item> = {}): Item {
  const base = item(over);
  return { ...base, baseDate: addDays(TODAY, offset - base.cycleDays - base.deferDays) };
}

function ctx(items: Item[], settings: Partial<UserSettings> = {}): DigestContext {
  return {
    items,
    settings: { ...DEFAULT_SETTINGS, ...settings },
    today: TODAY,
    joinedOn: '2026-01-01',
  };
}

describe('시즌 질문이 무응답에도 멈춘다', () => {
  const fan = item({
    id: 'fan',
    name: '선풍기',
    season: 'summer',
    status: 'paused',
    pauseReason: 'season',
    pausedAt: '2026-05-01',
  });

  it('시즌이 열리면 한 번 묻고, 물어봤다는 표시를 남긴다', () => {
    const d = buildDailyDigest(ctx([fan]));
    expect(d?.kind).toBe('season_start');
    // 이 필드가 없으면 seasonAskedAt이 찍히지 않아 내일도 같은 질문이 나간다.
    expect(d?.askedItemIds).toEqual(['fan']);
  });

  it('물어본 표시가 있으면 다음 날 다시 묻지 않는다', () => {
    const asked = applySeasonNotYet(fan, TODAY);
    const d = buildDailyDigest({ ...ctx([asked]), today: addDays(TODAY, 1) });
    expect(d?.kind).not.toBe('season_start');
  });

  it('시즌 질문이 대기 중이어도 다른 알림을 영원히 막지는 않는다', () => {
    const asked = applySeasonNotYet(fan, TODAY);
    const brush = dueIn(0, { id: 'brush' });
    const d = buildDailyDigest({ ...ctx([asked, brush]), today: addDays(TODAY, 1) });
    expect(d?.kind).toBe('due_single');
    expect(d?.itemIds).toEqual(['brush']);
  });
});

describe('밀림 정리 제안에 간격이 있다', () => {
  const overdue = Array.from({ length: OVERDUE_COLLAPSE + 2 }, (_, n) =>
    dueIn(-10, { id: `o${n}` }),
  );

  it('처음에는 보내고, 보냈다는 표시를 남긴다', () => {
    const d = buildDailyDigest(ctx(overdue));
    expect(d?.kind).toBe('overdue_many');
    expect(d?.marksOverdueNudge).toBe(true);
  });

  it('간격 안에는 다시 보내지 않는다', () => {
    const d = buildDailyDigest(ctx(overdue, { overdueNudgedOn: addDays(TODAY, -1) }));
    expect(d?.kind).not.toBe('overdue_many');
  });

  it('간격이 지나면 다시 보낸다', () => {
    const long = addDays(TODAY, -OVERDUE_NUDGE_INTERVAL_DAYS);
    const d = buildDailyDigest(ctx(overdue, { overdueNudgedOn: long }));
    expect(d?.kind).toBe('overdue_many');
  });

  it('간격 안이면 오늘 할 일 알림이 그 자리를 대신한다', () => {
    // 예전에는 이 분기가 무조건 return이라 밀린 게 많은 사람은
    // 오늘 바꿔야 할 품목의 알림을 한 건도 받지 못했다.
    const due = dueIn(0, { id: 'today', name: '수세미' });
    const d = buildDailyDigest(
      ctx([...overdue, due], { overdueNudgedOn: addDays(TODAY, -1) }),
    );
    expect(d?.kind).toBe('due_single');
    expect(d?.itemIds).toEqual(['today']);
  });
});

describe('재확인 묶음은 단계를 섞지 않는다', () => {
  it('final과 followup이 같이 걸리면 final만 묶는다', () => {
    const a = dueIn(-3, { id: 'a', name: '수세미' }); // followup
    const b = dueIn(-10, { id: 'b', name: '행주' }); // final
    const d = buildDailyDigest(ctx([a, b]));
    expect(d?.stage).toBe('final');
    // b에 followup을 찍으면 b는 내일 final로 한 번 더 나간다.
    expect(d?.itemIds).toEqual(['b']);
  });

  it('묶음에 찍힌 단계가 실제 그 품목의 단계와 같다', () => {
    const b = dueIn(-10, { id: 'b' });
    const d = buildDailyDigest(ctx([b]))!;
    const marked = markStageSent(b, d.stage!);
    // 같은 단계가 두 번 가지 않아야 한다.
    expect(buildDailyDigest(ctx([marked]))).toBeNull();
  });
});

describe('계속 무시당하면 한 번 물어본다', () => {
  /* 단계를 다 보낸 뒤에도 응답이 없는 상태. 실제로 무시가 쌓이는 모습이다 —
     보낼 단계가 남아 있으면 그 알림이 먼저 나가는 게 맞다. */
  function exhausted(over: Partial<Item> = {}): Item {
    const base = dueIn(-15, { ignoreStreak: IGNORE_ASK_THRESHOLD, ...over });
    return { ...base, lastStage: 'final', lastStageDue: addDays(TODAY, -15) };
  }

  it('무시가 임계치에 닿으면 keep_asking이 나간다', () => {
    const d = buildDailyDigest(ctx([exhausted({ id: 'x' })]));
    expect(d?.kind).toBe('keep_asking');
    expect(d?.actions.map((a) => a.id)).toContain('mute');
  });

  it('오늘 할 일보다는 뒤에 온다', () => {
    const due = dueIn(0, { id: 'due' });
    expect(buildDailyDigest(ctx([exhausted({ id: 'x' }), due]))?.kind).toBe('due_single');
  });

  it('무시가 임계치에 못 미치면 묻지 않는다', () => {
    const d = buildDailyDigest(
      ctx([exhausted({ id: 'x', ignoreStreak: IGNORE_ASK_THRESHOLD - 1 })]),
    );
    expect(d?.kind).not.toBe('keep_asking');
  });
});

describe('사람 말로 옮기는 부분', () => {
  it('하루 지난 것을 "매일 됐어요"라고 하지 않는다', () => {
    expect(sinceLabel('2026-06-14', TODAY)).toBe('하루 됐어요');
  });

  it('45일이 넘으면 주가 아니라 개월로 말한다', () => {
    // %7 검사가 먼저였을 때 91 → '13주', 364 → '52주'가 나왔다.
    expect(cycleLabel(91)).toBe('3개월');
    expect(cycleLabel(364)).toBe('12개월');
    // 45일 이하의 주 단위는 그대로다.
    expect(cycleLabel(14)).toBe('2주');
    expect(cycleLabel(21)).toBe('3주');
  });
});
