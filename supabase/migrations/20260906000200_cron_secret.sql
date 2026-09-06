-- 제때 — 크론 호출 인증을 cron_secret으로 옮긴다
--
-- 엣지 함수가 비교하던 SUPABASE_SERVICE_ROLE_KEY는 Supabase가 주입하는 값이고,
-- 프로젝트의 API 키 체계에 따라 형식이 달라진다(레거시 JWT / sb_secret_…).
-- 대시보드의 service_role 키를 정확히 넣어도 주입값과 달라 401이 났다.
-- 그래서 크론과 함수가 맞춰 볼 비밀을 우리가 정한 cron_secret으로 바꾼다.
--
-- Vault에 cron_secret이 없으면 예전대로 service_role_key를 보낸다 —
-- CRON_SECRET을 설정하지 않은 환경도 그대로 돈다.

create or replace function invoke_edge_function(fn text)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_url text;
  v_key text;
begin
  select decrypted_secret into v_url
    from vault.decrypted_secrets where name = 'functions_url';

  select decrypted_secret into v_key
    from vault.decrypted_secrets where name = 'cron_secret';
  if nullif(v_key, '') is null then
    select decrypted_secret into v_key
      from vault.decrypted_secrets where name = 'service_role_key';
  end if;

  -- superuser로 돌리는 자체 호스팅이라면 예전 방식으로 넣어둔 값도 그대로 받는다.
  v_url := coalesce(nullif(v_url, ''), nullif(current_setting('app.settings.functions_url', true), ''));
  v_key := coalesce(nullif(v_key, ''), nullif(current_setting('app.settings.service_role_key', true), ''));

  if v_url is null or v_key is null then
    raise warning '엣지 함수 설정이 없어요 — Vault에 functions_url / cron_secret을 넣어주세요';
    return null;
  end if;

  return net.http_post(
    url     := v_url || '/' || fn,
    headers := jsonb_build_object(
                 'Content-Type', 'application/json',
                 'Authorization', 'Bearer ' || v_key),
    body    := '{}'::jsonb,
    timeout_milliseconds := 55000
  );
end;
$$;

revoke all on function invoke_edge_function(text) from public;
