import { describe, it, expect } from 'vitest';
import {
  overdueItems,
  shouldCollapseOverdue,
  bulkResetToToday,
  applyMoveHouse,
} from '../src/core/overdue';
import { daysRemaining, nextDueOf } from '../src/core/cycle';
import { usageRate, usageProjectedDue, effectiveDue, monthlyRate } from '../src/core/usage';
import {
  cycleLabel,
  cycleSuffix,
  elapsedLabel,
  sinceLabel,
  remainingLabel,
  joinNames,
  paoLabel,
} from '../src/core/humanize';
import { makeItem } from './helpers';

describe('밀린 항목', () => {
  const overdue = (n: number) =>
    Array.from({ length: n }, (_, i) =>
      makeItem({ id: `o${i}`, baseDate: '2026-07-01', cycleDays: 30 }),
    );

  it('밀린 것만 골라낸다', () => {
    const items = [...overdue(3), makeItem({ id: 'ok', baseDate: '2026-09-01', cycleDays: 30 })];
    expect(overdueItems(items, '2026-09-05').map((i) => i.id)).toEqual(['o0', 'o1', 'o2']);
  });

  it('5개까지는 그대로 보여주고, 넘으면 접는다', () => {
    expect(shouldCollapseOverdue(overdue(5), '2026-09-05')).toBe(false);
    expect(shouldCollapseOverdue(overdue(6), '2026-09-05')).toBe(true);
  });

  it('지금부터 다시 셀게요 — 밀린 것만 오늘 기준으로 리셋한다', () => {
    const safe = makeItem({ id: 'safe', baseDate: '2026-09-01', cycleDays: 30 });
    const items = [...overdue(3), safe];
    const reset = bulkResetToToday(items, '2026-09-05');
    for (const item of reset.filter((i) => i.id !== 'safe')) {
      expect(item.baseDate).toBe('2026-09-05');
      expect(daysRemaining(item, '2026-09-05')).toBe(30);
    }
    // 아직 안 밀린 것은 건드리지 않는다
    expect(reset.find((i) => i.id === 'safe')!.baseDate).toBe('2026-09-01');
  });

  it('멈춰 있는 항목은 밀린 것으로 세지 않는다', () => {
    const paused = makeItem({
      id: 'p',
      baseDate: '2026-07-01',
      cycleDays: 30,
      status: 'paused',
      pauseReason: 'season',
      pausedAt: '2026-07-20',
    });
    expect(overdueItems([paused], '2026-09-05')).toEqual([]);
  });
});

describe('이사 정리', () => {
  it('가져온 것만 남고 두고 온 것은 목록에서 내려간다', () => {
    const kept = makeItem({ id: 'kept' });
    const left = makeItem({ id: 'left' });
    const already = makeItem({ id: 'already', status: 'archived' });
    const out = applyMoveHouse([kept, left, already], new Set(['kept']), '2026-09-05');
    expect(out.find((i) => i.id === 'kept')!.status).toBe('active');
    expect(out.find((i) => i.id === 'left')!.status).toBe('archived');
    expect(out.find((i) => i.id === 'already')!.status).toBe('archived');
  });
});

