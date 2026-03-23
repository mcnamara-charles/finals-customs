-- Fix recursive RLS evaluation on group_memberships by avoiding
-- a self-referential subquery inside the table's own SELECT policy.

create or replace function public.is_group_member (p_group_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
    from public.group_memberships m
    where
      m.group_id = p_group_id
      and m.user_id = (select auth.uid())
  );
$$;

revoke all on function public.is_group_member (uuid) from public;
grant execute on function public.is_group_member (uuid) to authenticated;

drop policy if exists "group_memberships_select_same_group" on public.group_memberships;
create policy "group_memberships_select_same_group" on public.group_memberships
for select
to authenticated
using (public.is_group_member(group_memberships.group_id));
