/**
 * notify-respond — 잠금화면에서 온 응답
 *
 * 서비스워커에는 사용자 세션이 없다. 그래서 푸시 페이로드에 실어 보낸 1회용
 * 토큰이 이 요청의 유일한 인증 수단이다. 토큰은 알림 한 건에 하나이고,
 * 그 알림이 다룬 품목에만 효력이 있다.
 *
 * 앱을 열지 않고 여기서 끝나야 한다 — 이 앱에서는 앱을 열어야만 하는 것이 실패다.
 */
import { createClient, type SupabaseClient } from 'jsr:@supabase/supabase-js@2';

import {
  applyIgnored,
  applyReplaced,
  applySnoozed,
  applyStillGood,
} from '../_shared/core/cycle.ts';
import { applyMuted } from '../_shared/core/cycle.ts';
import { applySeasonNotYet, applySeasonResume } from '../_shared/core/season.ts';
import { bulkResetToToday } from '../_shared/core/overdue.ts';
import { todayIn } from '../_shared/core/date.ts';
import type { EventType, Item } from '../_shared/core/types.ts';
import { itemPatch, rowToItem, type ItemRow } from '../_shared/rows.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

/** 알림이 오래되면 토큰도 죽는다. 지난주 알림으로 오늘을 고칠 수는 없다. */
const TOKEN_TTL_HOURS = 72;

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

type Response$ =
  | 'replaced'
  | 'snoozed'
  | 'still_good'
  | 'season_yes'
  | 'season_no'
  | 'bulk_reset'
  | 'ack'
  | 'mute'
  | 'dismissed';

const RESPONSES = new Set<Response$>([
  'replaced',
  'snoozed',
  'still_good',
  'season_yes',
  'season_no',
  'bulk_reset',
  'ack',
  'mute',
  'dismissed',
]);

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS },
  });
}

/** 응답 하나가 품목 하나에 미치는 결과. core의 순수 함수를 그대로 쓴다. */
function applyResponse(
  item: Item,
  response: Response$,
  today: string,
): { next: Item; event: EventType | null } {
  switch (response) {
    case 'replaced':
      return { next: applyReplaced(item, today), event: 'replaced' };
    case 'snoozed':
      return { next: applySnoozed(item), event: 'snoozed' };
    case 'still_good':
      return { next: applyStillGood(item, today), event: 'still_good' };
    case 'season_yes':
      return { next: applySeasonResume(item, today), event: 'season_start' };
    case 'season_no':
      return { next: applySeasonNotYet(item, today), event: null };
    case 'dismissed':
      return { next: applyIgnored(item), event: 'ignored' };
    /* '계속 알려주세요' — 무시 기록을 씻는다. 응답한 이상 무시가 아니다.
       예전에는 default로 떨어져 ignoreStreak이 그대로 남았고, 그러면 다음
       주기에 곧바로 같은 질문이 다시 나갔다. */
    case 'ack':
      return { next: applySnoozed(item), event: 'snoozed' };
    /* '그만 알릴게요' — 알림만 끄고 목록에는 남긴다. 지우는 것이 아니므로
       나중에 설정에서 되살릴 수 있다. */
    case 'mute':
      return { next: applyMuted(item, today), event: null };
    default:
      return { next: item, event: null };
  }
}

async function writeItem(
  admin: SupabaseClient,
  item: Item,
  householdId: string,
  event: EventType | null,
  today: string,
): Promise<void> {
  await admin.from('items').update(itemPatch(item)).eq('id', item.id);
  if (!event) return;
  await admin.from('item_events').insert({
    id: crypto.randomUUID(),
    item_id: item.id,
    household_id: householdId,
    type: event,
    on_date: today,
  });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405);

  let payload: { digestId?: string; token?: string; response?: string };
  try {
    payload = await req.json();
  } catch {
    return json({ error: 'bad request' }, 400);
  }

  const { digestId, token, response } = payload;
  if (!digestId || !token || !response || !RESPONSES.has(response as Response$)) {
    return json({ error: 'bad request' }, 400);
  }

  const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // 토큰과 알림 id가 함께 맞아야 한다. 둘 중 하나만으로는 아무것도 되지 않는다.
  const { data: notification } = await admin
    .from('notifications')
    .select('id, user_id, item_ids, sent_at, responded_at, response_token')
    .eq('id', digestId)
    .maybeSingle();

  if (!notification || notification.response_token !== token) {
    return json({ error: 'not found' }, 404);
  }

  const ageHours = (Date.now() - Date.parse(notification.sent_at as string)) / 3_600_000;
  if (ageHours > TOKEN_TTL_HOURS) return json({ error: 'expired' }, 410);

  // 알림을 닫은 것은 응답이 아니다 — 이미 버튼으로 답했다면 덮어쓰지 않는다.
  if (response === 'dismissed' && notification.responded_at) {
    return json({ ok: true, skipped: true });
  }

  const { data: settings } = await admin
    .from('user_settings')
    .select('timezone')
    .eq('user_id', notification.user_id)
    .maybeSingle();

  const timezone = (settings?.timezone as string) ?? 'Asia/Seoul';
  const today = todayIn(timezone, new Date());

  const itemIds = (notification.item_ids as string[]) ?? [];

  if (response === 'bulk_reset') {
    // 밀린 것 전부를 오늘 기준으로. 알림이 다룬 품목에 한정한다.
    const { data: rows } = await admin.from('items').select('*').in('id', itemIds);
    const items = ((rows ?? []) as ItemRow[]).map(rowToItem);
    const byId = new Map((rows ?? []).map((r) => [r.id as string, r.household_id as string]));
    const reset = bulkResetToToday(items, today);
    for (const [i, item] of reset.entries()) {
      if (item === items[i]) continue;
      await writeItem(admin, item, byId.get(item.id)!, 'reset', today);
    }
  } else if (response !== 'ack' && itemIds.length > 0) {
    const { data: rows } = await admin.from('items').select('*').in('id', itemIds);
    for (const row of (rows ?? []) as ItemRow[]) {
      const { next, event } = applyResponse(rowToItem(row), response as Response$, today);
      await writeItem(admin, next, row.household_id, event, today);
    }
  }

  await admin
    .from('notifications')
    .update({ responded_at: new Date().toISOString(), response })
    .eq('id', digestId);

  // 조용한 실패 감지 — 버튼으로 답했다면 푸시는 살아 있다.
  await admin
    .from('user_settings')
    .update({ silent_streak: 0 })
    .eq('user_id', notification.user_id);

  return json({ ok: true, applied: itemIds.length });
});
