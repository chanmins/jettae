/**
 * core/catalog — 프리셋 카탈로그 159종
 *
 * 등록이 2초가 되려면 "품목 → 권장 주기" 데이터가 이미 있어야 한다.
 * 이 카탈로그의 품질이 곧 제품의 품질이다.
 *
 * 여기서는 조회·검색·정렬만 한다. 데이터 자체는 src/data/catalog.json 이다.
 */
import { paoLabel } from './humanize';
import type { CatalogItem, Zone } from './types';
import { ZONES } from './types';

export interface CatalogIndex {
  all: readonly CatalogItem[];
  byCode: ReadonlyMap<string, CatalogItem>;
  byZone: ReadonlyMap<Zone, readonly CatalogItem[]>;
}

/** 짧은 주기가 위로. 첫 알림까지의 공백이 이 앱의 치명적 리스크다. */
export function byCycleThenName(a: CatalogItem, b: CatalogItem): number {
  if (a.cycle_days !== b.cycle_days) return a.cycle_days - b.cycle_days;
  return a.name.localeCompare(b.name, 'ko');
}

export function buildCatalogIndex(items: readonly CatalogItem[]): CatalogIndex {
  const byCode = new Map<string, CatalogItem>();
  for (const item of items) {
    if (byCode.has(item.code)) {
      throw new Error(`카탈로그에 중복된 code가 있어요: ${item.code}`);
    }
    byCode.set(item.code, item);
  }

  const byZone = new Map<Zone, CatalogItem[]>();
  for (const zone of ZONES) byZone.set(zone, []);
  for (const item of items) {
    const bucket = byZone.get(item.zone);
    if (!bucket) throw new Error(`카탈로그에 모르는 구역이 있어요: ${item.zone} (${item.code})`);
    bucket.push(item);
  }
  for (const bucket of byZone.values()) bucket.sort(byCycleThenName);

  return { all: items, byCode, byZone };
}

/**
 * 온보딩 추천 목록 — 고른 구역의 흔한 품목만, 짧은 주기가 위로.
 *
 * 짧은 주기 품목이 하나도 없으면 첫 알림이 몇 달 뒤가 되어 앱을 잊는다.
 * 그래서 2주 이하 품목을 최소 한 개는 목록 안에 넣어준다.
 */
export const ONBOARDING_LIMIT = 8;
export const SHORT_CYCLE_DAYS = 14;

export function onboardingPicks(
  index: CatalogIndex,
  zones: readonly Zone[],
  limit = ONBOARDING_LIMIT,
): CatalogItem[] {
  const zoneSet = new Set<Zone>(zones);
  const picks = index.all
    .filter((c) => c.onboarding_pick && zoneSet.has(c.zone))
    .sort(byCycleThenName);

  const chosen = picks.slice(0, limit);

  // 짧은 주기가 하나도 없으면 고른 구역에서 가장 짧은 것을 하나 끌어온다.
  // 추천 표시가 없는 품목이라도 넣는다 — 첫 알림이 몇 달 뒤가 되는 쪽이 훨씬 나쁘다.
  if (!chosen.some((c) => c.cycle_days <= SHORT_CYCLE_DAYS)) {
    const shortest = index.all
      .filter(
        (c) => zoneSet.has(c.zone) && c.cycle_days <= SHORT_CYCLE_DAYS && c.input_type === 'list',
      )
      .sort(byCycleThenName)[0];
    if (shortest) {
      if (chosen.length >= limit) chosen.pop();
      chosen.unshift(shortest);
    }
  }
  return chosen;
}

/** 초성까지 훑는 검색은 과하다. 이름·구역·메모의 부분 일치면 충분하다. */
export function searchCatalog(index: CatalogIndex, query: string, limit = 40): CatalogItem[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const scored: Array<{ item: CatalogItem; score: number }> = [];
  for (const item of index.all) {
    const name = item.name.toLowerCase();
    let score = -1;
    if (name === q) score = 0;
    else if (name.startsWith(q)) score = 1;
    else if (name.includes(q)) score = 2;
    else if (item.zone.includes(q)) score = 3;
    else if (item.note?.toLowerCase().includes(q)) score = 4;
    if (score >= 0) scored.push({ item, score });
  }
  scored.sort((a, b) => a.score - b.score || byCycleThenName(a.item, b.item));
  return scored.slice(0, limit).map((s) => s.item);
}

/**
 * 개봉일 기준 품목의 사용기한 선택지.
 * 카탈로그 기본값은 반드시 포함되고, 그것이 미리 선택돼 있다.
 */
export const PAO_MONTH_OPTIONS: readonly number[] = [3, 6, 12, 24, 36];

export function paoOptions(defaultDays: number): number[] {
  // 라벨이 같은 값이 두 개 나오면 안 된다 — 화면에 '12개월'이 나란히 두 번 뜬다.
  // 표준 눈금과 카탈로그 기본값이 같은 칸을 차지하면 기본값이 이긴다. 그게 실제 권장값이다.
  const byLabel = new Map<string, number>();
  for (const months of PAO_MONTH_OPTIONS) {
    const days = months * 30;
    byLabel.set(paoLabel(days), days);
  }
  byLabel.set(paoLabel(defaultDays), defaultDays);
  return [...byLabel.values()].sort((a, b) => a - b);
}

/** "쓰던 거예요" 선택지 — 대략 얼마나 썼는지. */
export const USED_SINCE_OPTIONS: ReadonlyArray<{ label: string; days: number | null }> = [
  { label: '1주', days: 7 },
  { label: '1개월', days: 30 },
  { label: '3개월', days: 90 },
  { label: '기억 안 남', days: null },
];

/** 개봉 시점 선택지. */
export const OPENED_OPTIONS: ReadonlyArray<{ label: string; days: number | null }> = [
  { label: '오늘 개봉했어요', days: 0 },
  { label: '한 달쯤 전', days: 30 },
  { label: '세 달쯤 전', days: 90 },
  { label: '날짜 직접 고르기', days: null },
];
