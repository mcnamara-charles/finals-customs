-- Anonymous signup flow can check whether a normalized username is free (boolean only; no row data).

create or replace function public.is_signup_username_available (p_username text)
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
    where p.username = norm
  );
end;
$$;

revoke all on function public.is_signup_username_available (text) from public;
grant execute on function public.is_signup_username_available (text) to anon, authenticated;
