import { describe, it, expect } from 'vitest';
import {
  addDays,
  diffDays,
  isISODate,
  todayIn,
  clockIn,
  minutesOfClock,
  monthOf,
  compareDate,
  formatDot,
  formatShort,
} from '../src/core/date';

describe('isISODate', () => {
  it('형식과 실제 존재하는 날짜를 함께 본다', () => {
    expect(isISODate('2026-09-05')).toBe(true);
    expect(isISODate('2026-02-29')).toBe(false); // 평년
    expect(isISODate('2024-02-29')).toBe(true); // 윤년
    expect(isISODate('2026-13-01')).toBe(false);
    expect(isISODate('2026-09-31')).toBe(false);
    expect(isISODate('2026-9-5')).toBe(false);
    expect(isISODate(20260905)).toBe(false);
  });
});

describe('addDays / diffDays', () => {
  it('달과 해를 넘는다', () => {
    expect(addDays('2026-09-05', 30)).toBe('2026-10-05');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2026-01-01', -1)).toBe('2025-12-31');
    expect(addDays('2024-02-28', 1)).toBe('2024-02-29');
    expect(addDays('2026-02-28', 1)).toBe('2026-03-01');
  });

  it('서머타임이 있는 지역의 날짜에서도 하루가 밀리지 않는다', () => {
    // 미국 서머타임 시작일(2026-03-08) 전후. 문자열 연산이므로 영향이 없다.
    expect(addDays('2026-03-07', 1)).toBe('2026-03-08');
    expect(addDays('2026-03-08', 1)).toBe('2026-03-09');
    expect(diffDays('2026-03-07', '2026-03-09')).toBe(2);
  });

  it('diffDays는 to - from', () => {
    expect(diffDays('2026-09-05', '2026-09-12')).toBe(7);
    expect(diffDays('2026-09-12', '2026-09-05')).toBe(-7);
    expect(diffDays('2026-09-05', '2026-09-05')).toBe(0);
  });

  it('365일을 더하면 정확히 1년 뒤다', () => {
    expect(addDays('2026-09-05', 365)).toBe('2027-09-05');
    expect(diffDays('2026-09-05', '2027-09-05')).toBe(365);
  });

  it('잘못된 날짜는 던진다', () => {
    expect(() => addDays('2026-13-01', 1)).toThrow(RangeError);
    expect(() => addDays('2026-09-05', Number.NaN)).toThrow(RangeError);
  });
});

describe('todayIn / clockIn', () => {
  it('시간대에 따라 날짜가 갈린다', () => {
    // 2026-09-05T20:00Z = 서울 9/6 05:00, 로스앤젤레스 9/5 13:00
    const now = new Date('2026-09-05T20:00:00.000Z');
    expect(todayIn('Asia/Seoul', now)).toBe('2026-09-06');
    expect(todayIn('America/Los_Angeles', now)).toBe('2026-09-05');
    expect(todayIn('UTC', now)).toBe('2026-09-05');
  });

  it('현재 시각을 HH:mm으로', () => {
    const now = new Date('2026-09-05T11:00:00.000Z'); // 서울 20:00
    expect(clockIn('Asia/Seoul', now)).toBe('20:00');
    expect(clockIn('UTC', now)).toBe('11:00');
  });

  it('자정 직전·직후를 넘긴다', () => {
    expect(todayIn('Asia/Seoul', new Date('2026-09-05T14:59:59.000Z'))).toBe('2026-09-05');
    expect(todayIn('Asia/Seoul', new Date('2026-09-05T15:00:00.000Z'))).toBe('2026-09-06');
  });
});

describe('보조 함수', () => {
  it('minutesOfClock', () => {
    expect(minutesOfClock('20:00')).toBe(1200);
    expect(minutesOfClock('00:00')).toBe(0);
    expect(minutesOfClock('24:00')).toBeNull();
    expect(minutesOfClock('8:00')).toBeNull();
  });

  it('monthOf / compareDate / 포맷', () => {
    expect(monthOf('2026-12-01')).toBe(12);
    expect(compareDate('2026-01-01', '2026-01-02')).toBe(-1);
    expect(compareDate('2026-01-02', '2026-01-02')).toBe(0);
    expect(formatDot('2026-09-08')).toBe('2026.09.08');
    expect(formatShort('2026-09-08')).toBe('09.08');
  });
});
