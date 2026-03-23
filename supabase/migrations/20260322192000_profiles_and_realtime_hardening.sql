-- Add profile data for group member display names and harden realtime publication.

create table if not exists public.profiles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  first_name text null,
  last_name text null,
  display_name text not null,
  avatar_url text null,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now()
);

alter table public.profiles enable row level security;

drop policy if exists "profiles_select_self_or_group_member" on public.profiles;
create policy "profiles_select_self_or_group_member" on public.profiles
for select
to authenticated
using (
  user_id = (select auth.uid())
  or exists (
    select 1
    from public.group_memberships my
    join public.group_memberships target
      on target.group_id = my.group_id
    where
      my.user_id = (select auth.uid())
      and target.user_id = profiles.user_id
  )
);

drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own" on public.profiles
for update
to authenticated
using (user_id = (select auth.uid()))
with check (user_id = (select auth.uid()));

insert into public.profiles (user_id, first_name, last_name, display_name, avatar_url)
select
  u.id,
  nullif(trim(u.raw_user_meta_data ->> 'first_name'), ''),
  nullif(trim(u.raw_user_meta_data ->> 'last_name'), ''),
  coalesce(
    nullif(
      trim(
        concat_ws(
          ' ',
          nullif(trim(u.raw_user_meta_data ->> 'first_name'), ''),
          nullif(trim(u.raw_user_meta_data ->> 'last_name'), '')
        )
      ),
      ''
    ),
    split_part(coalesce(u.email, ''), '@', 1),
    'Member'
  ),
  nullif(trim(u.raw_user_meta_data ->> 'avatar_url'), '')
from auth.users u
on conflict (user_id) do update
set
  first_name = excluded.first_name,
  last_name = excluded.last_name,
  display_name = excluded.display_name,
  avatar_url = excluded.avatar_url,
  updated_at = now();

create or replace function public.handle_new_user ()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  default_gid uuid;
  first_name text;
  last_name text;
  resolved_display_name text;
begin
  insert into public.user_roles (user_id, role)
  values (new.id, 'view')
  on conflict (user_id) do nothing;

  first_name := nullif(trim(new.raw_user_meta_data ->> 'first_name'), '');
  last_name := nullif(trim(new.raw_user_meta_data ->> 'last_name'), '');
  resolved_display_name := coalesce(
    nullif(trim(concat_ws(' ', first_name, last_name)), ''),
    split_part(coalesce(new.email, ''), '@', 1),
    'Member'
  );

  insert into public.profiles (user_id, first_name, last_name, display_name, avatar_url)
  values (
    new.id,
    first_name,
    last_name,
    resolved_display_name,
    nullif(trim(new.raw_user_meta_data ->> 'avatar_url'), '')
  )
  on conflict (user_id) do update
  set
    first_name = excluded.first_name,
    last_name = excluded.last_name,
    display_name = excluded.display_name,
    avatar_url = excluded.avatar_url,
    updated_at = now();

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

do $$
declare
  pub_exists boolean;
begin
  select exists(select 1 from pg_publication where pubname = 'supabase_realtime')
  into pub_exists;

  if not pub_exists then
    return;
  end if;

  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'group_loadout_states'
  ) then
    execute 'alter publication supabase_realtime add table public.group_loadout_states';
  end if;

  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'group_memberships'
  ) then
    execute 'alter publication supabase_realtime add table public.group_memberships';
  end if;
end;
$$;
