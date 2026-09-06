/**
 * push-health — 조용한 실패를 찾아낸다
 *
 * 방해금지, 폰 교체, 권한 해제. 서버는 발송 성공으로 기록하지만 사용자에게는 닿지 않고,
 * 아무도 에러를 보지 못한다. 알림이 곧 제품인 앱에서 가장 위험한 실패 방식이다.
 *
 * 하루 한 번 돌면서 3회 연속 무응답인 사용자를 찾아 표시하고, 이메일을 한 번 보낸다.
 * 메일 발송 키가 없으면 표시만 한다 — 앱 안 배너가 같은 사실을 보여준다.
 */
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { isCronRequest } from '../_shared/cronAuth.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const RESEND_KEY = Deno.env.get('RESEND_API_KEY') ?? '';
const MAIL_FROM = Deno.env.get('MAIL_FROM') ?? '제때 <hello@example.com>';
const APP_URL = Deno.env.get('APP_URL') ?? '';

/** 이만큼 연속으로 답이 없으면 푸시가 죽은 것으로 본다. */
const SILENT_THRESHOLD = 3;
/** 최근 이 기간의 알림만 본다. */
const WINDOW_DAYS = 30;

interface NotificationRow {
  id: string;
  user_id: string;
  responded_at: string | null;
  sent_at: string;
  kind: string;
}

async function sendRecoveryEmail(email: string): Promise<boolean> {
  if (!RESEND_KEY) return false;
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${RESEND_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: MAIL_FROM,
        to: [email],
        subject: '알림이 안 가고 있는 것 같아요',
        text: [
          '알림이 안 가고 있는 것 같아요.',
          '',
          '알림을 다시 켜주시면 이어서 알려드릴게요.',
          APP_URL ? `\n다시 켜기: ${APP_URL}/settings` : '',
        ].join('\n'),
      }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

Deno.serve(async (req) => {
  if (!isCronRequest(req, SERVICE_KEY)) {
    return new Response(JSON.stringify({ error: 'unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const since = new Date(Date.now() - WINDOW_DAYS * 86_400_000).toISOString();
  const { data, error } = await admin
    .from('notifications')
    .select('id, user_id, responded_at, sent_at, kind')
    .gte('sent_at', since)
    .order('sent_at', { ascending: false })
    .limit(5000);

  if (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // 사용자별로 최근 알림부터 훑어 연속 무응답을 센다.
  const streaks = new Map<string, number>();
  const done = new Set<string>();
  for (const row of (data ?? []) as NotificationRow[]) {
    if (done.has(row.user_id)) continue;
    // 응답을 받을 수 없는 종류는 세지 않는다.
    if (row.kind === 'add_more' || row.kind === 'pre') continue;
    if (row.responded_at) {
      done.add(row.user_id);
      streaks.set(row.user_id, 0);
      continue;
    }
    streaks.set(row.user_id, (streaks.get(row.user_id) ?? 0) + 1);
  }

  let flagged = 0;
  let mailed = 0;

  for (const [userId, streak] of streaks) {
    const { data: current } = await admin
      .from('user_settings')
      .select('silent_streak')
      .eq('user_id', userId)
      .maybeSingle();

    const before = (current?.silent_streak as number) ?? 0;
    await admin.from('user_settings').update({ silent_streak: streak }).eq('user_id', userId);

    if (streak < SILENT_THRESHOLD) continue;
    flagged++;

    // 이메일은 딱 한 번. 임계값을 갓 넘긴 순간에만 보낸다.
    if (before >= SILENT_THRESHOLD) continue;

    const { data: user } = await admin.auth.admin.getUserById(userId);
    const email = user?.user?.email;
    // 익명 계정에는 보낼 곳이 없다. 앱 안 배너가 대신한다.
    if (!email) continue;
    if (await sendRecoveryEmail(email)) mailed++;
  }

  return new Response(JSON.stringify({ checked: streaks.size, flagged, mailed }), {
    headers: { 'Content-Type': 'application/json' },
  });
});
