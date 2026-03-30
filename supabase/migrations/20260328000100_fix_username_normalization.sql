-- Repair usernames affected by uppercase-stripping normalization order.
-- Also updates handle_new_user to normalize with lower() before regex filtering.

do $$
declare
  r record;
  candidate text;
  suffix int;
begin
  for r in
    with name_candidates as (
      select
        p.user_id,
        p.created_at,
        p.username as current_username,
        nullif(trim(u.raw_user_meta_data ->> 'first_name'), '') as first_name_raw,
        nullif(trim(u.raw_user_meta_data ->> 'last_name'), '') as last_name_raw
      from public.profiles p
      join auth.users u on u.id = p.user_id
    ),
    recomputed as (
      select
        user_id,
        created_at,
        current_username,
        nullif(
          lower(
            regexp_replace(
              regexp_replace(first_name_raw, '\s+', '', 'g')
              || '.'
              || regexp_replace(last_name_raw, '\s+', '', 'g'),
              '[^a-z0-9._-]',
              '',
              'g'
            )
          ),
          ''
        ) as buggy_username,
        nullif(
          regexp_replace(
            lower(
              regexp_replace(first_name_raw, '\s+', '', 'g')
              || '.'
              || regexp_replace(last_name_raw, '\s+', '', 'g')
            ),
            '[^a-z0-9._-]',
            '',
            'g'
          ),
          ''
        ) as fixed_username
      from name_candidates
      where first_name_raw is not null and last_name_raw is not null
    )
    select
      user_id,
      created_at,
      current_username,
      fixed_username
    from recomputed
    where current_username = buggy_username
      and fixed_username is not null
      and fixed_username <> buggy_username
    order by created_at nulls first, user_id
  loop
    candidate := r.fixed_username;
    suffix := 1;
    while exists (
      select 1
      from public.profiles p2
      where p2.user_id <> r.user_id
        and p2.username = candidate
    ) loop
      suffix := suffix + 1;
      candidate := r.fixed_username || '_' || suffix::text;
    end loop;

    update public.profiles
    set
      username = candidate,
      display_name = candidate,
      updated_at = now()
    where user_id = r.user_id;
  end loop;
end $$;

create or replace function public.handle_new_user ()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  default_gid uuid;
  base_slug text;
  resolved_username text;
  candidate text;
  suffix int := 0;
begin
  insert into public.user_roles (user_id, role)
  values (new.id, 'view')
  on conflict (user_id) do nothing;

  base_slug := regexp_replace(
    lower(coalesce(nullif(trim(new.raw_user_meta_data ->> 'username'), ''), '')),
    '[^a-z0-9._-]',
    '',
    'g'
  );

  if base_slug is null or base_slug = '' then
    base_slug := regexp_replace(
      lower(split_part(coalesce(new.email, ''), '@', 1)),
      '[^a-z0-9._-]',
      '',
      'g'
    );
  end if;

  if base_slug is null or base_slug = '' then
    base_slug := 'member';
  end if;

  candidate := base_slug;
  loop
    begin
      resolved_username := candidate;
      insert into public.profiles (user_id, username, display_name, avatar_url)
      values (
        new.id,
        resolved_username,
        resolved_username,
        nullif(trim(new.raw_user_meta_data ->> 'avatar_url'), '')
      )
      on conflict (user_id) do update
      set
        username = excluded.username,
        display_name = excluded.display_name,
        avatar_url = excluded.avatar_url,
        updated_at = now();
      exit;
    exception
      when unique_violation then
        suffix := suffix + 1;
        candidate := base_slug || '_' || suffix::text;
    end;
  end loop;

  select c.value_uuid
  into default_gid
  from public.internal_app_config c
  where c.key = 'default_group_id'
  limit 1;

  if default_gid is not null then
    insert into public.group_memberships (group_id, user_id, role)
    values (default_gid, new.id, 'member')
    on conflict (group_id, user_id) do nothing;
  end if;

  return new;
end;
$$;
