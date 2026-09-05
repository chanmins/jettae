-- 제때 — 알림 배치 스케줄
--
-- 5분마다 notify-dispatch를 부른다. 함수 안에서 "지금이 이 사용자의 발송 시각인가"를
-- 판정하므로, 사용자가 시각을 어떻게 정하든 5분 오차 안에서 맞는다.
--
-- 실행 전에 아래 두 설정값을 넣어야 한다(대시보드 SQL 편집기에서 한 번):
--
--   alter database postgres set app.settings.functions_url = 'https://<project>.supabase.co/functions/v1';
--   alter database postgres set app.settings.service_role_key = '<service_role_key>';
--
-- service_role 키가 DB 설정에 들어가지만, 이 값을 읽을 수 있는 것은 superuser뿐이고
-- 클라이언트에는 어떤 경로로도 노출되지 않는다.

create extension if not exists pg_cron;
create extension if not exists pg_net;

create or replace function invoke_edge_function(fn text)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_url text := current_setting('app.settings.functions_url', true);
  v_key text := current_setting('app.settings.service_role_key', true);
begin
  if v_url is null or v_key is null then
    raise warning '엣지 함수 설정이 없어요 — app.settings.functions_url / service_role_key';
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

-- 5분마다 — 발송 슬롯 판정은 함수 안에서 한다
select cron.schedule(
  'jettae-notify-dispatch',
  '*/5 * * * *',
  $$ select invoke_edge_function('notify-dispatch'); $$
);

-- 하루 한 번 — 조용한 실패(푸시가 죽었는데 아무도 모르는 상태) 감지
select cron.schedule(
  'jettae-push-health',
  '17 3 * * *',
  $$ select invoke_edge_function('push-health'); $$
);

-- 만료된 초대 코드 정리
select cron.schedule(
  'jettae-expire-invites',
  '33 4 * * *',
  $$ delete from household_invites where expires_at < now() - interval '7 days'; $$
);
