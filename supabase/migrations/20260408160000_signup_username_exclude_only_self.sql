-- Only honor p_exclude_user_id when it matches the caller (auth.uid()).
-- Prevents using arbitrary UUIDs to probe whether a username belongs to a given user.

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
  effective_exclude uuid;
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

  effective_exclude :=
    case
      when p_exclude_user_id is not distinct from auth.uid() then p_exclude_user_id
      else null
    end;

  return not exists (
    select 1
    from public.profiles p
    where
      p.username = norm
      and (
        effective_exclude is null
        or p.user_id is distinct from effective_exclude
      )
  );
end;
$$;

revoke all on function public.is_signup_username_available (text, uuid) from public;
grant execute on function public.is_signup_username_available (text, uuid) to anon, authenticated;
