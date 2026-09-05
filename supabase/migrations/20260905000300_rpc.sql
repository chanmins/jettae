-- 제때 — RPC
--
-- 초대·참여·나가기처럼 RLS만으로는 표현할 수 없는 동작을 여기에 둔다.
-- 전부 security definer이므로 함수 안에서 권한을 직접 확인한다.

-- ─── 초대 코드 만들기 ──────────────────────────────────────────────────

create or replace function create_household_invite(p_household_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_code text;
  v_try  integer := 0;
begin
  if not is_household_member(p_household_id) then
    raise exception '이 집의 멤버가 아니에요' using errcode = '42501';
  end if;

  -- 헷갈리는 글자(0/O, 1/I)는 뺀다. 사람이 불러주고 받아 적는 코드다.
  loop
    v_try := v_try + 1;
    v_code := (
      select string_agg(
        substr('ABCDEFGHJKLMNPQRSTUVWXYZ23456789',
               (floor(random() * 32) + 1)::int, 1), '')
      from generate_series(1, 6)
    );
    exit when not exists (select 1 from household_invites where code = v_code);
    if v_try > 20 then
      raise exception '코드를 만들지 못했어요';
    end if;
  end loop;

  insert into household_invites (code, household_id, created_by, expires_at)
    values (v_code, p_household_id, auth.uid(), now() + interval '7 days');

  return v_code;
end;
$$;

revoke all on function create_household_invite(uuid) from public;
grant execute on function create_household_invite(uuid) to authenticated;

-- ─── 초대 코드로 참여하기 ──────────────────────────────────────────────
--
-- 참여하면 원래 혼자 쓰던 집은 두고 가족의 집으로 옮겨간다.
-- 혼자 쓰던 집에 물건이 있으면 함께 옮긴다 — 애써 등록한 걸 잃게 하지 않는다.

create or replace function join_household_with_invite(p_code text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_invite   household_invites%rowtype;
  v_user     uuid := auth.uid();
  v_old      uuid;
  v_old_solo boolean;
begin
  if v_user is null then
    raise exception '로그인이 필요해요' using errcode = '42501';
  end if;

  select * into v_invite
    from household_invites
    where code = upper(trim(p_code))
    for update;

  if not found or v_invite.used_at is not null or v_invite.expires_at < now() then
    raise exception '코드가 맞지 않거나 만료됐어요' using errcode = '22023';
  end if;

  if is_household_member(v_invite.household_id) then
    return v_invite.household_id;
  end if;

  -- 지금 혼자 쓰던 집
  select hm.household_id into v_old
    from household_members hm
    where hm.user_id = v_user
    order by hm.joined_at
    limit 1;

  v_old_solo := v_old is not null and (
    select count(*) = 1 from household_members where household_id = v_old
  );

  insert into household_members (household_id, user_id, role)
    values (v_invite.household_id, v_user, 'member')
    on conflict do nothing;

  -- 혼자 쓰던 집의 물건을 가져간다. 남는 빈 집은 지운다.
  if v_old_solo then
    update items        set household_id = v_invite.household_id where household_id = v_old;
    update item_events  set household_id = v_invite.household_id where household_id = v_old;
    update cycle_suggestions set household_id = v_invite.household_id where household_id = v_old;
    delete from household_members where household_id = v_old and user_id = v_user;
    delete from households where id = v_old;
  end if;

  update household_invites
    set used_at = now(), used_by = v_user
    where code = v_invite.code;

  return v_invite.household_id;
end;
$$;

revoke all on function join_household_with_invite(text) from public;
grant execute on function join_household_with_invite(text) to authenticated;

-- ─── 집에서 나가기 ─────────────────────────────────────────────────────
-- 나간 사람에게는 빈 집을 새로 준다. 목록이 사라진 채로 남겨두지 않는다.

create or replace function leave_household()
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user  uuid := auth.uid();
  v_old   uuid;
  v_new   uuid;
begin
  if v_user is null then
    raise exception '로그인이 필요해요' using errcode = '42501';
  end if;

  select household_id into v_old
    from household_members
    where user_id = v_user
    order by joined_at
    limit 1;

  if v_old is null then
    raise exception '속한 집이 없어요' using errcode = '22023';
  end if;

  if (select count(*) from household_members where household_id = v_old) = 1 then
    raise exception '혼자 쓰는 집에서는 나갈 수 없어요' using errcode = '22023';
  end if;

  delete from household_members where household_id = v_old and user_id = v_user;

  insert into households default values returning id into v_new;
  insert into household_members (household_id, user_id, role)
    values (v_new, v_user, 'owner');

  return v_new;
end;
$$;

revoke all on function leave_household() from public;
grant execute on function leave_household() to authenticated;

-- ─── 함께 쓰는 사람 목록 ───────────────────────────────────────────────
-- auth.users를 클라이언트에 열 수는 없으므로 이메일만 뽑아 돌려준다.

create or replace function household_member_list(p_household_id uuid)
returns table (user_id uuid, email text, role text)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not is_household_member(p_household_id) then
    raise exception '이 집의 멤버가 아니에요' using errcode = '42501';
  end if;

  return query
    select hm.user_id, u.email::text, hm.role::text
      from household_members hm
      join auth.users u on u.id = hm.user_id
      where hm.household_id = p_household_id
      order by hm.joined_at;
end;
$$;

revoke all on function household_member_list(uuid) from public;
grant execute on function household_member_list(uuid) to authenticated;
