import { describe, it, expect } from 'vitest';
import {
  nextDueOf,
  daysRemaining,
  formatDday,
  stateOf,
  isOverdue,
  byDueDate,
  applyReplaced,
  applyStillGood,
  applySnoozed,
  applyIgnored,
  applyArchived,
  applyMuted,
  applyUnmuted,
  applyRenewed,
  withCycleDays,
  withBaseDate,
  createItem,
  disambiguateName,
  isFrequent,
  shouldAskKeepNotifying,
  STILL_GOOD_RATIO,
} from '../src/core/cycle';
import { makeItem, catalogItem, NOW } from './helpers';

describe('nextDueOf', () => {
  it('기준일 + 주기 + 연기일', () => {
    const item = makeItem({ baseDate: '2026-08-06', cycleDays: 30, deferDays: 0 });
    expect(nextDueOf(item)).toBe('2026-09-05');
    expect(nextDueOf({ ...item, deferDays: 9 })).toBe('2026-09-14');
  });
});

describe('daysRemaining / formatDday / stateOf', () => {
  const item = makeItem({ baseDate: '2026-08-06', cycleDays: 30 }); // 예정일 2026-09-05

  it('D-day 부호 규약 — 양수는 남음, 음수는 밀림', () => {
    expect(daysRemaining(item, '2026-08-29')).toBe(7);
    expect(daysRemaining(item, '2026-09-05')).toBe(0);
    expect(daysRemaining(item, '2026-09-12')).toBe(-7);
  });

  it('표기', () => {
    expect(formatDday(7)).toBe('D-7');
    expect(formatDday(0)).toBe('D-DAY');
    expect(formatDday(-7)).toBe('D+7');
  });

  it('상태 3색 — 여유 D-8 이상 · 임박 D-7~D-DAY · 밀림 D+1 이상', () => {
    expect(stateOf(item, '2026-08-28')).toBe('ok'); // D-8
    expect(stateOf(item, '2026-08-29')).toBe('soon'); // D-7
    expect(stateOf(item, '2026-09-05')).toBe('soon'); // D-DAY
    expect(stateOf(item, '2026-09-06')).toBe('overdue'); // D+1
  });

  it('멈춘 항목은 카운트가 얼어붙는다 — 겨울 내내 선풍기가 밀리지 않는다', () => {
    const paused = makeItem({
      baseDate: '2026-08-06',
      cycleDays: 30,
      status: 'paused',
      pauseReason: 'season',
      pausedAt: '2026-09-01',
    });
    expect(daysRemaining(paused, '2026-09-01')).toBe(4);
    expect(daysRemaining(paused, '2027-03-01')).toBe(4); // 반년이 흘러도 그대로
    expect(stateOf(paused, '2027-03-01')).toBe('paused');
    expect(isOverdue(paused, '2027-03-01')).toBe(false);
  });
});

describe('byDueDate', () => {
  it('임박한 것이 위로, 멈춘 것은 맨 아래', () => {
    const a = makeItem({ id: 'a', baseDate: '2026-08-06', cycleDays: 30 }); // D-DAY
    const b = makeItem({ id: 'b', baseDate: '2026-09-01', cycleDays: 30 }); // D-26
    const c = makeItem({
      id: 'c',
      baseDate: '2026-08-01',
      cycleDays: 7,
      status: 'paused',
      pauseReason: 'season',
      pausedAt: '2026-08-05',
    });
    const sorted = [b, c, a].sort(byDueDate('2026-09-05')).map((i) => i.id);
    expect(sorted).toEqual(['a', 'b', 'c']);
  });
});

describe('알림 응답', () => {
  it('바꿨어요 — 그날이 새 기준일. 연기와 무시가 씻긴다', () => {
    const item = makeItem({
      baseDate: '2026-08-06',
      cycleDays: 30,
      deferDays: 9,
      ignoreStreak: 2,
      lastStage: 'due',
      lastStageDue: '2026-09-14',
    });
    const next = applyReplaced(item, '2026-09-12');
    expect(next.baseDate).toBe('2026-09-12');
    expect(next.deferDays).toBe(0);
    expect(next.ignoreStreak).toBe(0);
    expect(next.lastStage).toBeNull();
    expect(nextDueOf(next)).toBe('2026-10-12');
  });

  it('아직 멀쩡해요 — 주기의 30%만큼 미룬다 (30일 → +9일)', () => {
    const item = makeItem({ baseDate: '2026-08-06', cycleDays: 30 });
    const next = applyStillGood(item, '2026-09-05');
    expect(next.deferDays).toBe(9);
    expect(nextDueOf(next)).toBe('2026-09-14');
    expect(next.baseDate).toBe('2026-08-06'); // 기준일은 그대로
    expect(Math.round(30 * STILL_GOOD_RATIO)).toBe(9);
  });

  it('한참 밀린 뒤에 눌러도 예정일이 과거로 남지 않는다', () => {
    const item = makeItem({ baseDate: '2026-06-01', cycleDays: 30 }); // 예정일 2026-07-01
    const next = applyStillGood(item, '2026-09-05');
    expect(nextDueOf(next)).toBe('2026-09-14'); // 오늘 + 9일
    expect(daysRemaining(next, '2026-09-05')).toBe(9);
  });

  it('주기가 짧아도 최소 하루는 밀린다 — 같은 날 또 묻지 않는다', () => {
    const daily = makeItem({ baseDate: '2026-09-05', cycleDays: 1 });
    const next = applyStillGood(daily, '2026-09-06');
    expect(daysRemaining(next, '2026-09-06')).toBeGreaterThanOrEqual(1);
  });

  it('아직이요 — 기준일도 예정일도 그대로', () => {
    const item = makeItem({ baseDate: '2026-08-06', cycleDays: 30, ignoreStreak: 2 });
    const next = applySnoozed(item);
    expect(next.baseDate).toBe(item.baseDate);
    expect(next.deferDays).toBe(0);
    expect(next.ignoreStreak).toBe(0); // 응답은 했으므로 무시 기록은 씻긴다
  });

  it('연속 무시 3회면 한 번 물어본다', () => {
    let item = makeItem();
    expect(shouldAskKeepNotifying(item)).toBe(false);
    item = applyIgnored(applyIgnored(applyIgnored(item)));
    expect(item.ignoreStreak).toBe(3);
    expect(shouldAskKeepNotifying(item)).toBe(true);
  });
});

