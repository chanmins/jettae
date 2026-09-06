/**
 * notify-dispatch — 하루 한 번, 사용자가 정한 시각에
 *
 * Supabase Cron이 5분마다 이 함수를 부른다. 지금이 발송 슬롯인 사용자만 골라
 * core/notify의 buildDailyDigest로 알림 하나를 만들고 웹 푸시로 보낸다.
 *
 * 문구와 단계 판정을 여기서 다시 구현하지 않는다 — _shared/core가 앱과 같은 코드다.
 */
import { createClient, type SupabaseClient } from 'jsr:@supabase/supabase-js@2';
import webpush from 'npm:web-push@3.6.7';

import { buildDailyDigest, markStageSent, type Digest } from '../_shared/core/notify.ts';
import { seasonAction } from '../_shared/core/season.ts';
import { todayIn, clockIn, minutesOfClock } from '../_shared/core/date.ts';
import type { Item, UserSettings, NotifyStage } from '../_shared/core/types.ts';
import { rowToItem, type ItemRow } from '../_shared/rows.ts';
import { isCronRequest } from '../_shared/cronAuth.ts';

/** Cron이 이 간격으로 돈다. 발송 시각이 지난 이 창 안에 들어오면 보낸다. */
const SLOT_MINUTES = 5;
/** 한 번에 처리하는 사용자 수. 함수 실행 시간 한도를 넘기지 않는다. */
const BATCH_LIMIT = 500;
/** 이만큼 연속 실패한 구독은 죽은 것으로 보고 정리한다. */
const MAX_PUSH_FAILURES = 3;

const VAPID_PUBLIC = Deno.env.get('VAPID_PUBLIC_KEY') ?? '';
const VAPID_PRIVATE = Deno.env.get('VAPID_PRIVATE_KEY') ?? '';
const VAPID_SUBJECT = Deno.env.get('VAPID_SUBJECT') ?? 'mailto:hello@example.com';
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const RESPOND_URL = `${SUPABASE_URL}/functions/v1/notify-respond`;

interface SettingsRow {
  user_id: string;
  notify_at: string;
  timezone: string;
  dormant_from: string | null;
  dormant_until: string | null;
  onboarded_at: string | null;
  last_digest_on: string | null;
  silent_streak: number;
  created_at: string;
}

interface SubscriptionRow {
  endpoint: string;
  p256dh: string;
  auth: string;
  fail_count: number;
}

function toSettings(row: SettingsRow): UserSettings {
  return {
    notifyAt: row.notify_at.slice(0, 5),
    timezone: row.timezone,
    dormantUntil: row.dormant_until,
    dormantFrom: row.dormant_from,
    onboardedAt: row.onboarded_at,
    lastDigestOn: row.last_digest_on,
  };
}

/** 이 사용자의 발송 시각이 방금 지났는가. 시간대는 사용자마다 다르다. */
function inSlot(settings: UserSettings, now: Date): boolean {
  const target = minutesOfClock(settings.notifyAt);
  const current = minutesOfClock(clockIn(settings.timezone, now));
  if (target === null || current === null) return false;
  const delta = current - target;
  return delta >= 0 && delta < SLOT_MINUTES;
}

function randomToken(): string {
  return crypto.randomUUID().replace(/-/g, '') + crypto.randomUUID().replace(/-/g, '').slice(0, 8);
}

async function sendPush(
  admin: SupabaseClient,
  subs: SubscriptionRow[],
  payload: unknown,
): Promise<{ delivered: number; error: string | null }> {
  let delivered = 0;
  let lastError: string | null = null;

  for (const sub of subs) {
    try {
      await webpush.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        JSON.stringify(payload),
        { TTL: 60 * 60 * 12 },
      );
      delivered++;
      if (sub.fail_count > 0) {
        await admin.from('push_subscriptions').update({ fail_count: 0 }).eq('endpoint', sub.endpoint);
      }
    } catch (e) {
      const status = (e as { statusCode?: number }).statusCode;
      lastError = e instanceof Error ? e.message : String(e);

      // 404/410은 구독이 확실히 죽은 것이다. 재시도할 이유가 없다.
      if (status === 404 || status === 410) {
        await admin.from('push_subscriptions').delete().eq('endpoint', sub.endpoint);
        continue;
      }
      const next = sub.fail_count + 1;
      if (next >= MAX_PUSH_FAILURES) {
        await admin.from('push_subscriptions').delete().eq('endpoint', sub.endpoint);
      } else {
        await admin.from('push_subscriptions').update({ fail_count: next }).eq('endpoint', sub.endpoint);
      }
    }
  }
  return { delivered, error: delivered > 0 ? null : lastError };
}

