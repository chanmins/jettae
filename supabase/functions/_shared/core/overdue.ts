// 이 파일은 생성물이다. 고치지 말 것.
// 원본: app/src/core — `node scripts/sync-core.mjs`로 다시 만든다.
/**
 * core/overdue — 밀린 항목
 *
 * 한 달 만에 앱을 열었더니 붉은 항목이 15개. 이 화면을 보면 사용자는
 * 만회할 수 없다고 느끼고 앱을 지운다. 그래서 접고, 자비로운 출구를 크게 둔다.
 */
import { applyReplaced, isOverdue } from './cycle.ts';
import { OVERDUE_COLLAPSE } from './notify.ts';
import type { ISODate, Item } from './types.ts';

export function overdueItems(items: readonly Item[], today: ISODate): Item[] {
  return items.filter((i) => isOverdue(i, today));
}

/** 밀린 것이 많아 목록을 접고 배너 하나로 요약해야 하는가. */
export function shouldCollapseOverdue(items: readonly Item[], today: ISODate): boolean {
  return overdueItems(items, today).length > OVERDUE_COLLAPSE;
}

/**
 * "지금부터 다시 셀게요" — 과거를 캐묻지 않고 전부 오늘 기준으로 리셋한다.
 * 기본 출구가 이것이다. 자비로운 탈출구가 없으면 이탈한다.
 */
export function bulkResetToToday(items: readonly Item[], today: ISODate): Item[] {
  return items.map((i) => (isOverdue(i, today) ? applyReplaced(i, today) : i));
}

/** 이사 정리 — 가져온 것만 남기고 두고 온 것은 목록에서 내린다. */
export function applyMoveHouse(
  items: readonly Item[],
  keptIds: ReadonlySet<string>,
  today: ISODate,
): Item[] {
  return items.map((i) => {
    if (i.status === 'archived') return i;
    if (keptIds.has(i.id)) return i;
    return { ...i, status: 'archived', pauseReason: null, updatedAt: `${today}T00:00:00.000Z` };
  });
}
