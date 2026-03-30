-- Username on profiles; backfill from legacy first.last; sync display_name; drop first/last names.

alter table public.profiles
  add column if not exists username text;

-- Build globally unique usernames from first.last (lowercase), then display_name / email / id stub.
do $$
declare
  r record;
  candidate text;
  suffix int;
begin
  create temporary table tmp_profile_username_seed (
    user_id uuid primary key,
    created_at timestamptz,
    raw_base text not null
  ) on commit drop;

  insert into tmp_profile_username_seed (user_id, created_at, raw_base)
  select
    p.user_id,
    p.created_at,
    coalesce(
      nullif(
        case
          when nullif(trim(p.first_name), '') is not null
            and nullif(trim(p.last_name), '') is not null then
            lower(
              regexp_replace(
                regexp_replace(trim(p.first_name), '\s+', '', 'g')
                || '.'
                || regexp_replace(trim(p.last_name), '\s+', '', 'g'),
                '[^a-z0-9._-]',
                '',
                'g'
              )
            )
          else null::text
        end,
        ''
      ),
      nullif(
        lower(
          regexp_replace(
            regexp_replace(trim(coalesce(p.display_name, '')), '\s+', '.', 'g'),
            '[^a-z0-9._-]',
            '',
            'g'
          )
        ),
        ''
      ),
      nullif(
        lower(
          regexp_replace(
            split_part(coalesce(u.email, ''), '@', 1),
            '[^a-z0-9._-]',
            '',
            'g'
          )
        ),
        ''
      ),
      'user' || replace(substring(p.user_id::text, 1, 8), '-', '')
    ) as raw_base
  from public.profiles p
  left join auth.users u on u.id = p.user_id;

  create temporary table tmp_profile_username_final (
    user_id uuid primary key,
    final_username text not null unique
  ) on commit drop;

  for r in
    select user_id, raw_base
    from tmp_profile_username_seed
    order by created_at nulls first, user_id
  loop
    candidate := r.raw_base;
    suffix := 1;
    while exists (
      select 1 from tmp_profile_username_final f where f.final_username = candidate
    ) loop
      suffix := suffix + 1;
      candidate := r.raw_base || '_' || suffix::text;
    end loop;

    insert into tmp_profile_username_final (user_id, final_username)
    values (r.user_id, candidate);
  end loop;

  update public.profiles p
  set
    username = f.final_username,
    display_name = f.final_username
  from tmp_profile_username_final f
  where p.user_id = f.user_id;
end $$;

alter table public.profiles
  alter column username set not null;

create unique index if not exists profiles_username_key on public.profiles (username);

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

  base_slug := lower(
    regexp_replace(
      coalesce(nullif(trim(new.raw_user_meta_data ->> 'username'), ''), ''),
      '[^a-z0-9._-]',
      '',
      'g'
    )
  );

  if base_slug is null or base_slug = '' then
    base_slug := lower(
      regexp_replace(
        split_part(coalesce(new.email, ''), '@', 1),
        '[^a-z0-9._-]',
        '',
        'g'
      )
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

alter table public.profiles drop column if exists first_name;
alter table public.profiles drop column if exists last_name;