/** 시즌이 끝난 품목을 멈춘다. 서버도 이 정리를 해야 알림 대상이 정확해진다. */
async function sweepSeasons(admin: SupabaseClient, items: Item[], today: string): Promise<Item[]> {
  const paused: Item[] = [];
  const out = items.map((item) => {
    if (seasonAction(item, today) !== 'pause') return item;
    const next: Item = {
      ...item,
      status: 'paused',
      pauseReason: 'season',
      pausedAt: today,
      seasonAskedAt: null,
      lastStage: null,
      lastStageDue: null,
    };
    paused.push(next);
    return next;
  });

  for (const item of paused) {
    await admin
      .from('items')
      .update({
        status: 'paused',
        pause_reason: 'season',
        paused_at: today,
        season_asked_at: null,
        last_stage: null,
        last_stage_due: null,
      })
      .eq('id', item.id);
  }
  return out;
}

async function dispatchFor(
  admin: SupabaseClient,
  row: SettingsRow,
  now: Date,
): Promise<'sent' | 'nothing' | 'no-subscription'> {
  const settings = toSettings(row);
  const today = todayIn(settings.timezone, now);
  if (settings.lastDigestOn === today) return 'nothing';

  const { data: memberships } = await admin
    .from('household_members')
    .select('household_id')
    .eq('user_id', row.user_id);

  const householdIds = (memberships ?? []).map((m) => m.household_id as string);
  if (householdIds.length === 0) return 'nothing';

  const { data: itemRows } = await admin
    .from('items')
    .select('*')
    .in('household_id', householdIds)
    .neq('status', 'archived');

  let items = ((itemRows ?? []) as ItemRow[]).map(rowToItem);
  items = await sweepSeasons(admin, items, today);

  const digest: Digest | null = buildDailyDigest({
    items,
    settings,
    today,
    joinedOn: row.created_at.slice(0, 10),
  });
  if (!digest) return 'nothing';

  const { data: subRows } = await admin
    .from('push_subscriptions')
    .select('endpoint, p256dh, auth, fail_count')
    .eq('user_id', row.user_id);

  const subs = (subRows ?? []) as SubscriptionRow[];

  const token = randomToken();
  const { data: notification, error: insertError } = await admin
    .from('notifications')
    .insert({
      user_id: row.user_id,
      item_ids: digest.itemIds,
      kind: digest.kind,
      stage: digest.stage,
      title: digest.title,
      body: digest.body,
      response_token: token,
    })
    .select('id')
    .single();

  if (insertError || !notification) return 'nothing';

  let deliveryError: string | null = null;
  if (subs.length === 0) {
    deliveryError = 'no-subscription';
  } else {
    const result = await sendPush(admin, subs, {
      digestId: notification.id,
      token,
      respondUrl: RESPOND_URL,
      kind: digest.kind,
      title: digest.title,
      body: digest.body,
      actions: digest.actions,
      itemIds: digest.itemIds,
    });
    deliveryError = result.error;
  }

  if (deliveryError) {
    await admin.from('notifications').update({ delivery_error: deliveryError }).eq('id', notification.id);
  }

  // 하루 한 건 — 보냈다고 기록한다. 발송에 실패했어도 같은 날 다시 시도하지 않는다.
  await admin
    .from('user_settings')
    .update({ last_digest_on: today })
    .eq('user_id', row.user_id);

  // 단계를 보낸 것으로 기록해 같은 단계가 두 번 가지 않게 한다.
  if (digest.stage) {
    const stage: NotifyStage = digest.stage;
    for (const id of digest.itemIds) {
      const item = items.find((i) => i.id === id);
      if (!item) continue;
      const marked = markStageSent(item, stage);
      await admin
        .from('items')
        .update({ last_stage: marked.lastStage, last_stage_due: marked.lastStageDue })
        .eq('id', id);
    }
  }

  if (deliveryError === 'no-subscription') return 'no-subscription';
  return deliveryError ? 'no-subscription' : 'sent';
}

Deno.serve(async (req) => {
  // Cron만 부를 수 있어야 한다 — CRON_SECRET(없으면 service_role 키)으로 확인한다.
  if (!isCronRequest(req, SERVICE_KEY)) {
    return new Response(JSON.stringify({ error: 'unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  if (!VAPID_PUBLIC || !VAPID_PRIVATE) {
    return new Response(JSON.stringify({ error: 'VAPID 키가 설정되지 않았어요' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC, VAPID_PRIVATE);

  const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const now = new Date();
  const { data: settingsRows, error } = await admin
    .from('user_settings')
    .select('*')
    .not('onboarded_at', 'is', null)
    .limit(BATCH_LIMIT);

  if (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const due = ((settingsRows ?? []) as SettingsRow[]).filter((row) =>
    inSlot(toSettings(row), now),
  );

  let sent = 0;
  let silent = 0;
  for (const row of due) {
    try {
      const result = await dispatchFor(admin, row, now);
      if (result === 'sent') sent++;
      if (result === 'no-subscription') silent++;
    } catch (e) {
      console.error('dispatch 실패', row.user_id, e);
    }
  }

  return new Response(
    JSON.stringify({ checked: settingsRows?.length ?? 0, inSlot: due.length, sent, silent }),
    { headers: { 'Content-Type': 'application/json' } },
  );
});
