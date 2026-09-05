// 이 파일은 생성물이다. 고치지 말 것.
// 원본: app/src/core — `node scripts/sync-core.mjs`로 다시 만든다.
/**
 * core/cycle — 다음 예정일 · D-day · 상태 3색, 그리고 알림 응답의 결과
 *
 * 이 앱의 모든 날짜 판단이 여기 모여 있다.
 * 다음 예정일 = baseDate + cycleDays + deferDays
 */
import { addDays, diffDays, compareDate } from './date.ts';
import type { ISODate, Item, ItemState, CatalogItem, Zone } from './types.ts';

/** '아직 멀쩡해요' 한 번이 미루는 비율 — 주기의 30%. */
export const STILL_GOOD_RATIO = 0.3;
/** 여유/임박을 가르는 경계. D-7부터 임박이다. */
export const SOON_THRESHOLD_DAYS = 7;

export function nextDueOf(item: Pick<Item, 'baseDate' | 'cycleDays' | 'deferDays'>): ISODate {
  return addDays(item.baseDate, item.cycleDays + item.deferDays);
}

/**
 * 남은 일수. 양수면 아직 남았고(D-n), 0이면 오늘(D-DAY), 음수면 밀렸다(D+n).
 *
 * 시즌 밖이나 휴면으로 멈춰 있으면 멈춘 날 기준으로 얼려서 돌려준다 —
 * 겨울 내내 선풍기의 D-day가 줄어들면 봄에 이미 한참 밀린 상태가 된다.
 */
export function daysRemaining(item: Item, today: ISODate): number {
  const from = item.status === 'paused' && item.pausedAt ? item.pausedAt : today;
  return diffDays(from, nextDueOf(item));
}

/** `D-7` · `D-DAY` · `D+3` */
export function formatDday(remaining: number): string {
  if (remaining === 0) return 'D-DAY';
  return remaining > 0 ? `D-${remaining}` : `D+${-remaining}`;
}

/** 여유(D-8 이상) · 임박(D-7 ~ D-DAY) · 밀림(D+1 이상) */
export function stateOf(item: Item, today: ISODate): ItemState {
  if (item.status === 'paused') return 'paused';
  const r = daysRemaining(item, today);
  if (r <= -1) return 'overdue';
  if (r <= SOON_THRESHOLD_DAYS) return 'soon';
  return 'ok';
}

export function isOverdue(item: Item, today: ISODate): boolean {
  return item.status === 'active' && daysRemaining(item, today) < 0;
}

/** 홈 목록 정렬 — 임박한 것이 위로. 멈춘 항목은 맨 아래. */
export function byDueDate(today: ISODate) {
  return (a: Item, b: Item): number => {
    const ap = a.status === 'paused' ? 1 : 0;
    const bp = b.status === 'paused' ? 1 : 0;
    if (ap !== bp) return ap - bp;
    const d = daysRemaining(a, today) - daysRemaining(b, today);
    if (d !== 0) return d;
    return a.name.localeCompare(b.name, 'ko');
  };
}

/* ─── 알림 응답의 결과 ─────────────────────────────────────────────────
 * 모두 새 Item을 돌려주는 순수 함수다. 저장은 호출한 쪽의 몫이다.
 */

/** 바꿨어요 — 그날이 새 기준일이 된다. 연기와 무시 기록은 씻긴다. */
export function applyReplaced(item: Item, on: ISODate): Item {
  return {
    ...item,
    baseDate: on,
    deferDays: 0,
    ignoreStreak: 0,
    lastStage: null,
    lastStageDue: null,
  };
}

/**
 * 아직 멀쩡해요 — 기준일은 그대로 두고 예정일만 주기의 30%만큼 민다.
 * 최소 1일은 밀어서 같은 날 다시 묻는 일이 없게 한다.
 *
 * 안전 품목도 미루는 것 자체는 된다. 다만 주기(cycleDays)는 절대 늘지 않는다 —
 * 그건 selfCorrect가 막는다.
 */
export function applyStillGood(item: Item, today: ISODate): Item {
  const push = Math.max(1, Math.round(item.cycleDays * STILL_GOOD_RATIO));
  const next: Item = { ...item, deferDays: item.deferDays + push, ignoreStreak: 0 };
  // 이미 한참 밀린 뒤에 눌렀다면 오늘로부터 밀어준다.
  // 눌렀는데 예정일이 여전히 어제인 건 말이 안 된다.
  const due = nextDueOf(next);
  const floor = addDays(today, push);
  if (compareDate(due, floor) < 0) {
    next.deferDays += diffDays(due, floor);
  }
  return next;
}

/**
 * 아직이요 — 기준일도 예정일도 그대로. 재알림은 D+3 단계가 알아서 집어간다.
 * 무시 연속 기록만 씻는다. 무응답이 아니라 응답이기 때문이다.
 */
export function applySnoozed(item: Item): Item {
  return { ...item, ignoreStreak: 0 };
}

/** 알림에 응답하지 않음 — 3회 연속이면 '계속 알려드릴까요?'를 묻는다. */
export function applyIgnored(item: Item): Item {
  return { ...item, ignoreStreak: item.ignoreStreak + 1 };
}

export const IGNORE_ASK_THRESHOLD = 3;

/** 연속 무시가 쌓여 한 번 물어볼 때가 됐는가. */
export function shouldAskKeepNotifying(item: Item): boolean {
  return item.status === 'active' && item.ignoreStreak >= IGNORE_ASK_THRESHOLD;
}

