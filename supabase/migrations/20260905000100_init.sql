-- 제때 — 초기 스키마
--
-- 설계 원칙 셋:
--  1. 한 집(household)이 소유 단위다. 혼자 쓰면 1인 가구, 가족 공유는 멤버가 늘 뿐이다.
--  2. RLS를 모든 테이블에 건다. anon 키가 클라이언트에 노출되므로 정책이 곧 보안이다.
--  3. next_due는 파생값이지만 컬럼으로 둔다 — 알림 배치가 인덱스로 대상자를 골라야 한다.

create extension if not exists pgcrypto;

-- ─── 집 ────────────────────────────────────────────────────────────────

create table households (
  id          uuid primary key default gen_random_uuid(),
  name        text not null default '우리 집',
  created_at  timestamptz not null default now()
);

create type household_role as enum ('owner', 'member');

create table household_members (
  household_id uuid not null references households(id) on delete cascade,
  user_id      uuid not null references auth.users(id) on delete cascade,
  role         household_role not null default 'member',
  joined_at    timestamptz not null default now(),
  primary key (household_id, user_id)
);

create index household_members_user_idx on household_members (user_id, joined_at);

create table household_invites (
  code         text primary key,
  household_id uuid not null references households(id) on delete cascade,
  created_by   uuid not null references auth.users(id) on delete cascade,
  created_at   timestamptz not null default now(),
  expires_at   timestamptz not null,
  used_at      timestamptz,
  used_by      uuid references auth.users(id) on delete set null
);

create index household_invites_household_idx on household_invites (household_id);

-- ─── 설정 ──────────────────────────────────────────────────────────────

create table user_settings (
  user_id       uuid primary key references auth.users(id) on delete cascade,
  notify_at     time not null default '20:00',
  timezone      text not null default 'Asia/Seoul',
  dormant_from  date,
  dormant_until date,
  onboarded_at  timestamptz,
  -- 하루 한 건을 지키기 위한 값. 사용자의 로컬 날짜 기준이다.
  last_digest_on date,
  -- 조용한 실패 감지 — 연속 무응답 횟수
  silent_streak  integer not null default 0,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint dormant_range check (dormant_until is null or dormant_from is null or dormant_until >= dormant_from)
);

-- ─── 카탈로그 ──────────────────────────────────────────────────────────
-- 앱 번들에도 들어 있어 오프라인 등록이 되지만, 서버에도 둔다.
-- 알림 문구를 서버에서 만들고, 응답 데이터로 주기를 보정하려면 서버가 알아야 한다.

create table catalog (
  code            text primary key,
  name            text not null,
  zone            text not null,
  input_type      text not null check (input_type in ('list', 'pao')),
  metric          text not null check (metric in ('time', 'usage')),
  cycle_days      integer not null check (cycle_days > 0),
  cycle_usage     integer check (cycle_usage is null or cycle_usage > 0),
  unit            text,
  season          text not null default 'all' check (season in ('all', 'summer', 'winter')),
  safety_locked   boolean not null default false,
  onboarding_pick boolean not null default false,
  note            text
);

-- ─── 품목 ──────────────────────────────────────────────────────────────

