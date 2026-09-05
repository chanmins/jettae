import { describe, it, expect } from 'vitest';
import {
  median,
  replacementIntervals,
  suggestCycle,
  collectSuggestions,
  MIN_INTERVALS,
  DRIFT_THRESHOLD,
} from '../src/core/selfCorrect';
import { makeItem, event } from './helpers';
import type { ItemEvent } from '../src/core/types';

describe('median', () => {
  it('평균이 아니라 중앙값 — 이상치를 방어한다', () => {
    expect(median([30, 32, 400])).toBe(32);
    expect(median([10, 20])).toBe(15);
    expect(median([5])).toBe(5);
    expect(() => median([])).toThrow(RangeError);
  });
});

describe('replacementIntervals', () => {
  it('등록 시점을 첫 기준으로 삼고 교체 이력을 이어붙인다', () => {
    const item = makeItem({ baseDate: '2026-08-09' });
    const events: ItemEvent[] = [
      event(item.id, 'replaced', '2026-05-01'),
      event(item.id, 'replaced', '2026-06-02'),
      event(item.id, 'replaced', '2026-07-05'),
      event(item.id, 'replaced', '2026-08-09'),
    ];
    expect(replacementIntervals(item, events)).toEqual([32, 33, 35]);
  });

  it('교체 이력이 없으면 간격도 없다', () => {
    expect(replacementIntervals(makeItem(), [])).toEqual([]);
  });

  it('같은 날 두 번 눌러도 간격 0은 만들지 않는다', () => {
    const item = makeItem({ baseDate: '2026-09-05' });
    const events = [
      event(item.id, 'replaced', '2026-08-01'),
      event(item.id, 'replaced', '2026-09-05'),
      event(item.id, 'replaced', '2026-09-05'),
    ];
    expect(replacementIntervals(item, events)).toEqual([35]);
  });
});

describe('suggestCycle', () => {
  const withReplacements = (dates: string[], cycleDays = 90) => {
    const item = makeItem({ cycleDays, baseDate: dates[dates.length - 1] });
    const events = dates.map((d) => event(item.id, 'replaced', d));
    return { item, events };
  };

  it('늦게 바꾸는 사람 — 칫솔을 4개월 반에 바꾸면 주기를 늘릴지 제안한다', () => {
    // 등록 후 3회 교체, 간격 135일 안팎
    const { item, events } = withReplacements(
      ['2025-06-01', '2025-10-14', '2026-02-26', '2026-07-11'],
      90,
    );
    const s = suggestCycle(item, events);
    expect(s).not.toBeNull();
    expect(s!.reason).toBe('history');
    expect(s!.currentCycleDays).toBe(90);
    expect(s!.suggestedCycleDays).toBe(135);
    expect(s!.observedIntervals).toHaveLength(MIN_INTERVALS);
  });

  it('일찍 바꾸는 사람도 같은 로직을 탄다 — 양방향', () => {
    const { item, events } = withReplacements(
      ['2026-01-01', '2026-02-20', '2026-04-11', '2026-05-31'],
      90,
    );
    const s = suggestCycle(item, events);
    expect(s).not.toBeNull();
    expect(s!.suggestedCycleDays).toBe(50);
  });

  it('30% 안쪽의 어긋남은 잡음이므로 제안하지 않는다', () => {
    const { item, events } = withReplacements(
      ['2026-01-01', '2026-04-11', '2026-07-20', '2026-10-28'],
      100,
    );
    // 간격 100 / 100 / 100 → 현재 주기와 같다
    expect(suggestCycle(item, events)).toBeNull();
    expect(DRIFT_THRESHOLD).toBe(0.3);
  });

  it('간격이 3개 미만이면 아직 제안하지 않는다', () => {
    const { item, events } = withReplacements(['2026-01-01', '2026-06-01', '2026-11-01'], 30);
    expect(replacementIntervals(item, events)).toHaveLength(2);
    expect(suggestCycle(item, events)).toBeNull();
  });

  it('안전 품목은 자기교정 대상에서 아예 제외된다', () => {
    const { item, events } = withReplacements(
      ['2025-06-01', '2025-10-14', '2026-02-26', '2026-07-11'],
      90,
    );
    expect(suggestCycle({ ...item, safetyLocked: true }, events)).toBeNull();
  });

  it('아직 멀쩡해요가 3회 쌓이면 주기 자체를 늘릴지 묻는다', () => {
    const item = makeItem({ cycleDays: 30 });
    const events = [
      event(item.id, 'still_good', '2026-07-01'),
      event(item.id, 'still_good', '2026-07-15'),
      event(item.id, 'still_good', '2026-08-01'),
    ];
    const s = suggestCycle(item, events);
    expect(s).not.toBeNull();
    expect(s!.reason).toBe('still_good');
    expect(s!.suggestedCycleDays).toBe(39); // 30 * 1.3
  });

  it('교체하면 아직 멀쩡해요 카운트가 씻긴다', () => {
    const item = makeItem({ cycleDays: 30 });
    const events = [
      event(item.id, 'still_good', '2026-07-01'),
      event(item.id, 'still_good', '2026-07-15'),
      event(item.id, 'replaced', '2026-07-20'),
      event(item.id, 'still_good', '2026-08-01'),
    ];
    expect(suggestCycle(item, events)).toBeNull();
  });

  it('보관한 품목은 제안하지 않는다', () => {
    const { item, events } = withReplacements(
      ['2025-06-01', '2025-10-14', '2026-02-26', '2026-07-11'],
      90,
    );
    expect(suggestCycle({ ...item, status: 'archived' }, events)).toBeNull();
  });
});

describe('collectSuggestions', () => {
  it('여러 품목에서 제안을 모은다', () => {
    const a = makeItem({ id: 'a', cycleDays: 90, baseDate: '2026-07-11' });
    const b = makeItem({ id: 'b', cycleDays: 30, baseDate: '2026-09-01' });
    const map = new Map([
      [
        'a',
        ['2025-06-01', '2025-10-14', '2026-02-26', '2026-07-11'].map((d) => event('a', 'replaced', d)),
      ],
      ['b', []],
    ]);
    const out = collectSuggestions([a, b], map);
    expect(out.map((s) => s.itemId)).toEqual(['a']);
  });
});
