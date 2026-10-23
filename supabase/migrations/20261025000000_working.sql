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
