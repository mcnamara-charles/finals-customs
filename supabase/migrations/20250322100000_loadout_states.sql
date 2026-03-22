-- Loadout persistence table (must run before user_roles_and_loadout_rls).
create extension if not exists pgcrypto;

create table public.loadout_states (
  id uuid not null default gen_random_uuid (),
  state_version text not null default '1.0.0'::text,
  app_state jsonb not null,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  profile_key text not null,
  constraint loadout_states_pkey primary key (id)
) TABLESPACE pg_default;

create unique index if not exists loadout_states_profile_key_idx on public.loadout_states using btree (profile_key) TABLESPACE pg_default;
