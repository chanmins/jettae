/**
 * core/season — 계절 품목
 *
 * 12월에 "선풍기 청소할 때예요"가 뜨는 순간 신뢰가 끝난다.
 * 그래서 시즌 밖에서는 카운트를 멈추고, 시즌이 시작되면 한 번만 묻는다.
 * 계절 품목의 기준은 달력이 아니라 '쓰기 시작한 날'이다.
 */
import { monthOf, diffDays, addDays } from './date';
import type { ISODate, Item, Season } from './types';

/** 여름 — 5월부터 9월까지. 선풍기 · 제습제. */
export const SUMMER_MONTHS: readonly number[] = [5, 6, 7, 8, 9];
/** 겨울 — 11월부터 이듬해 3월까지. 가습기 · 전기장판 · 찜질팩. */
export const WINTER_MONTHS: readonly number[] = [11, 12, 1, 2, 3];

/** '아직이요'를 누른 뒤 다시 묻기까지의 간격. */
export const SEASON_REASK_DAYS = 14;

export function isInSeason(season: Season, on: ISODate): boolean {
  if (season === 'all') return true;
  const m = monthOf(on);
  return season === 'summer' ? SUMMER_MONTHS.includes(m) : WINTER_MONTHS.includes(m);
}

/**
 * 시즌 품목에 대해 오늘 무엇을 해야 하는가.
 *
 * `pause`      — 시즌이 끝났다. 카운트를 멈춘다
 * `ask_resume` — 시즌이 시작됐다. "선풍기 꺼내셨어요?"를 한 번 묻는다
 * `none`       — 할 일 없음
 */
export type SeasonAction = 'pause' | 'ask_resume' | 'none';

export function seasonAction(item: Item, today: ISODate): SeasonAction {
  if (item.season === 'all' || item.status === 'archived') return 'none';
  const inSeason = isInSeason(item.season, today);

  if (!inSeason) {
    // 사용자가 직접 조용히 보관한 것은 건드리지 않는다.
    if (item.status === 'paused') return 'none';
    return 'pause';
  }

  if (item.status === 'paused' && item.pauseReason === 'season') {
    if (!item.seasonAskedAt) return 'ask_resume';
    // 아직이요를 누른 뒤에도 시즌 안이라면 2주에 한 번 다시 묻는다.
    return diffDays(item.seasonAskedAt, today) >= SEASON_REASK_DAYS ? 'ask_resume' : 'none';
  }
  return 'none';
}

/** 시즌이 끝났다 — 남은 일수를 그대로 얼린다. */
export function applySeasonPause(item: Item, today: ISODate): Item {
  if (item.status === 'paused') return item;
  return {
    ...item,
    status: 'paused',
    pauseReason: 'season',
    pausedAt: today,
    seasonAskedAt: null,
    lastStage: null,
    lastStageDue: null,
  };
}

/**
 * "네, 쓰고 있어요" — 누른 날이 새 기준일이 된다.
 * 시간이 아니라 사용 개시가 주기를 연다.
 */
export function applySeasonResume(item: Item, today: ISODate): Item {
  return {
    ...item,
    status: 'active',
    pauseReason: null,
    pausedAt: null,
    seasonAskedAt: null,
    baseDate: today,
    deferDays: 0,
    ignoreStreak: 0,
    lastStage: null,
    lastStageDue: null,
  };
}

/** "아직이요" — 멈춘 채로 두고, 2주 뒤에 다시 묻는다. */
export function applySeasonNotYet(item: Item, today: ISODate): Item {
  return { ...item, seasonAskedAt: today };
}

/** 오늘 재개를 물어야 하는 품목들. 홈의 계절 카드가 이걸 쓴다. */
export function itemsAwaitingSeasonStart(items: readonly Item[], today: ISODate): Item[] {
  return items.filter((i) => seasonAction(i, today) === 'ask_resume');
}

/** 다음 시즌 시작일 — "봄에 다시 알려드릴게요" 같은 안내에 쓴다. */
export function nextSeasonStart(season: Season, from: ISODate): ISODate | null {
  if (season === 'all') return null;
  let cursor = from;
  // 최대 400일까지만 앞을 본다. 시즌은 어느 해든 1년 안에 반드시 돌아온다.
  for (let i = 0; i < 400; i++) {
    if (isInSeason(season, cursor) && (i === 0 || !isInSeason(season, addDays(cursor, -1)))) {
      return cursor;
    }
    cursor = addDays(cursor, 1);
  }
  return null;
}