/** 이제 안 써요 — 목록에서 내린다. 이력은 지우지 않는다. */
export function applyArchived(item: Item): Item {
  return { ...item, status: 'archived', pauseReason: null };
}

export function applyUnarchived(item: Item, today: ISODate): Item {
  return {
    ...item,
    status: 'active',
    pauseReason: null,
    pausedAt: null,
    baseDate: today,
    deferDays: 0,
    lastStage: null,
    lastStageDue: null,
  };
}

/** 조용히 보관 — 알림만 끄고 목록에는 남긴다. */
export function applyMuted(item: Item, today: ISODate): Item {
  return { ...item, status: 'paused', pauseReason: 'muted', pausedAt: today, ignoreStreak: 0 };
}

export function applyUnmuted(item: Item, today: ISODate): Item {
  if (item.pauseReason !== 'muted') return item;
  // 멈춰 있던 만큼 예정일을 뒤로 민다. 얼려둔 남은 일수가 그대로 이어진다.
  const frozen = item.pausedAt ? diffDays(item.pausedAt, today) : 0;
  return {
    ...item,
    status: 'active',
    pauseReason: null,
    pausedAt: null,
    deferDays: item.deferDays + Math.max(0, frozen),
  };
}

/**
 * 새것으로 바꿨어요 — 제품 자체가 바뀐 경우.
 * 이력을 새로 시작하고 주기를 카탈로그 기본값으로 되돌린다.
 */
export function applyRenewed(item: Item, on: ISODate, catalogDefault: number | null): Item {
  const base = applyReplaced(item, on);
  if (catalogDefault == null) return base;
  return { ...base, cycleDays: catalogDefault, cycleSource: 'catalog' };
}

/** 사용자가 주기를 직접 고쳤다. 예정일도 따라 움직인다. */
export function withCycleDays(
  item: Item,
  cycleDays: number,
  source: Item['cycleSource'] = 'user',
): Item {
  if (!Number.isInteger(cycleDays) || cycleDays < 1) {
    throw new RangeError(`주기는 1일 이상의 정수여야 해요 (${cycleDays})`);
  }
  return { ...item, cycleDays, cycleSource: source, lastStage: null, lastStageDue: null };
}

/** 마지막 교체일을 직접 고쳤다. */
export function withBaseDate(item: Item, baseDate: ISODate): Item {
  return { ...item, baseDate, deferDays: 0, lastStage: null, lastStageDue: null };
}

/* ─── 등록 ──────────────────────────────────────────────────────────── */

export interface NewItemInput {
  id: string;
  catalog: CatalogItem | null;
  /** 카탈로그에 없는 품목을 직접 추가할 때 */
  custom?: { name: string; zone: Zone; cycleDays: number };
  baseDate: ISODate;
  /** 개봉일 기준 품목에서 사용자가 고른 사용기한(일). 없으면 카탈로그 기본값 */
  cycleDaysOverride?: number;
  groupCount?: number;
  /** 같은 구역에 같은 이름이 이미 있으면 `칫솔 2`가 되도록 넘긴다 */
  existingNames?: readonly string[];
  now: string;
}

/** 같은 구역에 같은 품목이 이미 있으면 뒤에 번호를 붙인다. */
export function disambiguateName(base: string, existing: readonly string[]): string {
  if (!existing.includes(base)) return base;
  for (let n = 2; n < 10_000; n++) {
    const candidate = `${base} ${n}`;
    if (!existing.includes(candidate)) return candidate;
  }
  throw new Error(`disambiguateName: '${base}'의 번호가 바닥났어요`);
}

export function createItem(input: NewItemInput): Item {
  const { catalog, custom } = input;
  if (!catalog && !custom) throw new Error('createItem: 카탈로그 품목이거나 직접 추가여야 해요');

  const rawName = catalog ? catalog.name : custom!.name.trim();
  if (!rawName) throw new Error('createItem: 이름이 비어 있어요');

  const cycleDays = input.cycleDaysOverride ?? (catalog ? catalog.cycle_days : custom!.cycleDays);
  if (!Number.isInteger(cycleDays) || cycleDays < 1) {
    throw new RangeError(`createItem: 주기는 1일 이상의 정수여야 해요 (${cycleDays})`);
  }

  const overridden = input.cycleDaysOverride != null && input.cycleDaysOverride !== catalog?.cycle_days;

  return {
    id: input.id,
    catalogCode: catalog?.code ?? null,
    name: disambiguateName(rawName, input.existingNames ?? []),
    zone: catalog ? catalog.zone : custom!.zone,
    inputType: catalog?.input_type ?? 'list',
    metric: catalog?.metric ?? 'time',
    season: catalog?.season ?? 'all',
    safetyLocked: catalog?.safety_locked ?? false,
    cycleDays,
    cycleSource: catalog == null || overridden ? 'user' : 'catalog',
    cycleUsage: catalog?.cycle_usage ?? null,
    unit: catalog?.unit ?? null,
    baseDate: input.baseDate,
    baseUsage: null,
    deferDays: 0,
    groupCount: input.groupCount ?? 1,
    status: 'active',
    pauseReason: null,
    pausedAt: null,
    seasonAskedAt: null,
    ignoreStreak: 0,
    lastStage: null,
    lastStageDue: null,
    createdAt: input.now,
    updatedAt: input.now,
  };
}

/** 2주 미만 주기는 등록 시 '자주 알림이 갑니다'를 고지한다. */
export const FREQUENT_NOTICE_DAYS = 14;

export function isFrequent(cycleDays: number): boolean {
  return cycleDays < FREQUENT_NOTICE_DAYS;
}
