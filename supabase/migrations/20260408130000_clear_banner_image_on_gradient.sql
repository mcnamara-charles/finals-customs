-- When banner mode is gradient, clear stored image URL so row state stays consistent.

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
    set banner_mode = 'gradient',
        banner_image_url = null
    where g.id = p_group_id;

    if not found then
      raise exception 'Group not found';
    end if;
  end if;
end;
$$;
