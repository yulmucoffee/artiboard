-- A project can be archived and restored. An archived project keeps every document and reads as before; it leaves
-- the everyday lists (the server filters ab_overview's archived_at) and ab_apply refuses its members' writes, admins'
-- included, until a restore. The site itself (actor null) still writes, so members it seats or renames meanwhile are
-- current when the project comes back. Only the server archives, with the service key, for admins.

alter table public.ab_projects add column archived_at timestamptz;

create or replace function public.ab_overview() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', p.id, 'title', coalesce(c.data->>'title', p.title), 'subtitle', c.data->>'subtitle',
    'repos', case when jsonb_typeof(c.data->'repos') = 'array' then c.data->'repos' else '[]'::jsonb end, 'created_at', p.created_at,
    'archived_at', p.archived_at,
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
        select nullif(data->>'owner', '') who,
          coalesce(data->'claimedBy'->>'agent', 'false') = 'true' agent,
          coalesce(data->>'key', doc_id) key, coalesce(data->>'title', '') title, data->>'status' status, data->>'updatedAt' upd
        from public.ab_docs
        where project = p.id and collection = 'tasks' and data->>'status' in ('doing', 'review', 'blocked')) d
      where who is not null
      group by who) h
    left join public.ab_members m on m.person = h.who) w on true
  -- the latest time written on a task or notice, so imported history keeps its own dates
  left join lateral (
    select max(public.ab_time(t)) last from (
      select greatest(data->>'updatedAt', data->>'lastMessageAt', data->>'at') t from public.ab_docs
      where project = p.id and collection in ('tasks', 'notices')) x
    where t ~ '^\d{4}-\d{2}-\d{2}T') a on true
  where exists (select 1 from public.ab_members m where m.user_id = auth.uid())
     or auth.role() = 'service_role'
$$;

