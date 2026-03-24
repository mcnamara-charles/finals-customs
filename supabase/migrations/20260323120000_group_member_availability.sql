-- Per-member manual availability (available vs away) within a group.

create table if not exists public.group_member_availability (
  group_id uuid not null references public.groups (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  is_available boolean not null default true,
  updated_at timestamp with time zone not null default now (),
  constraint group_member_availability_pkey primary key (group_id, user_id),
  constraint group_member_availability_membership_fkey foreign key (group_id, user_id) references public.group_memberships (group_id, user_id) on delete cascade
) tablespace pg_default;

alter table public.group_member_availability enable row level security;

drop policy if exists "gma_select_same_group" on public.group_member_availability;
create policy "gma_select_same_group" on public.group_member_availability for select to authenticated using (
  exists (
    select 1
    from public.group_memberships m
    where
      m.group_id = group_member_availability.group_id
      and m.user_id = (select auth.uid ())
  )
);

drop policy if exists "gma_insert_own_member" on public.group_member_availability;
create policy "gma_insert_own_member" on public.group_member_availability for insert to authenticated
with check (
  user_id = (select auth.uid ())
  and exists (
    select 1
    from public.group_memberships m
    where
      m.group_id = group_member_availability.group_id
      and m.user_id = (select auth.uid ())
  )
);

drop policy if exists "gma_update_own_member" on public.group_member_availability;
create policy "gma_update_own_member" on public.group_member_availability for update to authenticated using (
  user_id = (select auth.uid ())
  and exists (
    select 1
    from public.group_memberships m
    where
      m.group_id = group_member_availability.group_id
      and m.user_id = (select auth.uid ())
  )
)
with check (
  user_id = (select auth.uid ())
  and exists (
    select 1
    from public.group_memberships m
    where
      m.group_id = group_member_availability.group_id
      and m.user_id = (select auth.uid ())
  )
);

create or replace function public.ensure_group_member_availability ()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.group_member_availability (group_id, user_id)
  values (new.group_id, new.user_id)
  on conflict (group_id, user_id) do nothing;
  return new;
end;
$$;

drop trigger if exists group_memberships_availability_after_insert on public.group_memberships;
create trigger group_memberships_availability_after_insert
after insert on public.group_memberships for each row
execute procedure public.ensure_group_member_availability ();

insert into public.group_member_availability (group_id, user_id)
select
  m.group_id,
  m.user_id
from public.group_memberships m
where
  not exists (
    select 1
    from public.group_member_availability a
    where
      a.group_id = m.group_id
      and a.user_id = m.user_id
  );

do $$
declare
  pub_exists boolean;
begin
  select exists (select 1 from pg_publication where pubname = 'supabase_realtime')
  into pub_exists;

  if not pub_exists then
    return;
  end if;

  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'group_member_availability'
  ) then
    execute 'alter publication supabase_realtime add table public.group_member_availability';
  end if;
end;
$$;
