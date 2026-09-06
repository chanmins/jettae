// 이 파일은 생성물이다. 고치지 말 것.
// 원본: app/src/core — `node scripts/sync-core.mjs`로 다시 만든다.
/**
 * core/catalog — 프리셋 카탈로그 159종
 *
 * 등록이 2초가 되려면 "품목 → 권장 주기" 데이터가 이미 있어야 한다.
 * 이 카탈로그의 품질이 곧 제품의 품질이다.
 *
 * 여기서는 조회·검색·정렬만 한다. 데이터 자체는 src/data/catalog.json 이다.
 */
import { addDays } from './date.ts';
import { paoLabel } from './humanize.ts';
import type { CatalogItem, ISODate, Zone } from './types.ts';
import { ZONES } from './types.ts';

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

/**
 * 같은 묶음은 code 접두어 두 단계가 같다 — per_lens_daily · per_lens_case ·
 * per_lens_solution. 카탈로그 159종에 이런 묶음이 15개 있다.
 */
export function groupKeyOf(item: CatalogItem): string {
  return item.code.split('_').slice(0, 2).join('_');
}

/**
 * 목록을 훑을 때 쓰는 정렬.
 *
 * "짧은 주기가 위로"는 그대로 두되 그 판정을 묶음 단위로 한다. 예전에는 콘택트
 * 렌즈(1일)가 미용 30종의 맨 위, 렌즈 케이스와 세척액(90일)이 한참 아래에 있어서
 * 같은 물건을 찾으려면 목록을 두 번 훑어야 했다. 묶음의 가장 짧은 주기로 묶음
 * 순서를 정하고, 묶음 안에서 다시 주기순으로 붙인다.
 */
export function byGroupThenCycle(items: readonly CatalogItem[]): CatalogItem[] {
  const minCycle = new Map<string, number>();
  for (const item of items) {
    const key = groupKeyOf(item);
    const prev = minCycle.get(key);
    if (prev === undefined || item.cycle_days < prev) minCycle.set(key, item.cycle_days);
  }
  return [...items].sort((a, b) => {
    const ka = groupKeyOf(a);
    const kb = groupKeyOf(b);
    if (ka === kb) return byCycleThenName(a, b);
    // 묶음 주기가 같으면 code로 갈라 순서가 입력 순서에 흔들리지 않게 한다
    return (minCycle.get(ka) ?? 0) - (minCycle.get(kb) ?? 0) || ka.localeCompare(kb);
  });
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
  for (const zone of ZONES) byZone.set(zone, byGroupThenCycle(byZone.get(zone) ?? []));

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

/**
 * 이미 쓰고 있던 제품을 등록할 때 "얼마나 썼는지".
 *
 * 대부분의 사용자는 새로 산 것이 아니라 이미 쓰는 중인 것을 등록한다. 그런데
 * 이걸 날짜로 물으면 두 가지가 어긋난다. 첫째, 수세미를 언제부터 썼는지 기억하는
 * 사람은 없다. 둘째, 주기가 7일인 것과 365일인 것에 "3개월 전"을 똑같이 쓸 수
 * 없다 — 7일짜리는 12주기나 밀린 상태가 된다.
 *
 * 그래서 절대 날짜가 아니라 그 품목 주기의 비율로 묻는다. 한 번 고르면 주기가
 * 섞인 묶음에도 각각 맞는 기준일이 들어가고, 어떤 경우에도 이미 밀린 상태로
 * 등록되지 않는다(최대 80%).
 */
export type Wear = 'new' | 'half' | 'most';

export const WEAR_OPTIONS: ReadonlyArray<{ value: Wear; label: string; hint: string }> = [
  { value: 'new', label: '새 거예요', hint: '오늘부터 세기 시작해요' },
  { value: 'half', label: '쓰던 거예요', hint: '주기의 절반쯤 지난 것으로 봐요' },
  { value: 'most', label: '바꿀 때가 다 됐어요', hint: '주기의 80%쯤 지난 것으로 봐요' },
];

const WEAR_RATIO: Readonly<Record<Wear, number>> = { new: 0, half: 0.5, most: 0.8 };

/** 얼마나 썼는지에 해당하는 기준일. 주기의 그 비율만큼 과거로 물린다. */
export function baseDateForWear(today: ISODate, cycleDays: number, wear: Wear): ISODate {
  return addDays(today, -Math.round(cycleDays * WEAR_RATIO[wear]));
}

/** 개봉 시점 선택지. */
export const OPENED_OPTIONS: ReadonlyArray<{ label: string; days: number | null }> = [
  { label: '오늘 개봉했어요', days: 0 },
  { label: '한 달쯤 전', days: 30 },
  { label: '세 달쯤 전', days: 90 },
  { label: '날짜 직접 고르기', days: null },
];
