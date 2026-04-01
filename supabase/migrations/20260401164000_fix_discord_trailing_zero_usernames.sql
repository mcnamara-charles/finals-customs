-- Fix Discord usernames that leaked as trailing "0" (from legacy "#0" handling).
-- Also harden handle_new_user to normalize this path for future signups.

do $$
declare
  r record;
  candidate text;
  suffix int;
begin
  for r in
    with discord_users as (
      select
        p.user_id,
        p.created_at,
        p.username as current_username,
        nullif(trim(u.raw_user_meta_data ->> 'discriminator'), '') as discriminator
      from public.profiles p
      join auth.users u on u.id = p.user_id
      where
        (
          coalesce(u.raw_app_meta_data -> 'providers', '[]'::jsonb) @> '["discord"]'::jsonb
          or lower(coalesce(u.raw_app_meta_data ->> 'provider', '')) = 'discord'
        )
        and p.username ~ '0$'
    )
    select
      user_id,
      current_username,
      regexp_replace(current_username, '0$', '') as trimmed_username
    from discord_users
    where
      discriminator = '0'
      and length(regexp_replace(current_username, '0$', '')) > 0
  loop
    candidate := r.trimmed_username;
    suffix := 1;
    while exists (
      select 1
      from public.profiles p2
      where p2.user_id <> r.user_id
        and p2.username = candidate
    ) loop
      suffix := suffix + 1;
      candidate := r.trimmed_username || '_' || suffix::text;
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
  raw_identity text;
  raw_discriminator text;
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

  raw_identity := coalesce(
    nullif(trim(new.raw_user_meta_data ->> 'username'), ''),
    nullif(trim(new.raw_user_meta_data ->> 'preferred_username'), ''),
    nullif(trim(new.raw_user_meta_data ->> 'global_name'), ''),
    nullif(trim(new.raw_user_meta_data ->> 'user_name'), ''),
    nullif(trim(new.raw_user_meta_data ->> 'name'), '')
  );
  raw_discriminator := nullif(trim(new.raw_user_meta_data ->> 'discriminator'), '');

  if raw_identity is not null then
    raw_identity := regexp_replace(raw_identity, '#0\s*$', '', 'i');
    if raw_discriminator = '0' then
      raw_identity := regexp_replace(raw_identity, '0$', '');
    end if;
  end if;

  base_slug := regexp_replace(
    lower(coalesce(raw_identity, '')),
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
