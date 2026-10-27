-- Where Supabase answered differently from SQLite (server/store/sqlite.js), now answering alike.
-- ab_overview cast the newest date on a board with ::timestamptz, so one string shaped like a date but naming none
-- (2026-11-31T...), which any member can write in updatedAt, failed the project list for the whole site. A string
-- that is no date is skipped.
-- ab_query compared jsonb with jsonb, so < and > matched values of every kind (owner > '' matched numbers and objects)
-- and ordered by jsonb's rules: a JSON null first when ascending, strings before numbers, strings by the database's
-- collation. As in SQLite, < and > need a string or a number and match only values of that kind; an order puts a
-- missing or null value last either way, numbers (and true and false as 1 and 0) before strings, strings by their
-- characters.
-- ab_apply measured a document by its printed text, which carries a space after every key's colon and every comma; a
-- document of many short keys just under 256 KiB as JSON (as SQLite and the tools measure it) was refused. The spaces
-- no longer count.

create or replace function public.ab_time(t text) returns timestamptz
language plpgsql stable set search_path = public as $$
begin
  return t::timestamptz;
exception when others then
  return null;
end $$;

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

-- f is a field expression, (data #> '{...}'); v the value, a string or a number
create or replace function public.ab_compare(f text, op text, v jsonb) returns text
language plpgsql immutable set search_path = public as $$
begin
  if jsonb_typeof(v) = 'number' then
    -- a case, not an and: Postgres may cast before it checks the kind, and a string does not cast to a number
    return format('((case when jsonb_typeof(%1$s) = ''number'' then (%1$s)::numeric end) %2$s %3$L::numeric)', f, op, v::text);
  elsif jsonb_typeof(v) = 'string' then
    return format('(jsonb_typeof(%1$s) = ''string'' and (%1$s #>> ''{}'') collate "C" %2$s %3$L collate "C")', f, op, v #>> '{}');
  end if;
  raise exception 'ab:invalid_argument:0:% needs a string or a number', op;
end $$;

-- the order terms for one field, ending in a comma
create or replace function public.ab_order(f text, dir text) returns text
language sql immutable set search_path = public as $$
  select format('(%1$s is null or jsonb_typeof(%1$s) = ''null''), '
    || '(case when jsonb_typeof(%1$s) in (''number'', ''boolean'') then 0 else 1 end) %2$s, '
    || '(case jsonb_typeof(%1$s) when ''number'' then (%1$s)::numeric when ''boolean'' then (case when %1$s = ''true''::jsonb then 1 else 0 end) end) %2$s, '
    || '(case when jsonb_typeof(%1$s) = ''string'' then %1$s #>> ''{}'' when jsonb_typeof(%1$s) in (''array'', ''object'') then %1$s::text end) collate "C" %2$s, ',
    f, dir)
$$;

create or replace function public.ab_query(p_project text, p_collection text, p_where jsonb default '[]', p_order jsonb default '[]',
                                p_limit int default 20, p_after text default null) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  sql text := 'select coalesce(jsonb_agg(j order by rn), ''[]'') from (select public.ab_doc_json(d) j, row_number() over (order by ';
  conds text := format('project = %L and collection = %L', p_project, p_collection);
  ord text := '';
  w jsonb; o jsonb; f text; v jsonb; res jsonb;
begin
  perform public.ab_check_project(p_project);
  if p_collection is null or p_collection !~ '^[^/]+(/[^/]+/[^/]+)*$' then
    raise exception 'ab:invalid_argument:0:not a collection path: %', coalesce(p_collection, 'null');
  end if;
  for w in select value from jsonb_array_elements(coalesce(p_where, '[]')) loop
    f := format('(data #> %L)', public.ab_field(w->>'field'));
    v := w->'value';
    conds := conds || ' and ' || case w->>'op'
      when '==' then format('%s = %L::jsonb', f, v)
      when '!=' then format('%s is distinct from %L::jsonb', f, v)
      when '<'  then public.ab_compare(f, '<', v)
      when '<=' then public.ab_compare(f, '<=', v)
      when '>'  then public.ab_compare(f, '>', v)
      when '>=' then public.ab_compare(f, '>=', v)
      when 'array-contains' then format('%s @> %L::jsonb', f, jsonb_build_array(v))
      when 'in' then format('%s in (select value from jsonb_array_elements(%L::jsonb))', f,
                            case when jsonb_typeof(v) = 'array' then v else jsonb_build_array(v) end)
      else null end;
    if conds is null then
      raise exception 'ab:invalid_argument:0:unknown op: %', w->>'op';
    end if;
  end loop;
  for o in select value from jsonb_array_elements(coalesce(p_order, '[]')) loop
    ord := ord || public.ab_order(format('(data #> %L)', public.ab_field(o->>'field')),
                                  case lower(coalesce(o->>'dir', 'asc')) when 'desc' then 'desc' else 'asc' end);
  end loop;
  if p_after is not null and ord = '' then
    conds := conds || format(' and doc_id > %L', p_after);
  end if;
  sql := sql || ord || 'doc_id) rn from public.ab_docs d where ' || conds || ' order by rn limit '
             || greatest(1, least(coalesce(p_limit, 20), 200)) || ') x';
  execute sql into res;
  return res;
end $$;

-- the spaces Postgres prints in a document's text: one after each key's colon and one after each comma
create or replace function public.ab_json_spaces(p jsonb) returns bigint
language sql immutable set search_path = public as $$
  select coalesce(sum(case jsonb_typeof(v)
    when 'object' then greatest(2 * (select count(*) from jsonb_object_keys(v)) - 1, 0)
    when 'array' then greatest(jsonb_array_length(v) - 1, 0)
    else 0 end), 0)
  from jsonb_path_query(p, 'strict $.**') v
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
