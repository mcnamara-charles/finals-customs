-- Manual member status (assigned / available / unavailable) and loadout sync.

-- ---------------------------------------------------------------------------
-- Schema: replace boolean is_available with manual_status
-- ---------------------------------------------------------------------------

alter table public.group_member_availability
add column if not exists manual_status text;

update public.group_member_availability
set
  manual_status = case
    when is_available then 'available'
    else 'unavailable'
  end
where
  manual_status is null;

alter table public.group_member_availability
alter column manual_status
set default 'available';

alter table public.group_member_availability
alter column manual_status
set not null;

alter table public.group_member_availability drop constraint if exists group_member_availability_manual_status_check;

alter table public.group_member_availability
add constraint group_member_availability_manual_status_check check (
  manual_status in ('assigned', 'available', 'unavailable')
);

alter table public.group_member_availability drop column if exists is_available;

-- ---------------------------------------------------------------------------
-- RLS: owner may edit any row; admin may edit only targets with role member;
-- everyone may select; insert/update own row when member of group.
-- ---------------------------------------------------------------------------

drop policy if exists "gma_select_same_group" on public.group_member_availability;

drop policy if exists "gma_insert_own_member" on public.group_member_availability;

drop policy if exists "gma_update_own_member" on public.group_member_availability;

create policy "gma_select_same_group" on public.group_member_availability for select to authenticated using (
  exists (
    select 1
    from public.group_memberships m
    where
      m.group_id = group_member_availability.group_id
      and m.user_id = (select auth.uid ())
  )
);

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

create policy "gma_insert_owner" on public.group_member_availability for insert to authenticated
with check (
  exists (
    select 1
    from public.group_memberships me
    where
      me.group_id = group_member_availability.group_id
      and me.user_id = (select auth.uid ())
      and me.role = 'owner'
  )
  and exists (
    select 1
    from public.group_memberships tgt
    where
      tgt.group_id = group_member_availability.group_id
      and tgt.user_id = group_member_availability.user_id
  )
);

create policy "gma_insert_admin_member_target" on public.group_member_availability for insert to authenticated
with check (
  exists (
    select 1
    from public.group_memberships me
    where
      me.group_id = group_member_availability.group_id
      and me.user_id = (select auth.uid ())
      and me.role = 'admin'
  )
  and exists (
    select 1
    from public.group_memberships tgt
    where
      tgt.group_id = group_member_availability.group_id
      and tgt.user_id = group_member_availability.user_id
      and tgt.role = 'member'
  )
);

create policy "gma_update_self" on public.group_member_availability for update to authenticated using (
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

create policy "gma_update_owner" on public.group_member_availability for update to authenticated using (
  exists (
    select 1
    from public.group_memberships me
    where
      me.group_id = group_member_availability.group_id
      and me.user_id = (select auth.uid ())
      and me.role = 'owner'
  )
)
with check (
  exists (
    select 1
    from public.group_memberships me
    where
      me.group_id = group_member_availability.group_id
      and me.user_id = (select auth.uid ())
      and me.role = 'owner'
  )
  and exists (
    select 1
    from public.group_memberships tgt
    where
      tgt.group_id = group_member_availability.group_id
      and tgt.user_id = group_member_availability.user_id
  )
);

create policy "gma_update_admin_member_target" on public.group_member_availability for update to authenticated using (
  exists (
    select 1
    from public.group_memberships me
    where
      me.group_id = group_member_availability.group_id
      and me.user_id = (select auth.uid ())
      and me.role = 'admin'
  )
  and exists (
    select 1
    from public.group_memberships tgt
    where
      tgt.group_id = group_member_availability.group_id
      and tgt.user_id = group_member_availability.user_id
      and tgt.role = 'member'
  )
)
with check (
  exists (
    select 1
    from public.group_memberships me
    where
      me.group_id = group_member_availability.group_id
      and me.user_id = (select auth.uid ())
      and me.role = 'admin'
  )
  and exists (
    select 1
    from public.group_memberships tgt
    where
      tgt.group_id = group_member_availability.group_id
      and tgt.user_id = group_member_availability.user_id
      and tgt.role = 'member'
  )
);

-- ---------------------------------------------------------------------------
-- Strip unavailable users from persisted teamAssignments
-- ---------------------------------------------------------------------------

create or replace function public.strip_unavailable_from_app_state (p_group_id uuid, p_app_state jsonb)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  blocked uuid[];
  v_ta jsonb;
  v_kv record;
  v_new jsonb;
  v_el text;
  v_uid uuid;
  v_remove boolean;
begin
  if p_app_state is null then
    return p_app_state;
  end if;

  select
    coalesce(array_agg(a.user_id), array[]::uuid[])
  into blocked
  from public.group_member_availability a
  where
    a.group_id = p_group_id
    and a.manual_status = 'unavailable';

  if cardinality(blocked) = 0 then
    return p_app_state;
  end if;

  if (p_app_state -> 'teamAssignments') is null then
    return p_app_state;
  end if;

  v_ta := p_app_state -> 'teamAssignments';

  if jsonb_typeof(v_ta) <> 'object' then
    return p_app_state;
  end if;

  for v_kv in
  select
    *
  from
    jsonb_each(v_ta)
  loop
    v_new := '[]'::jsonb;

    if jsonb_typeof(v_kv.value) = 'array' then
      for v_el in
      select
        x
      from
        jsonb_array_elements_text(v_kv.value) as t (x)
      loop
        v_remove := false;

        begin
          v_uid := v_el::uuid;

          if v_uid = any (blocked) then
            v_remove := true;
          end if;
        exception
          when invalid_text_representation then
            v_remove := false;
        end;

        if not v_remove then
          v_new := v_new || to_jsonb(v_el);
        end if;
      end loop;
    end if;

    v_ta := jsonb_set(v_ta, array[v_kv.key], v_new, true);
  end loop;

  return jsonb_set(p_app_state, '{teamAssignments}', v_ta, true);
end;
$$;

create or replace function public.trg_group_loadout_strip_unavailable ()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.app_state := public.strip_unavailable_from_app_state(new.group_id, new.app_state);
  return new;
end;
$$;

drop trigger if exists group_loadout_states_strip_unavailable on public.group_loadout_states;

create trigger group_loadout_states_strip_unavailable before insert or update of app_state on public.group_loadout_states for each row
execute procedure public.trg_group_loadout_strip_unavailable ();

create or replace function public.trg_group_member_availability_sync_loadout ()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old jsonb;
  v_new jsonb;
begin
  select
    gls.app_state
  into v_old
  from
    public.group_loadout_states gls
  where
    gls.group_id = new.group_id;

  if v_old is null then
    return new;
  end if;

  v_new := public.strip_unavailable_from_app_state (new.group_id, v_old);

  if v_new is distinct from v_old then
    update public.group_loadout_states gls
    set
      app_state = v_new,
      updated_at = now()
    where
      gls.group_id = new.group_id;
  end if;

  return new;
end;
$$;

drop trigger if exists group_member_availability_sync_loadout on public.group_member_availability;

create trigger group_member_availability_sync_loadout
after insert or update on public.group_member_availability for each row
execute procedure public.trg_group_member_availability_sync_loadout ();
