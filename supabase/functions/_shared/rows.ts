/**
 * 행 ↔ 도메인 변환. 클라이언트의 db/supabase.ts와 같은 매핑이다.
 */
import { nextDueOf } from './core/cycle.ts';
import type { Item } from './core/types.ts';

export interface ItemRow {
  id: string;
  household_id: string;
  catalog_code: string | null;
  name: string;
  zone: string;
  input_type: string;
  metric: string;
  season: string;
  safety_locked: boolean;
  cycle_days: number;
  cycle_source: string;
  cycle_usage: number | null;
  unit: string | null;
  base_date: string;
  base_usage: number | null;
  defer_days: number;
  next_due: string;
  group_count: number;
  status: string;
  pause_reason: string | null;
  paused_at: string | null;
  season_asked_at: string | null;
  ignore_streak: number;
  last_stage: string | null;
  last_stage_due: string | null;
  created_at: string;
  updated_at: string;
}

export function rowToItem(row: ItemRow): Item {
  return {
    id: row.id,
    catalogCode: row.catalog_code,
    name: row.name,
    zone: row.zone as Item['zone'],
    inputType: row.input_type as Item['inputType'],
    metric: row.metric as Item['metric'],
    season: row.season as Item['season'],
    safetyLocked: row.safety_locked,
    cycleDays: row.cycle_days,
    cycleSource: row.cycle_source as Item['cycleSource'],
    cycleUsage: row.cycle_usage,
    unit: row.unit,
    baseDate: row.base_date,
    baseUsage: row.base_usage,
    deferDays: row.defer_days,
    groupCount: row.group_count,
    status: row.status as Item['status'],
    pauseReason: row.pause_reason as Item['pauseReason'],
    pausedAt: row.paused_at,
    seasonAskedAt: row.season_asked_at,
    ignoreStreak: row.ignore_streak,
    lastStage: row.last_stage as Item['lastStage'],
    lastStageDue: row.last_stage_due,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * 서버가 품목을 고칠 때 쓰는 부분 갱신. next_due는 언제나 함께 다시 계산한다 —
 * 이 컬럼이 어긋나면 알림 대상 조회가 조용히 틀린다.
 */
export function itemPatch(item: Item): Record<string, unknown> {
  return {
    base_date: item.baseDate,
    defer_days: item.deferDays,
    next_due: nextDueOf(item),
    cycle_days: item.cycleDays,
    cycle_source: item.cycleSource,
    status: item.status,
    pause_reason: item.pauseReason,
    paused_at: item.pausedAt,
    season_asked_at: item.seasonAskedAt,
    ignore_streak: item.ignoreStreak,
    last_stage: item.lastStage,
    last_stage_due: item.lastStageDue,
  };
}
