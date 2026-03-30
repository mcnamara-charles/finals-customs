-- Build Discord avatar URLs using hash semantics:
-- `a_` hash => animated gif, otherwise png.

update public.profiles p
set
  avatar_url =
    'https://cdn.discordapp.com/avatars/'
    || p.discord_user_id
    || '/'
    || p.discord_avatar_hash
    || case when p.discord_avatar_hash like 'a\_%' escape '\' then '.gif?size=256' else '.png?size=256' end,
  updated_at = now()
where nullif(trim(coalesce(p.discord_user_id, '')), '') is not null
  and nullif(trim(coalesce(p.discord_avatar_hash, '')), '') is not null;

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
