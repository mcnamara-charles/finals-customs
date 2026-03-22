-- Roles per auth user; default new signups to viewer ('view').
create table if not exists public.user_roles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  role text not null check (role in ('view', 'admin'))
);

alter table public.user_roles enable row level security;

drop policy if exists "user_roles_select_own" on public.user_roles;
create policy "user_roles_select_own"
  on public.user_roles for select
  to authenticated
  using ((select auth.uid()) = user_id);

-- No insert/update/delete for authenticated clients; rows come from trigger / service role.

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.user_roles (user_id, role)
  values (new.id, 'view');
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- Backfill existing users (pre-trigger) as viewers.
insert into public.user_roles (user_id, role)
select id, 'view'
from auth.users u
where not exists (
  select 1 from public.user_roles ur where ur.user_id = u.id
);

-- Shared loadout state: readable by any signed-in user; writable only by admins.
alter table public.loadout_states enable row level security;

drop policy if exists "loadout_states_select_authenticated" on public.loadout_states;
create policy "loadout_states_select_authenticated"
  on public.loadout_states for select
  to authenticated
  using (true);

drop policy if exists "loadout_states_insert_admin" on public.loadout_states;
create policy "loadout_states_insert_admin"
  on public.loadout_states for insert
  to authenticated
  with check (
    exists (
      select 1 from public.user_roles ur
      where ur.user_id = (select auth.uid()) and ur.role = 'admin'
    )
  );

drop policy if exists "loadout_states_update_admin" on public.loadout_states;
create policy "loadout_states_update_admin"
  on public.loadout_states for update
  to authenticated
  using (
    exists (
      select 1 from public.user_roles ur
      where ur.user_id = (select auth.uid()) and ur.role = 'admin'
    )
  )
  with check (
    exists (
      select 1 from public.user_roles ur
      where ur.user_id = (select auth.uid()) and ur.role = 'admin'
    )
  );

drop policy if exists "loadout_states_delete_admin" on public.loadout_states;
create policy "loadout_states_delete_admin"
  on public.loadout_states for delete
  to authenticated
  using (
    exists (
      select 1 from public.user_roles ur
      where ur.user_id = (select auth.uid()) and ur.role = 'admin'
    )
  );
