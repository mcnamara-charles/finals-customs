-- Add RPCs for self-service leave-group and ownership transfer.

create or replace function public.leave_group (p_group_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  me_id uuid;
  me_role text;
begin
  me_id := (select auth.uid());
  if me_id is null then
    raise exception 'Not authenticated';
  end if;

  select m.role
  into me_role
  from public.group_memberships m
  where m.group_id = p_group_id
    and m.user_id = me_id;

  if me_role is null then
    raise exception 'Not a group member';
  end if;

  if me_role = 'owner' then
    raise exception 'Owner must transfer ownership before leaving';
  end if;

  delete from public.group_memberships m
  where m.group_id = p_group_id
    and m.user_id = me_id;
end;
$$;

create or replace function public.transfer_group_ownership (
  p_group_id uuid,
  p_new_owner_user_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  me_id uuid;
  me_role text;
  target_role text;
begin
  me_id := (select auth.uid());
  if me_id is null then
    raise exception 'Not authenticated';
  end if;

  if p_new_owner_user_id is null then
    raise exception 'Missing new owner id';
  end if;

  if p_new_owner_user_id = me_id then
    return;
  end if;

  select m.role
  into me_role
  from public.group_memberships m
  where m.group_id = p_group_id
    and m.user_id = me_id;

  if me_role is null then
    raise exception 'Not a group member';
  end if;

  if me_role <> 'owner' then
    raise exception 'Only the current owner can transfer ownership';
  end if;

  select m.role
  into target_role
  from public.group_memberships m
  where m.group_id = p_group_id
    and m.user_id = p_new_owner_user_id;

  if target_role is null then
    raise exception 'Target is not a group member';
  end if;

  if target_role = 'owner' then
    return;
  end if;

  update public.group_memberships m
  set role = 'owner'
  where m.group_id = p_group_id
    and m.user_id = p_new_owner_user_id;

  update public.group_memberships m
  set role = 'admin'
  where m.group_id = p_group_id
    and m.user_id = me_id;
end;
$$;

revoke all on function public.leave_group (uuid) from public;
revoke all on function public.transfer_group_ownership (uuid, uuid) from public;

grant execute on function public.leave_group (uuid) to authenticated;
grant execute on function public.transfer_group_ownership (uuid, uuid) to authenticated;
