-- Groups, memberships, shared per-group state, and per-user-per-group state.
-- Keeps loadout_states and user_roles for compatibility; app uses groups path.

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table if not exists public.internal_app_config (
  key text primary key,
  value_uuid uuid
);

alter table public.internal_app_config enable row level security;

create table if not exists public.groups (
  id uuid not null default gen_random_uuid (),
  name text not null,
  join_code text not null,
  created_at timestamp with time zone not null default now(),
  created_by uuid null references auth.users (id) on delete set null,
  constraint groups_pkey primary key (id),
  constraint groups_join_code_key unique (join_code)
) tablespace pg_default;

create table if not exists public.group_memberships (
  group_id uuid not null references public.groups (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null,
  created_at timestamp with time zone not null default now(),
  constraint group_memberships_pkey primary key (group_id, user_id),
  constraint group_memberships_role_check check (
    role in ('owner', 'admin', 'member')
  )
) tablespace pg_default;

create table if not exists public.group_loadout_states (
  group_id uuid not null references public.groups (id) on delete cascade,
  state_version text not null default '1.0.0'::text,
  app_state jsonb not null,
  updated_at timestamp with time zone not null default now(),
  constraint group_loadout_states_pkey primary key (group_id)
) tablespace pg_default;

create table if not exists public.user_group_loadout_states (
  user_id uuid not null references auth.users (id) on delete cascade,
  group_id uuid not null references public.groups (id) on delete cascade,
  app_state jsonb not null default '{}'::jsonb,
  updated_at timestamp with time zone not null default now(),
  constraint user_group_loadout_states_pkey primary key (user_id, group_id)
) tablespace pg_default;

-- ---------------------------------------------------------------------------
-- Default group + backfill from legacy loadout_states (profile default)
-- ---------------------------------------------------------------------------

do $$
declare
  default_gid uuid;
  legacy_state jsonb;
  legacy_version text;
  new_join_code text;
begin
  select c.value_uuid
  into default_gid
  from public.internal_app_config c
  where c.key = 'default_group_id'
  limit 1;

  if default_gid is null
    or not exists (
      select 1
      from public.groups g
      where g.id = default_gid
    )
  then
    select g.id
    into default_gid
    from public.groups g
    where g.name = 'Default'
    order by g.created_at asc
    limit 1;

    if default_gid is null then
      new_join_code := upper(substring(replace(gen_random_uuid()::text, '-', '') from 1 for 8));

      insert into public.groups (name, join_code)
      values ('Default', new_join_code)
      returning id into default_gid;
    end if;

    insert into public.internal_app_config (key, value_uuid)
    values ('default_group_id', default_gid)
    on conflict (key) do update set value_uuid = excluded.value_uuid;
  end if;

  select ls.app_state, ls.state_version
  into legacy_state, legacy_version
  from public.loadout_states ls
  where ls.profile_key = 'default'
  limit 1;

  if legacy_state is not null then
    insert into public.group_loadout_states (group_id, state_version, app_state)
    values (
      default_gid,
      coalesce(legacy_version, '1.0.0'),
      legacy_state
    )
    on conflict (group_id) do nothing;
  else
    insert into public.group_loadout_states (group_id, state_version, app_state)
    values (default_gid, '1.0.0', '{}'::jsonb)
    on conflict (group_id) do nothing;
  end if;

  insert into public.group_memberships (group_id, user_id, role)
  select
    default_gid,
    ur.user_id,
    case
      when ur.role = 'admin' then 'admin'::text
      else 'member'::text
    end
  from public.user_roles ur
  on conflict (group_id, user_id) do nothing;

  insert into public.group_memberships (group_id, user_id, role)
  select default_gid, u.id, 'member'::text
  from auth.users u
  where not exists (
    select 1
    from public.group_memberships m
    where
      m.group_id = default_gid
      and m.user_id = u.id
  );

  if
    not exists (
      select 1
      from public.group_memberships m
      where
        m.group_id = default_gid
        and m.role = 'owner'
    )
    and exists (
      select 1
      from public.group_memberships m
      where m.group_id = default_gid
    )
  then
    update public.group_memberships m
    set role = 'owner'
    where m.group_id = default_gid
      and m.user_id = (
        select m2.user_id
        from public.group_memberships m2
        where m2.group_id = default_gid
        order by
          case m2.role
            when 'admin' then 0
            when 'member' then 1
            else 2
          end,
          m2.user_id
        limit 1
      );
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- New auth users: still get user_roles row + membership in default group
-- ---------------------------------------------------------------------------

create or replace function public.handle_new_user ()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  default_gid uuid;
begin
  insert into public.user_roles (user_id, role)
  values (new.id, 'view')
  on conflict (user_id) do nothing;

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

-- ---------------------------------------------------------------------------
-- Join group by code (SECURITY DEFINER)
-- ---------------------------------------------------------------------------

create or replace function public.join_group_by_code (p_code text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  g_id uuid;
  normalized text;
begin
  if (select auth.uid()) is null then
    raise exception 'Not authenticated';
  end if;

  normalized := upper(trim(p_code));

  if normalized = '' then
    raise exception 'Invalid code';
  end if;

  select g.id
  into g_id
  from public.groups g
  where g.join_code = normalized;

  if g_id is null then
    raise exception 'Invalid code';
  end if;

  insert into public.group_memberships (group_id, user_id, role)
  values (g_id, auth.uid(), 'member')
  on conflict (group_id, user_id) do nothing;

  return g_id;
end;
$$;

grant execute on function public.join_group_by_code (text) to authenticated;

-- ---------------------------------------------------------------------------
-- RLS: groups
-- ---------------------------------------------------------------------------

alter table public.groups enable row level security;

drop policy if exists "groups_select_member" on public.groups;
create policy "groups_select_member" on public.groups for select to authenticated using (
  exists (
    select 1
    from public.group_memberships m
    where
      m.group_id = groups.id
      and m.user_id = (select auth.uid ())
  )
);

-- ---------------------------------------------------------------------------
-- RLS: group_memberships
-- ---------------------------------------------------------------------------

alter table public.group_memberships enable row level security;

drop policy if exists "group_memberships_select_same_group" on public.group_memberships;
create policy "group_memberships_select_same_group" on public.group_memberships
for select
to authenticated
using (
  exists (
    select 1
    from public.group_memberships my
    where
      my.user_id = (select auth.uid ())
      and my.group_id = group_memberships.group_id
  )
);

-- No direct insert/update/delete for clients except via join_group_by_code.

-- ---------------------------------------------------------------------------
-- RLS: group_loadout_states
-- ---------------------------------------------------------------------------

alter table public.group_loadout_states enable row level security;

drop policy if exists "gls_select_member" on public.group_loadout_states;
create policy "gls_select_member" on public.group_loadout_states for select to authenticated using (
  exists (
    select 1
    from public.group_memberships m
    where
      m.group_id = group_loadout_states.group_id
      and m.user_id = (select auth.uid ())
  )
);

drop policy if exists "gls_insert_owner_admin" on public.group_loadout_states;
create policy "gls_insert_owner_admin" on public.group_loadout_states for insert to authenticated
with check (
  exists (
    select 1
    from public.group_memberships m
    where
      m.group_id = group_loadout_states.group_id
      and m.user_id = (select auth.uid ())
      and m.role in ('owner', 'admin')
  )
);

drop policy if exists "gls_update_owner_admin" on public.group_loadout_states;
create policy "gls_update_owner_admin" on public.group_loadout_states for update to authenticated
using (
  exists (
    select 1
    from public.group_memberships m
    where
      m.group_id = group_loadout_states.group_id
      and m.user_id = (select auth.uid ())
      and m.role in ('owner', 'admin')
  )
)
with check (
  exists (
    select 1
    from public.group_memberships m
    where
      m.group_id = group_loadout_states.group_id
      and m.user_id = (select auth.uid ())
      and m.role in ('owner', 'admin')
  )
);

drop policy if exists "gls_delete_owner_admin" on public.group_loadout_states;
create policy "gls_delete_owner_admin" on public.group_loadout_states for delete to authenticated using (
  exists (
    select 1
    from public.group_memberships m
    where
      m.group_id = group_loadout_states.group_id
      and m.user_id = (select auth.uid ())
      and m.role in ('owner', 'admin')
  )
);

-- ---------------------------------------------------------------------------
-- RLS: user_group_loadout_states
-- ---------------------------------------------------------------------------

alter table public.user_group_loadout_states enable row level security;

drop policy if exists "ugls_select_own_member" on public.user_group_loadout_states;
create policy "ugls_select_own_member" on public.user_group_loadout_states for select to authenticated using (
  user_id = (select auth.uid ())
  and exists (
    select 1
    from public.group_memberships m
    where
      m.group_id = user_group_loadout_states.group_id
      and m.user_id = (select auth.uid ())
  )
);

drop policy if exists "ugls_insert_own_member" on public.user_group_loadout_states;
create policy "ugls_insert_own_member" on public.user_group_loadout_states for insert to authenticated
with check (
  user_id = (select auth.uid ())
  and exists (
    select 1
    from public.group_memberships m
    where
      m.group_id = user_group_loadout_states.group_id
      and m.user_id = (select auth.uid ())
  )
);

drop policy if exists "ugls_update_own_member" on public.user_group_loadout_states;
create policy "ugls_update_own_member" on public.user_group_loadout_states for update to authenticated
using (
  user_id = (select auth.uid ())
  and exists (
    select 1
    from public.group_memberships m
    where
      m.group_id = user_group_loadout_states.group_id
      and m.user_id = (select auth.uid ())
  )
)
with check (
  user_id = (select auth.uid ())
  and exists (
    select 1
    from public.group_memberships m
    where
      m.group_id = user_group_loadout_states.group_id
      and m.user_id = (select auth.uid ())
  )
);

drop policy if exists "ugls_delete_own_member" on public.user_group_loadout_states;
create policy "ugls_delete_own_member" on public.user_group_loadout_states for delete to authenticated using (
  user_id = (select auth.uid ())
);
