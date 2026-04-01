-- Allow owner/admin to rename an existing group.

create or replace function public.set_group_name (
  p_group_id uuid,
  p_name text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  me_id uuid;
  me_role text;
  next_name text;
begin
  me_id := auth.uid();
  if me_id is null then
    raise exception 'Not authenticated';
  end if;

  next_name := btrim(coalesce(p_name, ''));
  if next_name = '' then
    raise exception 'Group name is required';
  end if;

  select m.role
  into me_role
  from public.group_memberships m
  where m.group_id = p_group_id
    and m.user_id = me_id;

  if me_role is null then
    raise exception 'Not a group member';
  end if;

  if me_role not in ('owner', 'admin') then
    raise exception 'Only owners/admins can rename this group';
  end if;

  update public.groups g
  set name = next_name
  where g.id = p_group_id;

  if not found then
    raise exception 'Group not found';
  end if;
end;
$$;

revoke all on function public.set_group_name (uuid, text) from public;
grant execute on function public.set_group_name (uuid, text) to authenticated;
