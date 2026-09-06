/**
 * db/supabase — 계정·동기화·푸시가 붙는 저장소
 *
 * 로컬 저장소를 앞에 두고, 서버에는 뒤에서 밀어 넣는다.
 * 연결이 끊겨도 기록은 저장해뒀다가 연결되면 보낸다 — 화면 문구가 약속하는 그대로다.
 */
import { createClient, type SupabaseClient, type Session } from '@supabase/supabase-js';
import type { Item, ItemEvent } from '../core/types';
import type { Patch, Repository, Snapshot } from './types';
import { LocalRepository } from './local';

export interface SupabaseConfig {
  url: string;
  anonKey: string;
}

export function readSupabaseConfig(): SupabaseConfig | null {
  const url = import.meta.env.VITE_SUPABASE_URL;
  const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
  if (!url || !anonKey) return null;
  return { url, anonKey };
}

/* ─── 행 ↔ 도메인 변환 ───────────────────────────────────────────────── */

type ItemRow = {
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
};

function toItem(row: ItemRow): Item {
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
 * `next_due`는 서버가 알림 대상을 고를 때 쓰는 파생 컬럼이다.
 * 클라이언트가 계산해 함께 보낸다 — core의 nextDueOf와 언제나 같아야 한다.
 */
function toItemRow(item: Item, householdId: string, nextDue: string): ItemRow {
  return {
    id: item.id,
    household_id: householdId,
    catalog_code: item.catalogCode,
    name: item.name,
    zone: item.zone,
    input_type: item.inputType,
    metric: item.metric,
    season: item.season,
    safety_locked: item.safetyLocked,
    cycle_days: item.cycleDays,
    cycle_source: item.cycleSource,
    cycle_usage: item.cycleUsage,
    unit: item.unit,
    base_date: item.baseDate,
    base_usage: item.baseUsage,
    defer_days: item.deferDays,
    next_due: nextDue,
    group_count: item.groupCount,
    status: item.status,
    pause_reason: item.pauseReason,
    paused_at: item.pausedAt,
    season_asked_at: item.seasonAskedAt,
    ignore_streak: item.ignoreStreak,
    last_stage: item.lastStage,
    last_stage_due: item.lastStageDue,
    created_at: item.createdAt,
    updated_at: item.updatedAt,
  };
}

type EventRow = {
  id: string;
  item_id: string;
  household_id: string;
  type: string;
  on_date: string;
  at: string;
  meta: Record<string, unknown> | null;
};

function toEvent(row: EventRow): ItemEvent {
  return {
    id: row.id,
    itemId: row.item_id,
    type: row.type as ItemEvent['type'],
    on: row.on_date,
    at: row.at,
    meta: row.meta ?? undefined,
  };
}

function toEventRow(e: ItemEvent, householdId: string): EventRow {
  return {
    id: e.id,
    item_id: e.itemId,
    household_id: householdId,
    type: e.type,
    on_date: e.on,
    at: e.at,
    meta: e.meta ?? null,
  };
}

/* ─── 저장소 ─────────────────────────────────────────────────────────── */

export class SupabaseRepository implements Repository {
  readonly kind = 'supabase' as const;
  readonly client: SupabaseClient;
  private householdId: string | null = null;
  private online = true;
  /** 연결이 끊긴 동안 쌓아두는 변경. 다시 붙으면 순서대로 보낸다 */
  private outbox: Patch[] = [];

  constructor(
    config: SupabaseConfig,
    /** 로컬 저장소가 언제나 앞에 선다. 서버는 뒤따라온다 */
    private readonly local: LocalRepository,
    private readonly nextDueOf: (item: Item) => string,
  ) {
    this.client = createClient(config.url, config.anonKey, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
    });
  }

  isOnline(): boolean {
    return this.online && this.outbox.length === 0;
  }

  get pendingWrites(): number {
    return this.outbox.length;
  }

  /** 계정 없이 시작한다. 이메일 연결은 설정에서 나중에 한다. */
  async ensureSession(): Promise<Session | null> {
    const { data } = await this.client.auth.getSession();
    if (data.session) return data.session;
    const { data: anon, error } = await this.client.auth.signInAnonymously();
    if (error) {
      this.online = false;
      return null;
    }
    return anon.session;
  }

  /** 이 사용자가 속한 집. 없으면 서버가 트리거로 하나 만들어 준다. */
  async ensureHousehold(): Promise<string | null> {
    if (this.householdId) return this.householdId;
    const { data, error } = await this.client
      .from('household_members')
      .select('household_id')
      .order('joined_at', { ascending: true })
      .limit(1)
      .maybeSingle();
    if (error || !data) {
      this.online = false;
      return null;
    }
    this.householdId = data.household_id as string;
    return this.householdId;
  }

  async load(): Promise<Snapshot> {
    // 화면은 언제나 로컬에서 먼저 뜬다. 서버는 그 뒤에 덮어쓴다.
    const localSnapshot = await this.local.load();

    const session = await this.ensureSession();
    if (!session) return localSnapshot;
    const household = await this.ensureHousehold();
    if (!household) return localSnapshot;

    const [items, events, settings] = await Promise.all([
      this.client.from('items').select('*').eq('household_id', household),
      this.client.from('item_events').select('*').eq('household_id', household).order('at'),
      this.client.from('user_settings').select('*').maybeSingle(),
    ]);

    if (items.error || events.error) {
      this.online = false;
      return localSnapshot;
    }

    const snapshot: Snapshot = {
      items: (items.data as ItemRow[]).map(toItem),
      events: (events.data as EventRow[]).map(toEvent),
      settings: settings.data
        ? {
            notifyAt: (settings.data.notify_at as string).slice(0, 5),
            timezone: settings.data.timezone as string,
            dormantUntil: settings.data.dormant_until as string | null,
            dormantFrom: settings.data.dormant_from as string | null,
            onboardedAt: settings.data.onboarded_at as string | null,
            lastDigestOn: settings.data.last_digest_on as string | null,
            overdueNudgedOn: settings.data.overdue_nudged_on as string | null,
          }
        : localSnapshot.settings,
      meta: {
        ...localSnapshot.meta,
        joinedOn:
          (settings.data?.created_at as string | undefined)?.slice(0, 10) ??
          localSnapshot.meta.joinedOn,
      },
    };

    // 서버가 진실이 됐으므로 로컬 사본을 맞춰둔다. 다음에 오프라인으로 열려도 최신이다.
    await this.local.persist({
      items: snapshot.items,
      events: snapshot.events,
      settings: snapshot.settings,
      meta: snapshot.meta,
    });
    this.online = true;
    return snapshot;
  }

  async persist(patch: Patch): Promise<void> {
    // 로컬 먼저. 이게 실패하면 진짜 실패다.
    await this.local.persist(patch);

    const household = await this.ensureHousehold();
    if (!household) {
      this.enqueue(patch);
      return;
    }
    try {
      await this.push(patch, household);
      await this.flush(household);
      this.online = true;
    } catch {
      this.online = false;
      this.enqueue(patch);
    }
  }

  private enqueue(patch: Patch): void {
    this.outbox.push(patch);
    // 아웃박스가 무한히 자라지 않게 한다. 로컬에는 이미 온전히 들어 있다.
    if (this.outbox.length > 200) this.outbox.splice(0, this.outbox.length - 200);
  }

  private async push(patch: Patch, household: string): Promise<void> {
    if (patch.items?.length) {
      const rows = patch.items.map((i) => toItemRow(i, household, this.nextDueOf(i)));
      const { error } = await this.client.from('items').upsert(rows);
      if (error) throw error;
    }
    if (patch.removedItemIds?.length) {
      const { error } = await this.client.from('items').delete().in('id', patch.removedItemIds);
      if (error) throw error;
    }
    if (patch.events?.length) {
      const rows = patch.events.map((e) => toEventRow(e, household));
      const { error } = await this.client.from('item_events').upsert(rows);
      if (error) throw error;
    }
    if (patch.settings) {
      const { error } = await this.client.from('user_settings').upsert({
        user_id: (await this.client.auth.getUser()).data.user?.id,
        notify_at: `${patch.settings.notifyAt}:00`,
        timezone: patch.settings.timezone,
        dormant_until: patch.settings.dormantUntil,
        dormant_from: patch.settings.dormantFrom,
        onboarded_at: patch.settings.onboardedAt,
        last_digest_on: patch.settings.lastDigestOn,
        overdue_nudged_on: patch.settings.overdueNudgedOn,
      });
      if (error) throw error;
    }
  }

  /** 밀린 변경을 순서대로 흘려보낸다. 하나라도 실패하면 남겨두고 다음 기회에. */
  async flush(household?: string): Promise<void> {
    const target = household ?? (await this.ensureHousehold());
    if (!target || this.outbox.length === 0) return;
    while (this.outbox.length > 0) {
      const next = this.outbox[0];
      try {
        await this.push(next, target);
        this.outbox.shift();
      } catch {
        this.online = false;
        return;
      }
    }
    this.online = true;
  }

  /* ─── 계정 ─────────────────────────────────────────────────────── */

  /** 익명 계정에 이메일을 연결한다. 기기를 바꿔도 데이터가 따라온다. */
  async linkEmail(email: string): Promise<{ error: string | null }> {
    const { error } = await this.client.auth.updateUser({ email });
    return { error: error?.message ?? null };
  }

  async signInWithEmail(email: string): Promise<{ error: string | null }> {
    const { error } = await this.client.auth.signInWithOtp({ email });
    return { error: error?.message ?? null };
  }

  async signOut(): Promise<void> {
    await this.client.auth.signOut();
    this.householdId = null;
  }

  async currentEmail(): Promise<string | null> {
    const { data } = await this.client.auth.getUser();
    // 익명 사용자는 email이 빈 문자열로 온다 — ??는 ''를 걸러내지 못하므로 ||를 쓴다.
    // 이걸 놓치면 설정의 '계정' 행 값이 빈칸으로 보인다.
    return data.user?.email || null;
  }

  /* ─── 가족 공유 (Phase 2) ─────────────────────────────────────── */

  /** 초대 코드를 만든다. 받은 사람이 이 코드로 같은 집에 들어온다. */
  async createInvite(): Promise<{ code: string | null; error: string | null }> {
    const household = await this.ensureHousehold();
    if (!household) return { code: null, error: '연결이 안 돼요' };
    const { data, error } = await this.client.rpc('create_household_invite', {
      p_household_id: household,
    });
    return { code: (data as string) ?? null, error: error?.message ?? null };
  }

  async joinHousehold(code: string): Promise<{ error: string | null }> {
    const { error } = await this.client.rpc('join_household_with_invite', {
      p_code: code.trim().toUpperCase(),
    });
    if (error) return { error: error.message };
    this.householdId = null;
    return { error: null };
  }

  async householdMembers(): Promise<Array<{ userId: string; email: string | null; role: string }>> {
    const household = await this.ensureHousehold();
    if (!household) return [];
    const { data } = await this.client.rpc('household_member_list', { p_household_id: household });
    return (
      (data as Array<{ user_id: string; email: string | null; role: string }> | null)?.map((r) => ({
        userId: r.user_id,
        email: r.email,
        role: r.role,
      })) ?? []
    );
  }

  async leaveHousehold(): Promise<{ error: string | null }> {
    const { error } = await this.client.rpc('leave_household');
    if (!error) this.householdId = null;
    return { error: error?.message ?? null };
  }

  /* ─── 푸시 구독 ───────────────────────────────────────────────── */

  async saveSubscription(sub: PushSubscriptionJSON, platform: string): Promise<void> {
    const user = (await this.client.auth.getUser()).data.user;
    if (!user || !sub.endpoint) return;
    await this.client.from('push_subscriptions').upsert(
      {
        user_id: user.id,
        endpoint: sub.endpoint,
        p256dh: sub.keys?.p256dh ?? '',
        auth: sub.keys?.auth ?? '',
        platform,
      },
      { onConflict: 'endpoint' },
    );
  }

  async removeSubscription(endpoint: string): Promise<void> {
    await this.client.from('push_subscriptions').delete().eq('endpoint', endpoint);
  }
}
