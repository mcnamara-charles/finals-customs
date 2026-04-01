-- Persisted group banner gradients and owner/admin RPC updates.

alter table public.groups
add column if not exists gradient_color_a text;

alter table public.groups
add column if not exists gradient_color_b text;

alter table public.groups
alter column gradient_color_a
set default ('#' || upper(lpad(to_hex((floor(random() * 16777216))::int), 6, '0')));

alter table public.groups
alter column gradient_color_b
set default ('#' || upper(lpad(to_hex((floor(random() * 16777216))::int), 6, '0')));

update public.groups g
set gradient_color_a = ('#' || upper(lpad(to_hex((floor(random() * 16777216))::int), 6, '0')))
where g.gradient_color_a is null
  or g.gradient_color_a !~* '^#[0-9a-f]{6}$';

update public.groups g
set gradient_color_b = ('#' || upper(lpad(to_hex((floor(random() * 16777216))::int), 6, '0')))
where g.gradient_color_b is null
  or g.gradient_color_b !~* '^#[0-9a-f]{6}$';

alter table public.groups
alter column gradient_color_a set not null;

alter table public.groups
alter column gradient_color_b set not null;

alter table public.groups
drop constraint if exists groups_gradient_color_a_hex_check;

alter table public.groups
add constraint groups_gradient_color_a_hex_check
check (gradient_color_a ~ '^#[0-9A-F]{6}$');

alter table public.groups
drop constraint if exists groups_gradient_color_b_hex_check;

alter table public.groups
add constraint groups_gradient_color_b_hex_check
check (gradient_color_b ~ '^#[0-9A-F]{6}$');

create or replace function public.set_group_gradient_colors (
  group_id uuid,
  color_a text,
  color_b text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  me_id uuid;
  me_role text;
  normalized_a text;
  normalized_b text;
begin
  me_id := (select auth.uid());
  if me_id is null then
    raise exception 'Not authenticated';
  end if;

  select m.role
  into me_role
  from public.group_memberships m
  where m.group_id = set_group_gradient_colors.group_id
    and m.user_id = me_id;

  if me_role is null then
    raise exception 'Not a group member';
  end if;

  if me_role not in ('owner', 'admin') then
    raise exception 'Only owners/admins can edit group gradients';
  end if;

  normalized_a := upper(trim(color_a));
  normalized_b := upper(trim(color_b));

  if normalized_a !~ '^#[0-9A-F]{6}$' then
    raise exception 'Invalid color A';
  end if;
  if normalized_b !~ '^#[0-9A-F]{6}$' then
    raise exception 'Invalid color B';
  end if;

  update public.groups g
  set gradient_color_a = normalized_a,
      gradient_color_b = normalized_b
  where g.id = set_group_gradient_colors.group_id;

  if not found then
    raise exception 'Group not found';
  end if;
end;
$$;

revoke all on function public.set_group_gradient_colors (uuid, text, text) from public;
grant execute on function public.set_group_gradient_colors (uuid, text, text) to authenticated;
