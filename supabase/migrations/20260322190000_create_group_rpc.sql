-- Authenticated users can create a group and become owner (SECURITY DEFINER).

create or replace function public.create_group (p_name text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  new_id uuid;
  code text;
  attempt int := 0;
  uid uuid;
  trimmed text;
begin
  uid := auth.uid();
  if uid is null then
    raise exception 'Not authenticated';
  end if;

  trimmed := trim(p_name);
  if trimmed = '' then
    raise exception 'Group name required';
  end if;

  loop
    code := upper(substring(replace(gen_random_uuid()::text, '-', '') from 1 for 8));
    exit when not exists (select 1 from public.groups g where g.join_code = code);
    attempt := attempt + 1;
    if attempt > 20 then
      raise exception 'Could not allocate join code';
    end if;
  end loop;

  insert into public.groups (name, join_code, created_by)
  values (trimmed, code, uid)
  returning id into new_id;

  insert into public.group_memberships (group_id, user_id, role)
  values (new_id, uid, 'owner');

  return new_id;
end;
$$;

revoke all on function public.create_group (text) from public;
grant execute on function public.create_group (text) to authenticated;
