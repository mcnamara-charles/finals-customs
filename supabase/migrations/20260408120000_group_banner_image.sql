-- Group banner: gradient vs image, optional image URL, and storage for uploads.

alter table public.groups
add column if not exists banner_mode text;

alter table public.groups
add column if not exists banner_image_url text;

update public.groups
set banner_mode = 'gradient'
where banner_mode is null
   or banner_mode not in ('gradient', 'image');

alter table public.groups
alter column banner_mode set default 'gradient';

alter table public.groups
alter column banner_mode set not null;

alter table public.groups
drop constraint if exists groups_banner_mode_check;

alter table public.groups
add constraint groups_banner_mode_check
check (banner_mode in ('gradient', 'image'));

create or replace function public.set_group_banner_display (
  p_group_id uuid,
  p_mode text,
  p_image_url text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  me_id uuid;
  me_role text;
  trimmed_url text;
begin
  me_id := (select auth.uid());
  if me_id is null then
    raise exception 'Not authenticated';
  end if;

  select m.role
  into me_role
  from public.group_memberships m
  where m.group_id = p_group_id
    and m.user_id = me_id;

  if me_role is null then
    raise exception 'Not a group member';
  end if;

  if me_role not in ('owner', 'admin') then
    raise exception 'Only owners/admins can edit group banner';
  end if;

  if p_mode is null or p_mode not in ('gradient', 'image') then
    raise exception 'Invalid banner mode';
  end if;

  if p_mode = 'image' then
    trimmed_url := nullif(trim(p_image_url), '');
    if trimmed_url is null then
      raise exception 'Image URL required for image mode';
    end if;
    if length(trimmed_url) > 2048 then
      raise exception 'Image URL too long';
    end if;
    if trimmed_url !~* '^https://' then
      raise exception 'Image URL must be https';
    end if;

    update public.groups g
    set banner_mode = 'image',
        banner_image_url = trimmed_url
    where g.id = p_group_id;

    if not found then
      raise exception 'Group not found';
    end if;
  else
    update public.groups g
    set banner_mode = 'gradient'
    where g.id = p_group_id;

    if not found then
      raise exception 'Group not found';
    end if;
  end if;
end;
$$;

revoke all on function public.set_group_banner_display (uuid, text, text) from public;
grant execute on function public.set_group_banner_display (uuid, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Storage: public bucket; group admins may write only under {group_id}/...
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public)
values ('group-banners', 'group-banners', true)
on conflict (id) do update
set public = excluded.public;

drop policy if exists "group_banners_public_read" on storage.objects;
create policy "group_banners_public_read"
on storage.objects for select
using (bucket_id = 'group-banners');

drop policy if exists "group_banners_admin_insert" on storage.objects;
create policy "group_banners_admin_insert"
on storage.objects for insert
to authenticated
with check (
  bucket_id = 'group-banners'
  and exists (
    select 1
    from public.group_memberships m
    where m.user_id = (select auth.uid())
      and m.role in ('owner', 'admin')
      and m.group_id::text = split_part(name, '/', 1)
  )
);

drop policy if exists "group_banners_admin_update" on storage.objects;
create policy "group_banners_admin_update"
on storage.objects for update
to authenticated
using (
  bucket_id = 'group-banners'
  and exists (
    select 1
    from public.group_memberships m
    where m.user_id = (select auth.uid())
      and m.role in ('owner', 'admin')
      and m.group_id::text = split_part(name, '/', 1)
  )
)
with check (
  bucket_id = 'group-banners'
  and exists (
    select 1
    from public.group_memberships m
    where m.user_id = (select auth.uid())
      and m.role in ('owner', 'admin')
      and m.group_id::text = split_part(name, '/', 1)
  )
);
