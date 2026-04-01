-- Harden rotate_group_join_code uniqueness under concurrency.

create or replace function public.rotate_group_join_code (p_group_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  me_id uuid;
  me_role text;
  code text;
  attempt int := 0;
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

  if me_role not in ('owner', 'admin') then
    raise exception 'Only owners/admins can rotate invite codes';
  end if;

  loop
    attempt := attempt + 1;
    if attempt > 30 then
      raise exception 'Could not allocate join code';
    end if;

    code := upper(substring(replace(gen_random_uuid()::text, '-', '') from 1 for 8));

    begin
      update public.groups g
      set join_code = code
      where g.id = p_group_id;

      if not found then
        raise exception 'Group not found';
      end if;

      return code;
    exception
      when unique_violation then
        -- Collision with another group rotate/create in flight; retry.
        null;
    end;
  end loop;
end;
$$;

revoke all on function public.rotate_group_join_code (uuid) from public;
grant execute on function public.rotate_group_join_code (uuid) to authenticated;
