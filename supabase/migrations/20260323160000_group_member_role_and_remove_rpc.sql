-- RPCs for membership role changes and removal (direct table writes are not allowed for clients).

create or replace function public.set_group_member_role (
  p_group_id uuid,
  p_user_id uuid,
  p_role text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  me_role text;
  tgt_role text;
begin
  if (select auth.uid()) is null then
    raise exception 'Not authenticated';
  end if;

  if p_role is null or p_role not in ('admin', 'member') then
    raise exception 'Invalid role';
  end if;

  select
    m.role
  into me_role
  from
    public.group_memberships m
  where
    m.group_id = p_group_id
    and m.user_id = (select auth.uid());

  if me_role is null then
    raise exception 'Not a group member';
  end if;

  if me_role <> 'owner' then
    raise exception 'Only the group owner can change roles';
  end if;

  select
    m.role
  into tgt_role
  from
    public.group_memberships m
  where
    m.group_id = p_group_id
    and m.user_id = p_user_id;

  if tgt_role is null then
    raise exception 'Target is not a group member';
  end if;

  if tgt_role = 'owner' then
    raise exception 'Cannot change the owner role';
  end if;

  if tgt_role = p_role then
    return;
  end if;

  update public.group_memberships m
  set
    role = p_role
  where
    m.group_id = p_group_id
    and m.user_id = p_user_id;
end;
$$;

create or replace function public.remove_group_member (p_group_id uuid, p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  me_role text;
  tgt_role text;
begin
  if (select auth.uid()) is null then
    raise exception 'Not authenticated';
  end if;

  select
    m.role
  into me_role
  from
    public.group_memberships m
  where
    m.group_id = p_group_id
    and m.user_id = (select auth.uid());

  if me_role is null then
    raise exception 'Not a group member';
  end if;

  select
    m.role
  into tgt_role
  from
    public.group_memberships m
  where
    m.group_id = p_group_id
    and m.user_id = p_user_id;

  if tgt_role is null then
    raise exception 'Target is not a group member';
  end if;

  if tgt_role = 'owner' then
    raise exception 'Cannot remove the group owner';
  end if;

  if me_role = 'owner' then
    null;
  elsif me_role = 'admin' then
    if tgt_role <> 'member' then
      raise exception 'Admins can only remove members';
    end if;
  else
    raise exception 'Not permitted';
  end if;

  delete from public.group_memberships m
  where
    m.group_id = p_group_id
    and m.user_id = p_user_id;
end;
$$;

revoke all on function public.set_group_member_role (uuid, uuid, text) from public;

revoke all on function public.remove_group_member (uuid, uuid) from public;

grant execute on function public.set_group_member_role (uuid, uuid, text) to authenticated;

grant execute on function public.remove_group_member (uuid, uuid) to authenticated;
