-- Strip Discord's legacy "#0" discriminator suffix from derived usernames.
-- Applies to both backfill candidates and future auth trigger inserts.

do $$
declare
  r record;
  candidate text;
  suffix int;
begin
  for r in
    with discord_candidates as (
      select
        p.user_id,
        p.created_at,
        p.username as current_username,
        nullif(trim(
          coalesce(
            nullif(trim(u.raw_user_meta_data ->> 'username'), ''),
            nullif(trim(u.raw_user_meta_data ->> 'preferred_username'), ''),
            nullif(trim(u.raw_user_meta_data ->> 'global_name'), ''),
            nullif(trim(u.raw_user_meta_data ->> 'user_name'), ''),
            nullif(trim(u.raw_user_meta_data ->> 'name'), '')
          )
        ), '') as raw_identity
      from public.profiles p
      join auth.users u on u.id = p.user_id
      where
        coalesce(u.raw_app_meta_data -> 'providers', '[]'::jsonb) @> '["discord"]'::jsonb
        or lower(coalesce(u.raw_app_meta_data ->> 'provider', '')) = 'discord'
    ),
    derived as (
      select
        user_id,
        created_at,
        current_username,
        nullif(regexp_replace(lower(raw_identity), '[^a-z0-9._-]', '', 'g'), '') as old_slug,
        nullif(
          regexp_replace(
            lower(regexp_replace(raw_identity, '#0\s*$', '', 'i')),
            '[^a-z0-9._-]',
            '',
            'g'
          ),
          ''
        ) as new_slug
      from discord_candidates
    )
    select
      user_id,
      created_at,
      current_username,
      old_slug,
      new_slug
    from derived
    where
      old_slug is not null
      and new_slug is not null
      and old_slug <> new_slug
      and (
        current_username = old_slug
        or current_username like old_slug || '\_%' escape '\'
      )
    order by created_at nulls first, user_id
  loop
    candidate := r.new_slug;
    suffix := 1;
    while exists (
      select 1
      from public.profiles p2
      where p2.user_id <> r.user_id
        and p2.username = candidate
    ) loop
      suffix := suffix + 1;
      candidate := r.new_slug || '_' || suffix::text;
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
  resolved_avatar_url text;
  resolved_discord_user_id text;
  resolved_discord_avatar_hash text;
  candidate text;
  suffix int := 0;
begin
  insert into public.user_roles (user_id, role)
  values (new.id, 'view')
  on conflict (user_id) do nothing;

  base_slug := regexp_replace(
    lower(
      regexp_replace(
        coalesce(
          nullif(trim(new.raw_user_meta_data ->> 'username'), ''),
          nullif(trim(new.raw_user_meta_data ->> 'preferred_username'), ''),
          nullif(trim(new.raw_user_meta_data ->> 'global_name'), ''),
          nullif(trim(new.raw_user_meta_data ->> 'user_name'), ''),
          nullif(trim(new.raw_user_meta_data ->> 'name'), '')
        ),
        '#0\s*$',
        '',
        'i'
      )
    ),
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

  resolved_discord_user_id := nullif(trim(new.raw_user_meta_data ->> 'provider_id'), '');
  resolved_discord_avatar_hash := nullif(trim(new.raw_user_meta_data ->> 'avatar'), '');

  if resolved_discord_user_id is not null and resolved_discord_avatar_hash is not null then
    resolved_avatar_url :=
      'https://cdn.discordapp.com/avatars/'
      || resolved_discord_user_id
      || '/'
      || resolved_discord_avatar_hash
      || case
        when resolved_discord_avatar_hash like 'a\_%' escape '\' then '.gif?size=256'
        else '.png?size=256'
      end;
  else
    resolved_avatar_url := coalesce(
      nullif(trim(new.raw_user_meta_data ->> 'avatar_url'), ''),
      nullif(trim(new.raw_user_meta_data ->> 'picture'), '')
    );
  end if;

  candidate := base_slug;
  loop
    begin
      resolved_username := candidate;
      insert into public.profiles (
        user_id,
        username,
        display_name,
        avatar_url,
        discord_user_id,
        discord_avatar_hash
      )
      values (
        new.id,
        resolved_username,
        resolved_username,
        resolved_avatar_url,
        resolved_discord_user_id,
        resolved_discord_avatar_hash
      )
      on conflict (user_id) do update
      set
        username = excluded.username,
        display_name = excluded.display_name,
        avatar_url = coalesce(excluded.avatar_url, public.profiles.avatar_url),
        discord_user_id = coalesce(excluded.discord_user_id, public.profiles.discord_user_id),
        discord_avatar_hash = coalesce(excluded.discord_avatar_hash, public.profiles.discord_avatar_hash),
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
