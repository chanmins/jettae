/**
 * core/selfCorrect — 주기 자기교정
 *
 * 카탈로그의 30일은 매일 설거지하는 집 기준이다. 사람마다 실제 주기는 다르다.
 * 응답 이력이 쌓이면 그 사람에게 맞춘다 — 다만 몰래 바꾸지 않고 제안한다.
 * 사용자 모르게 주기가 달라지면 앱을 신뢰할 수 없게 된다.
 *
 * 안전 품목(화재감지기 · 소화기 · 가스)은 자기교정 대상에서 아예 제외한다.
 */
import { diffDays, compareDate } from './date';
import type { ISODate, Item, ItemEvent } from './types';

/** 제안을 띄우기까지 필요한 교체 간격의 개수. */
export const MIN_INTERVALS = 3;
/** 이만큼 어긋나야 제안한다. 30% 미만은 잡음이다. */
export const DRIFT_THRESHOLD = 0.3;
/** '아직 멀쩡해요'가 이만큼 쌓이면 주기 자체를 늘릴지 묻는다. */
export const STILL_GOOD_STREAK = 3;
/** 제안 주기의 하한·상한. 이상치가 들어와도 말이 되는 값만 제안한다. */
export const MIN_SUGGESTED_DAYS = 1;
export const MAX_SUGGESTED_DAYS = 3650;

export type SuggestionReason = 'history' | 'still_good';

export interface CycleSuggestion {
  itemId: string;
  reason: SuggestionReason;
  /** 현재 적용 중인 주기 */
  currentCycleDays: number;
  /** 제안하는 주기 */
  suggestedCycleDays: number;
  /** 근거가 된 교체 간격들 (history일 때만) */
  observedIntervals: number[];
}

/** 홀수/짝수 모두 처리하는 중앙값. 평균 대신 쓰는 이유는 이상치 방어다. */
export function median(values: readonly number[]): number {
  if (values.length === 0) throw new RangeError('median: 빈 배열이에요');
  const s = [...values].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 === 1 ? s[mid] : Math.round((s[mid - 1] + s[mid]) / 2);
}

/**
 * 실제 교체 간격들 — 교체와 교체 사이만 센다.
 *
 * 등록일을 첫 기준점으로 쓰고 싶은 유혹이 있지만 그러면 안 된다.
 * '쓰던 거예요'로 등록한 사람의 기준일은 등록 시점보다 몇 달 앞서 있어서
 * 첫 간격이 통째로 틀리고, 그 틀린 값이 제안의 근거가 되어버린다.
 * 이 앱에서 잘못된 제안은 늦은 제안보다 훨씬 나쁘다.
 *
 * 그래서 간격 3개를 얻으려면 교체 기록이 4번 필요하다. 자기교정은 MVP 범위 밖이고,
 * 급하게 맞히는 것보다 틀리지 않는 편이 낫다.
 */
export function replacementIntervals(
  _item: Pick<Item, 'baseDate'>,
  events: readonly ItemEvent[],
): number[] {
  const marks: ISODate[] = events
    .filter((e) => e.type === 'replaced' || e.type === 'renewed')
    .map((e) => e.on)
    .sort(compareDate);

  const intervals: number[] = [];
  for (let i = 1; i < marks.length; i++) {
    const gap = diffDays(marks[i - 1], marks[i]);
    // 같은 날 두 번 눌렀으면 간격이 아니다
    if (gap > 0) intervals.push(gap);
  }
  return intervals;
}

function countRecent(events: readonly ItemEvent[], type: ItemEvent['type']): number {
  // 마지막 교체 이후의 응답만 센다. 교체하면 카운트가 씻긴다.
  let streak = 0;
  for (let i = events.length - 1; i >= 0; i--) {
    const t = events[i].type;
    if (t === 'replaced' || t === 'renewed' || t === 'reset') break;
    if (t === type) streak++;
  }
  return streak;
}

function clamp(days: number): number {
  return Math.min(MAX_SUGGESTED_DAYS, Math.max(MIN_SUGGESTED_DAYS, Math.round(days)));
}

/**
 * 이 품목에 대해 지금 제안할 것이 있는가.
 *
 * 양방향이다 — 일찍 바꾸는 사람도, 늦게 바꾸는 사람도 같은 로직을 탄다.
 * `events`는 시간 오름차순이어야 한다.
 */
export function suggestCycle(item: Item, events: readonly ItemEvent[]): CycleSuggestion | null {
  if (item.safetyLocked) return null;
  if (item.status === 'archived') return null;

  const intervals = replacementIntervals(item, events);
  if (intervals.length >= MIN_INTERVALS) {
    const recent = intervals.slice(-MIN_INTERVALS);
    const observed = median(recent);
    if (Math.abs(observed - item.cycleDays) > item.cycleDays * DRIFT_THRESHOLD) {
      const suggested = clamp(observed);
      if (suggested !== item.cycleDays) {
        return {
          itemId: item.id,
          reason: 'history',
          currentCycleDays: item.cycleDays,
          suggestedCycleDays: suggested,
          observedIntervals: recent,
        };
      }
    }
  }

  // 교체 이력이 모자라도 '아직 멀쩡해요'가 3회 쌓이면 같은 제안을 띄운다.
  if (countRecent(events, 'still_good') >= STILL_GOOD_STREAK) {
    const suggested = clamp(item.cycleDays * (1 + DRIFT_THRESHOLD));
    if (suggested !== item.cycleDays) {
      return {
        itemId: item.id,
        reason: 'still_good',
        currentCycleDays: item.cycleDays,
        suggestedCycleDays: suggested,
        observedIntervals: [],
      };
    }
  }

  return null;
}

/** 등록된 전체 품목에서 제안 거리를 모은다. 하루에 하나씩만 보여주면 된다. */
export function collectSuggestions(
  items: readonly Item[],
  eventsByItem: ReadonlyMap<string, readonly ItemEvent[]>,
): CycleSuggestion[] {
  const out: CycleSuggestion[] = [];
  for (const item of items) {
    const s = suggestCycle(item, eventsByItem.get(item.id) ?? []);
    if (s) out.push(s);
  }
  return out;
}
