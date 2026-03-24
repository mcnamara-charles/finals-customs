-- strip_unavailable_from_app_state reads mutable availability rows; VOLATILE is correct.
alter function public.strip_unavailable_from_app_state (uuid, jsonb) volatile;
