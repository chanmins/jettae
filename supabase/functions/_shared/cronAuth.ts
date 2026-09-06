/**
 * 크론 호출 인증.
 *
 * Supabase가 주입하는 SUPABASE_SERVICE_ROLE_KEY는 프로젝트의 API 키 체계에 따라
 * 형식이 달라진다(레거시 JWT / sb_secret_…). 그 값을 크론이 알아낼 방법은 없으므로,
 * 맞춰 볼 비밀은 CRON_SECRET으로 따로 둔다 — 양쪽에 같은 값을 넣으면 그만이다.
 *
 * CRON_SECRET이 없는 환경에서는 예전처럼 service_role 키로도 통과시킨다.
 */
const CRON_SECRET = Deno.env.get('CRON_SECRET') ?? '';

export function isCronRequest(req: Request, serviceKey: string): boolean {
  const auth = req.headers.get('Authorization') ?? '';
  const accepted = [CRON_SECRET, serviceKey].filter((v) => v !== '');
  return accepted.some((v) => auth === `Bearer ${v}`);
}