create or replace function public.ab_apply(p_actor uuid, p_project text, p_writes jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  w jsonb; i int := 0; c text; d text; cur public.ab_docs; had boolean; op text; payload jsonb; out jsonb := '[]'::jsonb;
  v_task jsonb; v_before jsonb; v_patch jsonb;
  v_role text := case when p_actor is null then 'admin' else public.ab_role(p_actor) end;
  v_person text := (select person from public.ab_members where user_id = p_actor);
begin
  if v_role is null or v_role = 'viewer' then
    raise exception 'ab:permission_denied:0:this account cannot write';
  end if;
  perform public.ab_check_project(p_project);
  if p_actor is not null and exists (select 1 from public.ab_projects where id = p_project and archived_at is not null) then
    raise exception 'ab:archived:0:project % is archived: it reads as before and takes writes again once an admin restores it', p_project;
  end if;
  if jsonb_typeof(p_writes) <> 'array' or jsonb_array_length(p_writes) = 0 or jsonb_array_length(p_writes) > 100 then
    raise exception 'ab:invalid_argument:0:writes must be an array of 1 to 100 entries';
  end if;
  for w in select value from jsonb_array_elements(p_writes) loop
    op := w->>'op';
    begin
      select s.collection, s.doc_id into c, d from public.ab_split(w->>'path') s;
    exception when others then
      raise exception 'ab:invalid_argument:%:not a document path: %', i, coalesce(w->>'path', 'null');
    end;
    payload := coalesce(w->'data', '{}'::jsonb);
    if op in ('set', 'update') and (jsonb_typeof(payload) <> 'object'
        or length(payload::text) > 262144 and length(payload::text) - public.ab_json_spaces(payload) > 262144) then
      raise exception 'ab:invalid_argument:%:data must be an object under 256 KiB', i;
    end if;
    select * into cur from public.ab_docs where project = p_project and collection = c and doc_id = d for update;
    had := found;
    if v_role <> 'admin' then
      if c = 'people' and (op <> 'set' or d is distinct from v_person or payload->>'uid' is distinct from p_actor::text
          or coalesce(cur.data->>'uid', '') <> '') then
        raise exception 'ab:permission_denied:%:only admins change people/; a member links only their own account to their own person, once', i;
      end if;
      if c = 'cursors' and d is distinct from v_person then
        raise exception 'ab:permission_denied:%:a member moves only their own cursor (cursors/%)', i, v_person;
      end if;
      if c = 'meta' and d = 'config' and (op = 'delete' or not had
          or (op = 'set' and payload->'people' is distinct from cur.data->'people')
          or (op = 'update' and payload ? 'people' and payload->'people' is distinct from cur.data->'people')) then
        raise exception 'ab:permission_denied:%:only admins change meta/config.people', i;
      end if;
      if (c = 'notices' or c ~ '^tasks/[^/]+/messages$') and had and cur.data->>'author' is distinct from v_person then
        raise exception 'ab:permission_denied:%:only % changes or deletes this post', i, coalesce(cur.data->>'author', 'its author');
      end if;
      if (c = 'notices' or c ~ '^tasks/[^/]+/messages$') and (op = 'set' or (op = 'update' and payload ? 'author'))
          and payload->>'author' is distinct from v_person then
        raise exception 'ab:permission_denied:%:author must be your own person (%)', i, v_person;
      end if;
    end if;
    if w ? 'if_version' and (not had or cur.version <> (w->>'if_version')::bigint) then
      raise exception 'ab:version_conflict:%:% is at version %, not %', i, w->>'path',
        case when had then cur.version::text else 'none (missing)' end, w->>'if_version';
    end if;
    if coalesce((w->>'if_absent')::boolean, false) and had then
      raise exception 'ab:already_exists:%:% already exists', i, w->>'path';
    end if;
    -- the task rules on every member's write to a task or its details (the system, actor null, is not held to them),
    -- after the version check: a write that lost a race rereads and decides again, rather than being refused
    if p_actor is not null and c in ('tasks', 'details') then
      v_task := case when c = 'tasks' then cur.data
        else (select t.data from public.ab_docs t where t.project = p_project and t.collection = 'tasks' and t.doc_id = d) end;
      if v_task is not null then
        v_before := coalesce(case when had then cur.data end, '{}'::jsonb);
        v_patch := public.ab_task_changed(v_before, case op when 'delete' then '{}'::jsonb when 'set' then payload else v_before || payload end);
        if c = 'details' then v_patch := v_patch - 'summaryAt'; end if;
        if not public.ab_task_may_change(v_task, v_person, v_patch, coalesce((w->>'override')::boolean, false)) then
          raise exception 'ab:not_yours:%:% is held by %; pass override true only when your person says so', i,
            coalesce(v_task->>'key', d), public.ab_task_holder(v_task);
        end if;
      end if;
    end if;
    if op = 'set' and coalesce((w->>'if_absent')::boolean, false) then
      -- a missing row takes no lock, so a write that raced this one may have inserted it since the read above
      insert into public.ab_docs (project, collection, doc_id, data, updated_by)
      values (p_project, c, d, payload, p_actor)
      on conflict (project, collection, doc_id) do nothing
      returning * into cur;
      if not found then
        raise exception 'ab:already_exists:%:% already exists', i, w->>'path';
      end if;
    elsif op = 'set' then
      insert into public.ab_docs as t (project, collection, doc_id, data, updated_by)
      values (p_project, c, d, payload, p_actor)
      on conflict (project, collection, doc_id) do update
        set data = excluded.data, version = t.version + 1, updated_at = now(), updated_by = p_actor
      returning * into cur;
    elsif op = 'update' then
      if not had then
        raise exception 'ab:not_found:%:% does not exist', i, w->>'path';
      end if;
      update public.ab_docs set data = data || payload, version = version + 1, updated_at = now(), updated_by = p_actor
      where project = p_project and collection = c and doc_id = d returning * into cur;
    elsif op = 'delete' then
      delete from public.ab_docs where project = p_project and collection = c and doc_id = d;
      out := out || jsonb_build_object('path', w->>'path', 'deleted', had);
      i := i + 1;
      continue;
    else
      raise exception 'ab:invalid_argument:%:op must be set, update or delete', i;
    end if;
    out := out || jsonb_build_object('path', w->>'path', 'version', cur.version);
    i := i + 1;
  end loop;
  return out;
end $$;
