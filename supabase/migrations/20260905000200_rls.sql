-- 제때 — Row Level Security
--
-- anon 키는 클라이언트 번들 안에 그대로 들어간다. 그러므로 이 파일이 곧 보안 경계다.
-- 원칙: 내 집(household)의 것만 읽고 쓴다. 카탈로그만 모두에게 읽기 공개.

alter table households          enable row level security;
alter table household_members   enable row level security;
alter table household_invites   enable row level security;
alter table user_settings       enable row level security;
alter table catalog             enable row level security;
alter table items               enable row level security;
alter table item_events         enable row level security;
alter table notifications       enable row level security;
alter table push_subscriptions  enable row level security;
alter table cycle_suggestions   enable row level security;

-- 내가 이 집의 멤버인가.
-- security definer로 두어 household_members 정책이 자기 자신을 다시 평가하는
-- 재귀를 끊는다. 이게 없으면 정책 평가가 무한히 돈다.
create or replace function is_household_member(target uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from household_members
    where household_id = target and user_id = auth.uid()
  );
$$;

revoke all on function is_household_member(uuid) from public;
grant execute on function is_household_member(uuid) to authenticated;

-- ─── households ────────────────────────────────────────────────────────

create policy households_select on households
  for select using (is_household_member(id));

-- 집은 가입 트리거와 RPC만 만든다. 클라이언트가 직접 만들 일이 없다.

-- ─── household_members ─────────────────────────────────────────────────

create policy household_members_select on household_members
  for select using (is_household_member(household_id));

-- 나가기는 자기 행만. 참여는 초대 RPC를 통해서만 이뤄진다.
create policy household_members_delete on household_members
  for delete using (user_id = auth.uid());

-- ─── household_invites ─────────────────────────────────────────────────
-- 코드로 조회하는 것은 RPC(security definer)가 대신한다.
-- 여기서는 내 집의 초대만 보이게 한다.

create policy household_invites_select on household_invites
  for select using (is_household_member(household_id));

create policy household_invites_delete on household_invites
  for delete using (created_by = auth.uid());

-- ─── user_settings ─────────────────────────────────────────────────────

create policy user_settings_select on user_settings
  for select using (user_id = auth.uid());
create policy user_settings_insert on user_settings
  for insert with check (user_id = auth.uid());
create policy user_settings_update on user_settings
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ─── catalog ───────────────────────────────────────────────────────────
-- 159종은 비밀이 아니다. 읽기만 열고 쓰기는 마이그레이션으로만.

create policy catalog_select on catalog
  for select using (true);

-- ─── items ─────────────────────────────────────────────────────────────

create policy items_select on items
  for select using (is_household_member(household_id));
create policy items_insert on items
  for insert with check (is_household_member(household_id));
create policy items_update on items
  for update using (is_household_member(household_id))
  with check (is_household_member(household_id));
create policy items_delete on items
  for delete using (is_household_member(household_id));

-- ─── item_events ───────────────────────────────────────────────────────
-- 이력은 고치지 않는다. 넣고 읽을 뿐이다.

create policy item_events_select on item_events
  for select using (is_household_member(household_id));
create policy item_events_insert on item_events
  for insert with check (is_household_member(household_id));
create policy item_events_delete on item_events
  for delete using (is_household_member(household_id));

-- ─── notifications ─────────────────────────────────────────────────────
-- 발송은 서버(service_role)만 한다. 사용자는 자기 것을 읽기만 한다.

create policy notifications_select on notifications
  for select using (user_id = auth.uid());

-- ─── push_subscriptions ────────────────────────────────────────────────

create policy push_subscriptions_select on push_subscriptions
  for select using (user_id = auth.uid());
create policy push_subscriptions_insert on push_subscriptions
  for insert with check (user_id = auth.uid());
create policy push_subscriptions_update on push_subscriptions
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy push_subscriptions_delete on push_subscriptions
  for delete using (user_id = auth.uid());

-- ─── cycle_suggestions ─────────────────────────────────────────────────

create policy cycle_suggestions_select on cycle_suggestions
  for select using (is_household_member(household_id));
create policy cycle_suggestions_update on cycle_suggestions
  for update using (is_household_member(household_id))
  with check (is_household_member(household_id));
create policy cycle_suggestions_delete on cycle_suggestions
  for delete using (is_household_member(household_id));
