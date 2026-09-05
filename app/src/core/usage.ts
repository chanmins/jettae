/**
 * core/usage — 사용량 기준 주기 (Phase 4)
 *
 * 엔진오일은 7,000~10,000km에서 갈고 기간은 보조 기준이다.
 * 정확히는 둘 중 먼저 도달하는 쪽이 교체 시점이다 — 타지 않아도 1년이 넘으면 변질되기 때문이다.
 *
 * 사용량을 매번 입력하게 하면 아무도 쓰지 않는다. 그래서 가끔 물어서 속도를 추정한다.
 * MVP 범위 밖이지만 스키마와 계산은 지금 잡아둔다. 나중에 필드를 끼워 넣는 비용이 더 크다.
 */
import { addDays, diffDays, compareDate } from './date';
import { nextDueOf } from './cycle';
import type { ISODate, Item } from './types';

export interface UsageReading {
  on: ISODate;
  /** 누적 사용량(주행거리 등) */
  value: number;
}

/** 하루당 사용량. 관측이 모자라거나 시간이 흐르지 않았으면 null. */
export function usageRate(base: UsageReading, latest: UsageReading): number | null {
  const days = diffDays(base.on, latest.on);
  if (days <= 0) return null;
  const delta = latest.value - base.value;
  if (delta < 0) return null; // 계기판이 되감기지는 않는다 — 잘못된 입력
  return delta / days;
}

/**
 * 사용량 기준으로 예상되는 교체일.
 * 속도를 알 수 없으면 null을 돌려주고, 그때는 날짜 기준만 쓴다.
 */
export function usageProjectedDue(
  item: Pick<Item, 'cycleUsage' | 'baseUsage' | 'baseDate'>,
  latest: UsageReading | null,
): ISODate | null {
  if (item.cycleUsage == null || item.baseUsage == null) return null;
  if (!latest) return null;

  const rate = usageRate({ on: item.baseDate, value: item.baseUsage }, latest);
  if (rate == null || rate <= 0) return null;

  const remaining = item.cycleUsage - (latest.value - item.baseUsage);
  if (remaining <= 0) return latest.on;

  const daysLeft = Math.ceil(remaining / rate);
  return addDays(latest.on, daysLeft);
}

/**
 * 실제 예정일 — 날짜 기준과 사용량 기준 중 먼저 오는 쪽.
 * 사용량 기준이 없으면 날짜 기준 그대로다.
 */
export function effectiveDue(item: Item, latest: UsageReading | null): ISODate {
  const byTime = nextDueOf(item);
  if (item.metric !== 'usage') return byTime;
  const byUsage = usageProjectedDue(item, latest);
  if (!byUsage) return byTime;
  return compareDate(byUsage, byTime) < 0 ? byUsage : byTime;
}

/** "월 1,000km → 8,000km까지 약 8개월" 같은 안내 문구용 숫자. */
export function monthlyRate(base: UsageReading, latest: UsageReading): number | null {
  const rate = usageRate(base, latest);
  return rate == null ? null : Math.round(rate * 30);
}
