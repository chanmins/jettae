-- 제때 — 크론이 쓰는 두 설정값을 Vault로 옮긴다
--
-- 호스팅 Supabase의 postgres 역할은 superuser가 아니어서
-- `alter database postgres set app.settings.*`가 42501(permission denied)로 막힌다.
-- 같은 두 값을 Vault에 넣고 읽는 것으로 바꾼다. Vault는 저장할 때 암호화하고
-- 복호화 뷰는 postgres·service_role만 읽으므로, 클라이언트 노출 범위는 이전과 같다.
--
-- 대시보드 SQL 편집기에서 한 번 (값에 <> 괄호는 넣지 않는다):
--
--   select vault.create_secret('https://<project>.supabase.co/functions/v1', 'functions_url');
--   select vault.create_secret('<service_role_key>', 'service_role_key');
--
-- 값을 바꿀 때는 create가 아니라 update다:
--
--   select vault.update_secret(
--            (select id from vault.secrets where name = 'functions_url'),
--            'https://<project>.supabase.co/functions/v1');

create extension if not exists supabase_vault;

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
    from vault.decrypted_secrets where name = 'service_role_key';

  -- superuser로 돌리는 자체 호스팅이라면 예전 방식으로 넣어둔 값도 그대로 받는다.
  v_url := coalesce(nullif(v_url, ''), nullif(current_setting('app.settings.functions_url', true), ''));
  v_key := coalesce(nullif(v_key, ''), nullif(current_setting('app.settings.service_role_key', true), ''));

  if v_url is null or v_key is null then
    raise warning '엣지 함수 설정이 없어요 — Vault에 functions_url / service_role_key를 넣어주세요';
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
