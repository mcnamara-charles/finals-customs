-- Harden RPC privileges so join_group_by_code is callable only by authenticated users.

revoke all on function public.join_group_by_code (text) from public;
grant execute on function public.join_group_by_code (text) to authenticated;
