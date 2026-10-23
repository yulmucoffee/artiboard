-- Several reads in one call: board_start reads config, cursor, rules, notes, notices and three task lists before it
-- can say anything, and each separate call to the database costs a request of its own. Each read is {path} (as
-- ab_get) or {collection, where, order, limit, after} (as ab_query); the answer lists their results in order.
create or replace function public.ab_read(p_project text, p_reads jsonb) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare r jsonb; out jsonb := '[]'::jsonb;
begin
  if jsonb_typeof(p_reads) <> 'array' or jsonb_array_length(p_reads) > 20 then
    raise exception 'ab:invalid_argument:0:reads must be an array of at most 20';
  end if;
  for r in select value from jsonb_array_elements(p_reads) loop
    out := out || jsonb_build_array(case when r ? 'path' then public.ab_get(p_project, r->>'path')
      else public.ab_query(p_project, r->>'collection', coalesce(r->'where', '[]'::jsonb), coalesce(r->'order', '[]'::jsonb),
        coalesce((r->>'limit')::int, 20), r->>'after') end);
  end loop;
  return out;
end $$;

revoke all on function public.ab_read(text, jsonb) from public, anon, authenticated;
grant execute on function public.ab_read(text, jsonb) to service_role;
