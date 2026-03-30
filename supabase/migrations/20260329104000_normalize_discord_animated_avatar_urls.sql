-- Normalize Discord animated avatar URLs to static PNG URLs to avoid GIF 403 issues.
-- Also updates handle_new_user so future profile rows are stored with normalized avatar URLs.

update public.profiles
set
  avatar_url = regexp_replace(avatar_url, '\.gif(\?.*)?$', '.png?size=256', 'i'),
  updated_at = now()
where avatar_url ~* '^https://(?:cdn|media)\.discordapp\.(?:com|net)/avatars/.+/a_[^/?]+\.gif(?:\?.*)?$';

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

  resolved_avatar_url := coalesce(
    nullif(trim(new.raw_user_meta_data ->> 'avatar_url'), ''),
    nullif(trim(new.raw_user_meta_data ->> 'picture'), ''),
    case
      when nullif(trim(new.raw_user_meta_data ->> 'provider_id'), '') is not null
        and nullif(trim(new.raw_user_meta_data ->> 'avatar'), '') is not null
      then
        'https://cdn.discordapp.com/avatars/'
        || trim(new.raw_user_meta_data ->> 'provider_id')
        || '/'
        || trim(new.raw_user_meta_data ->> 'avatar')
        || '.png?size=256'
      else null
    end
  );

  if resolved_avatar_url ~* '^https://(?:cdn|media)\.discordapp\.(?:com|net)/avatars/.+/a_[^/?]+\.gif(?:\?.*)?$' then
    resolved_avatar_url := regexp_replace(resolved_avatar_url, '\.gif(\?.*)?$', '.png?size=256', 'i');
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
        resolved_avatar_url
      )
      on conflict (user_id) do update
      set
        username = excluded.username,
        display_name = excluded.display_name,
        avatar_url = coalesce(excluded.avatar_url, public.profiles.avatar_url),
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
