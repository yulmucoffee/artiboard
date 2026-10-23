-- The project list also says who has work in hand on each board: per person (claimer, else owner) the tasks
-- in doing, review or blocked, whether an agent holds any of them, and the latest three.
create or replace function public.ab_overview() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', p.id, 'title', coalesce(c.data->>'title', p.title), 'subtitle', c.data->>'subtitle',
    'repos', case when jsonb_typeof(c.data->'repos') = 'array' then c.data->'repos' else '[]'::jsonb end, 'created_at', p.created_at,
    'tasks', coalesce(t.counts, '{}'::jsonb), 'total', coalesce(t.total, 0), 'working', coalesce(w.working, '[]'::jsonb), 'last', a.last
  ) order by a.last desc nulls last, p.created_at), '[]')
  from public.ab_projects p
  left join public.ab_docs c on c.project = p.id and c.collection = 'meta' and c.doc_id = 'config'
  left join lateral (
    select jsonb_object_agg(s, n) counts, sum(n)::int total from (
      select coalesce(data->>'status', 'todo') s, count(*) n from public.ab_docs
      where project = p.id and collection = 'tasks' group by 1) x) t on true
  left join lateral (
    select jsonb_agg(jsonb_build_object('who', h.who, 'name', m.name, 'n', h.n, 'agent', h.agent, 'tasks', h.tasks) order by h.n desc, h.who) working
    from (
      select who, count(*)::int n, bool_or(agent) agent,
        to_jsonb((array_agg(jsonb_build_object('key', key, 'title', title, 'status', status) order by upd desc nulls last))[1:3]) tasks
      from (
        select coalesce(nullif(data->'claimedBy'->>'who', ''), nullif(data->>'owner', '')) who,
          coalesce(data->'claimedBy'->>'agent', 'false') = 'true' agent,
          coalesce(data->>'key', doc_id) key, coalesce(data->>'title', '') title, data->>'status' status, data->>'updatedAt' upd
        from public.ab_docs
        where project = p.id and collection = 'tasks' and data->>'status' in ('doing', 'review', 'blocked')) d
      where who is not null
      group by who) h
    left join public.ab_members m on m.person = h.who) w on true
  -- the latest time written on a task or notice, so imported history keeps its own dates
  left join lateral (
    select max(t)::timestamptz last from (
      select greatest(data->>'updatedAt', data->>'lastMessageAt', data->>'at') t from public.ab_docs
      where project = p.id and collection in ('tasks', 'notices')) x
    where t ~ '^\d{4}-\d{2}-\d{2}T') a on true
  where exists (select 1 from public.ab_members m where m.user_id = auth.uid())
     or auth.role() = 'service_role'
$$;

-- The fields the everyday tools filter tasks on, spelled as ab_query writes them ((data #> '{field}')), so a
-- board with thousands of tasks finds ready work, a task's dependents and a person's tasks without a full scan.
create index if not exists ab_docs_status on public.ab_docs (project, collection, (data #> '{status}'::text[]));
create index if not exists ab_docs_key on public.ab_docs (project, collection, (data #> '{key}'::text[]));
create index if not exists ab_docs_owner on public.ab_docs (project, collection, (data #> '{owner}'::text[]));

-- Several ordered, limited reads in one call, for a page that follows the latest message of each recently
-- touched task: one round trip instead of one per task. Runs as the caller, so the members-only policy applies.
-- Each row says which read it answers (i).
create or replace function public.ab_read_limited(p_project text, p_reads jsonb) returns setof jsonb
language plpgsql stable security invoker set search_path = public as $$
declare r jsonb; o jsonb; i int := 0; ord text; lim int;
begin
  if jsonb_typeof(p_reads) <> 'array' or jsonb_array_length(p_reads) > 20 then
    raise exception 'ab:invalid_argument:0:at most 20 reads';
  end if;
  for r in select value from jsonb_array_elements(p_reads) loop
    ord := '';
    for o in select value from jsonb_array_elements(coalesce(r->'order', '[]'::jsonb)) loop
      -- checked here as ab_field does: signed-in callers may not run ab_field itself
      if coalesce(o->>'field', '') !~ '^[A-Za-z0-9_]+(\.[A-Za-z0-9_]+)*$' then
        raise exception 'ab:invalid_argument:0:bad field name: %', coalesce(o->>'field', 'null');
      end if;
      ord := ord || format('(data #> %L) %s nulls last, ', string_to_array(o->>'field', '.'), case when o->>'dir' = 'desc' then 'desc' else 'asc' end);
    end loop;
    lim := least(greatest(coalesce((r->>'limit')::int, 200), 1), 200);
    return query execute format(
      'select jsonb_build_object(''i'', $3, ''collection'', collection, ''doc_id'', doc_id, ''version'', version, ''updated_at'', updated_at, ''data'', data)
       from public.ab_docs where project = $1 and collection = $2 order by %s doc_id limit %s', ord, lim)
      using p_project, r->>'collection', i;
    i := i + 1;
  end loop;
end $$;

revoke all on function public.ab_read_limited(text, jsonb) from public, anon;
grant execute on function public.ab_read_limited(text, jsonb) to authenticated;
