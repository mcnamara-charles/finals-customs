-- First-time Discord OAuth users must confirm username in-app; email and legacy users stay completed.

alter table public.profiles
  add column if not exists username_onboarding_completed boolean not null default true;

comment on column public.profiles.username_onboarding_completed is
  'When false, client shows blocking username confirmation (Discord first sign-in). Email signups default true.';

-- Replace 1-arg RPC so single-argument calls resolve to (text, uuid) with default second param.
drop function if exists public.is_signup_username_available (text);

create or replace function public.is_signup_username_available (
  p_username text,
  p_exclude_user_id uuid default null
)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  norm text;
begin
  norm := regexp_replace(
    lower(trim(coalesce(p_username, ''))),
    '[^a-z0-9._-]',
    '',
    'g'
  );

  if norm is null or norm = '' then
    return false;
  end if;

  return not exists (
    select 1
    from public.profiles p
    where
      p.username = norm
      and (
        p_exclude_user_id is null
        or p.user_id is distinct from p_exclude_user_id
      )
  );
end;
$$;

revoke all on function public.is_signup_username_available (text, uuid) from public;
grant execute on function public.is_signup_username_available (text, uuid) to anon, authenticated;

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
  is_discord_signup boolean;
  onboarding_completed boolean;
begin
  insert into public.user_roles (user_id, role)
  values (new.id, 'view')
  on conflict (user_id) do nothing;

  is_discord_signup :=
    coalesce(new.raw_app_meta_data -> 'providers', '[]'::jsonb) @> '["discord"]'::jsonb
    or lower(coalesce(new.raw_app_meta_data ->> 'provider', '')) = 'discord';

  onboarding_completed := not is_discord_signup;

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
        discord_avatar_hash,
        username_onboarding_completed
      )
      values (
        new.id,
        resolved_username,
        resolved_username,
        resolved_avatar_url,
        resolved_discord_user_id,
        resolved_discord_avatar_hash,
        onboarding_completed
      )
      on conflict (user_id) do update
      set
        username = excluded.username,
        display_name = excluded.display_name,
        avatar_url = coalesce(excluded.avatar_url, public.profiles.avatar_url),
        discord_user_id = coalesce(excluded.discord_user_id, public.profiles.discord_user_id),
        discord_avatar_hash = coalesce(excluded.discord_avatar_hash, public.profiles.discord_avatar_hash),
        username_onboarding_completed = case
          when public.profiles.username_onboarding_completed then true
          else excluded.username_onboarding_completed
        end,
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