create table items (
  id              uuid primary key,
  household_id    uuid not null references households(id) on delete cascade,
  catalog_code    text references catalog(code) on delete set null,
  name            text not null,
  zone            text not null,
  input_type      text not null default 'list' check (input_type in ('list', 'pao')),
  metric          text not null default 'time' check (metric in ('time', 'usage')),
  season          text not null default 'all' check (season in ('all', 'summer', 'winter')),
  safety_locked   boolean not null default false,

  cycle_days      integer not null check (cycle_days > 0),
  cycle_source    text not null default 'catalog' check (cycle_source in ('catalog', 'user', 'auto')),
  cycle_usage     integer,
  unit            text,

  base_date       date not null,
  base_usage      numeric,
  defer_days      integer not null default 0 check (defer_days >= 0),
  -- 파생값(base_date + cycle_days + defer_days). 클라이언트가 계산해 보낸다.
  next_due        date not null,

  group_count     integer not null default 1 check (group_count > 0),
  status          text not null default 'active' check (status in ('active', 'paused', 'archived')),
  pause_reason    text check (pause_reason is null or pause_reason in ('season', 'muted')),
  paused_at       date,
  season_asked_at date,

  ignore_streak   integer not null default 0 check (ignore_streak >= 0),
  last_stage      text check (last_stage is null or last_stage in ('pre', 'due', 'followup', 'final')),
  last_stage_due  date,

  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- 알림 배치의 유일한 조회 경로 — 활성 품목을 예정일 순으로.
create index items_due_idx on items (next_due) where status = 'active';
create index items_household_idx on items (household_id);
create index items_season_idx on items (season) where season <> 'all';

-- ─── 교체 이력 ─────────────────────────────────────────────────────────
-- 자기교정의 원천이자, 카탈로그를 현실에 맞춰 보정할 데이터다.

create table item_events (
  id           uuid primary key,
  item_id      uuid not null references items(id) on delete cascade,
  household_id uuid not null references households(id) on delete cascade,
  type         text not null check (
                 type in ('replaced', 'snoozed', 'still_good', 'ignored',
                          'season_start', 'reset', 'renewed', 'cycle_changed')),
  -- 사건이 일어난 '날'. 소급 입력이 가능하므로 at과 다를 수 있다.
  on_date      date not null,
  at           timestamptz not null default now(),
  meta         jsonb
);

create index item_events_item_idx on item_events (item_id, at);
create index item_events_household_idx on item_events (household_id);

-- ─── 알림 ──────────────────────────────────────────────────────────────

create table notifications (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  item_ids      uuid[] not null default '{}',
  kind          text not null,
  stage         text check (stage is null or stage in ('pre', 'due', 'followup', 'final')),
  title         text not null,
  body          text not null,
  -- 서비스워커에는 세션이 없다. 이 토큰이 응답의 유일한 인증 수단이다.
  response_token text not null,
  sent_at       timestamptz not null default now(),
  responded_at  timestamptz,
  response      text,
  -- 발송 자체가 실패한 경우(구독 만료 등)
  delivery_error text
);

create index notifications_user_idx on notifications (user_id, sent_at desc);
create unique index notifications_token_idx on notifications (response_token);

create table push_subscriptions (
  endpoint    text primary key,
  user_id     uuid not null references auth.users(id) on delete cascade,
  p256dh      text not null,
  auth        text not null,
  platform    text not null default 'web',
  created_at  timestamptz not null default now(),
  -- 발송이 연속으로 실패하면 정리 대상이다
  fail_count  integer not null default 0
);

create index push_subscriptions_user_idx on push_subscriptions (user_id);

-- ─── 자기교정 제안 ─────────────────────────────────────────────────────
-- 임의로 바꾸지 않고 제안한다. 사용자 모르게 주기가 달라지면 앱을 신뢰할 수 없게 된다.

create table cycle_suggestions (
  item_id         uuid primary key references items(id) on delete cascade,
  household_id    uuid not null references households(id) on delete cascade,
  reason          text not null check (reason in ('history', 'still_good')),
  current_days    integer not null,
  suggested_days  integer not null,
  created_at      timestamptz not null default now(),
  resolved_at     timestamptz,
  accepted        boolean
);

-- ─── updated_at 자동 갱신 ──────────────────────────────────────────────

create or replace function touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger items_touch before update on items
  for each row execute function touch_updated_at();
create trigger user_settings_touch before update on user_settings
  for each row execute function touch_updated_at();

-- ─── 가입 시 집과 설정을 만들어 준다 ───────────────────────────────────
-- 클라이언트가 두 번 왕복하지 않아도 되고, 실패 지점이 하나 줄어든다.

create or replace function handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  new_household uuid;
begin
  insert into households default values returning id into new_household;
  insert into household_members (household_id, user_id, role)
    values (new_household, new.id, 'owner');
  insert into user_settings (user_id) values (new.id)
    on conflict (user_id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();