describe('보관 · 조용히 보관 · 새것으로 교체', () => {
  it('이제 안 써요', () => {
    expect(applyArchived(makeItem()).status).toBe('archived');
  });

  it('조용히 보관했다가 풀면 멈춰 있던 만큼 예정일이 밀린다', () => {
    const item = makeItem({ baseDate: '2026-08-06', cycleDays: 30 });
    const muted = applyMuted(item, '2026-09-01'); // D-4에서 멈춤
    expect(daysRemaining(muted, '2026-10-01')).toBe(4);
    const back = applyUnmuted(muted, '2026-10-01');
    expect(back.status).toBe('active');
    expect(daysRemaining(back, '2026-10-01')).toBe(4); // 남은 4일이 그대로 이어진다
  });

  it('새것으로 바꿨어요 — 주기가 카탈로그 기본값으로 되돌아온다', () => {
    const item = withCycleDays(makeItem({ cycleDays: 30 }), 60);
    expect(item.cycleSource).toBe('user');
    const next = applyRenewed(item, '2026-09-05', 30);
    expect(next.cycleDays).toBe(30);
    expect(next.cycleSource).toBe('catalog');
    expect(next.baseDate).toBe('2026-09-05');
  });

  it('직접 추가 품목은 되돌릴 기본값이 없으므로 주기를 유지한다', () => {
    const item = makeItem({ cycleDays: 45, cycleSource: 'user' });
    const next = applyRenewed(item, '2026-09-05', null);
    expect(next.cycleDays).toBe(45);
  });
});

describe('직접 수정', () => {
  it('주기를 고치면 단계 기록이 초기화된다', () => {
    const item = makeItem({ lastStage: 'due', lastStageDue: '2026-09-05' });
    const next = withCycleDays(item, 45);
    expect(next.cycleDays).toBe(45);
    expect(next.lastStage).toBeNull();
    expect(() => withCycleDays(item, 0)).toThrow(RangeError);
    expect(() => withCycleDays(item, 1.5)).toThrow(RangeError);
  });

  it('마지막 교체일을 고치면 연기도 씻긴다', () => {
    const item = makeItem({ deferDays: 9 });
    const next = withBaseDate(item, '2026-09-01');
    expect(next.baseDate).toBe('2026-09-01');
    expect(next.deferDays).toBe(0);
  });
});

describe('createItem', () => {
  it('카탈로그 품목을 그대로 옮겨 담는다', () => {
    const item = createItem({
      id: 'x',
      catalog: catalogItem({ code: 'bath_toothbrush', name: '칫솔', zone: '욕실', cycle_days: 90 }),
      baseDate: '2026-09-05',
      now: NOW,
    });
    expect(item.name).toBe('칫솔');
    expect(item.zone).toBe('욕실');
    expect(item.cycleDays).toBe(90);
    expect(item.cycleSource).toBe('catalog');
    expect(nextDueOf(item)).toBe('2026-12-04');
  });

  it('사용기한을 직접 고르면 user 출처가 된다', () => {
    const item = createItem({
      id: 'x',
      catalog: catalogItem({ input_type: 'pao', cycle_days: 365 }),
      baseDate: '2026-09-05',
      cycleDaysOverride: 180,
      now: NOW,
    });
    expect(item.cycleDays).toBe(180);
    expect(item.cycleSource).toBe('user');
  });

  it('같은 구역에 같은 품목이면 번호가 붙는다', () => {
    const item = createItem({
      id: 'x',
      catalog: catalogItem({ name: '칫솔' }),
      baseDate: '2026-09-05',
      existingNames: ['칫솔', '칫솔 2'],
      now: NOW,
    });
    expect(item.name).toBe('칫솔 3');
    expect(disambiguateName('칫솔', [])).toBe('칫솔');
  });

  it('직접 추가', () => {
    const item = createItem({
      id: 'x',
      catalog: null,
      custom: { name: '  자전거 체인 오일  ', zone: '거실', cycleDays: 60 },
      baseDate: '2026-09-05',
      now: NOW,
    });
    expect(item.name).toBe('자전거 체인 오일');
    expect(item.catalogCode).toBeNull();
    expect(item.cycleSource).toBe('user');
  });

  it('말이 안 되는 입력은 던진다', () => {
    expect(() => createItem({ id: 'x', catalog: null, baseDate: '2026-09-05', now: NOW })).toThrow();
    expect(() =>
      createItem({
        id: 'x',
        catalog: null,
        custom: { name: '   ', zone: '주방', cycleDays: 30 },
        baseDate: '2026-09-05',
        now: NOW,
      }),
    ).toThrow();
    expect(() =>
      createItem({
        id: 'x',
        catalog: catalogItem(),
        baseDate: '2026-09-05',
        cycleDaysOverride: 0,
        now: NOW,
      }),
    ).toThrow(RangeError);
  });

  it('2주 미만은 자주 알림이 간다고 고지한다', () => {
    expect(isFrequent(7)).toBe(true);
    expect(isFrequent(14)).toBe(false);
  });
});