describe('사용량 기준 (Phase 4)', () => {
  it('하루당 사용량을 추정한다', () => {
    expect(usageRate({ on: '2026-01-01', value: 52_000 }, { on: '2026-02-01', value: 53_000 })).toBeCloseTo(
      1000 / 31,
    );
    expect(monthlyRate({ on: '2026-01-01', value: 52_000 }, { on: '2026-01-31', value: 53_000 })).toBe(1000);
  });

  it('계기판이 되감기거나 시간이 안 흘렀으면 추정하지 않는다', () => {
    expect(usageRate({ on: '2026-01-01', value: 100 }, { on: '2026-01-01', value: 200 })).toBeNull();
    expect(usageRate({ on: '2026-01-01', value: 200 }, { on: '2026-02-01', value: 100 })).toBeNull();
  });

  it('둘 중 먼저 도달하는 쪽이 교체 시점이다', () => {
    const shoe = makeItem({
      metric: 'usage',
      cycleDays: 540,
      cycleUsage: 700,
      unit: 'km',
      baseUsage: 0,
      baseDate: '2026-01-01',
    });
    // 1/1~1/31에 300km → 하루 10km. 남은 400km는 40일이면 닿는다. 날짜 기준(540일)보다 훨씬 빠르다
    const fast = effectiveDue(shoe, { on: '2026-01-31', value: 300 });
    expect(fast).toBe('2026-03-12'); // 관측일(1/31) + 남은 400km ÷ 10km/일
    expect(fast < nextDueOf(shoe)).toBe(true);

    // 거의 안 뛰면 날짜 기준이 먼저 온다
    const slow = effectiveDue(shoe, { on: '2026-01-31', value: 5 });
    expect(slow).toBe(nextDueOf(shoe));
  });

  it('관측이 없으면 날짜 기준 그대로', () => {
    const shoe = makeItem({ metric: 'usage', cycleUsage: 700, baseUsage: 0 });
    expect(effectiveDue(shoe, null)).toBe(nextDueOf(shoe));
    expect(usageProjectedDue(shoe, null)).toBeNull();
  });

  it('날짜 기준 품목은 사용량 관측이 있어도 무시한다', () => {
    const sponge = makeItem({ metric: 'time' });
    expect(effectiveDue(sponge, { on: '2026-09-05', value: 999 })).toBe(nextDueOf(sponge));
  });
});

describe('문구', () => {
  it('주기를 사람 말로', () => {
    expect(cycleLabel(1)).toBe('매일');
    expect(cycleLabel(7)).toBe('일주일');
    expect(cycleLabel(14)).toBe('2주');
    expect(cycleLabel(21)).toBe('3주');
    expect(cycleLabel(30)).toBe('한 달');
    expect(cycleLabel(90)).toBe('3개월');
    expect(cycleLabel(365)).toBe('1년');
    expect(cycleLabel(540)).toBe('1.5년');
    expect(cycleLabel(730)).toBe('2년');
    expect(cycleLabel(3650)).toBe('10년');
    expect(cycleSuffix(30)).toBe('한 달 주기');
  });

  it('지난 시간', () => {
    expect(elapsedLabel(0)).toBe('오늘이에요');
    expect(elapsedLabel(1)).toBe('하루 지났어요');
    expect(elapsedLabel(21)).toBe('3주 지났어요');
    expect(elapsedLabel(400)).toBe('1년 지났어요');
    expect(sinceLabel('2026-08-06', '2026-09-05')).toBe('한 달 됐어요');
    expect(sinceLabel('2026-09-05', '2026-09-05')).toBe('오늘부터예요');
  });

  it('남은 시간', () => {
    expect(remainingLabel(0)).toBe('오늘이에요');
    expect(remainingLabel(1)).toBe('내일이에요');
    expect(remainingLabel(5)).toBe('5일 뒤예요');
    expect(remainingLabel(-7)).toBe('1주 지났어요');
  });

  it('이름 묶기 — 알림 본문 한 줄', () => {
    expect(joinNames(['수세미', '행주', '침구 세탁'])).toBe('수세미, 행주, 침구 세탁');
    expect(joinNames(['a', 'b', 'c', 'd', 'e'])).toBe('a, b, c 외 2개');
    expect(joinNames([])).toBe('');
  });

  it('개봉 후 사용기한 버튼', () => {
    expect(paoLabel(180)).toBe('6개월');
    expect(paoLabel(720)).toBe('24개월');
    expect(paoLabel(1080)).toBe('3년');
    expect(paoLabel(365)).toBe('12개월');
    expect(paoLabel(120)).toBe('4개월');
  });
});
