-- Several projects on one site: every board document now belongs to a project, and each
-- project is its own board at /p/<id>. Documents written before this (seed data only) are dropped.

create table public.ab_projects (
  id         text primary key check (id ~ '^[a-z0-9][a-z0-9-]{0,39}$'),
  title      text not null check (length(title) between 1 and 120),
  created_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null
);
alter table public.ab_projects enable row level security;
create policy "members read projects" on public.ab_projects for select to authenticated
  using (exists (select 1 from public.ab_members m where m.user_id = auth.uid()));
revoke insert, update, delete, truncate on public.ab_projects from anon, authenticated;

truncate public.ab_docs, public.ab_leases;
alter table public.ab_docs drop constraint ab_docs_pkey;
alter table public.ab_docs add column project text not null references public.ab_projects (id) on delete cascade;
alter table public.ab_docs add primary key (project, collection, doc_id);

drop function public.ab_apply(uuid, jsonb);
drop function public.ab_batch(jsonb);
drop function public.ab_query(text, jsonb, jsonb, int, text);
drop function public.ab_get(text);

create function public.ab_check_project(p_project text) returns void
language plpgsql stable security definer set search_path = public as $$
begin
  if not exists (select 1 from public.ab_projects where id = p_project) then
    raise exception 'ab:not_found:0:no project %', coalesce(p_project, 'null');
  end if;
end $$;

-- Applies writes atomically within one project. Each write: {op: set|update|delete, path, data?, if_version?, if_absent?}.
-- set replaces the document, update merges top-level fields into an existing one.
-- Errors look like `ab:<code>:<index>:<detail>` and roll the whole batch back.
create function public.ab_apply(p_actor uuid, p_project text, p_writes jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  w jsonb; i int := 0; c text; d text; cur public.ab_docs; had boolean; op text; payload jsonb; out jsonb := '[]'::jsonb;
  v_role text := case when p_actor is null then 'admin' else public.ab_role(p_actor) end;
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
    if op in ('set', 'update') and (jsonb_typeof(payload) <> 'object' or length(payload::text) > 262144) then
      raise exception 'ab:invalid_argument:%:data must be an object under 256 KiB', i;
    end if;
    select * into cur from public.ab_docs where project = p_project and collection = c and doc_id = d for update;
    had := found;
    if w ? 'if_version' and (not had or cur.version <> (w->>'if_version')::bigint) then
      raise exception 'ab:version_conflict:%:% is at version %, not %', i, w->>'path',
        case when had then cur.version::text else 'none (missing)' end, w->>'if_version';
    end if;
    if coalesce((w->>'if_absent')::boolean, false) and had then
      raise exception 'ab:already_exists:%:% already exists', i, w->>'path';
    end if;
    if op = 'set' then
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

-- the browser's write path: the signed-in member writes as themselves
create function public.ab_batch(p_project text, p_writes jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then
    raise exception 'ab:permission_denied:0:not signed in';
  end if;
  return public.ab_apply(auth.uid(), p_project, p_writes);
end $$;

-- where: [{field, op, value}] with op one of == != < <= > >= array-contains in.
-- order_by: [{field, dir}] (dir asc|desc). Missing fields never match a comparison.
-- after: a doc id; only used without order_by, for paging a plain listing.
create function public.ab_query(p_project text, p_collection text, p_where jsonb default '[]', p_order jsonb default '[]',
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
      when '<'  then format('%s < %L::jsonb', f, v)
      when '<=' then format('%s <= %L::jsonb', f, v)
      when '>'  then format('%s > %L::jsonb', f, v)
      when '>=' then format('%s >= %L::jsonb', f, v)
      when 'array-contains' then format('%s @> %L::jsonb', f, jsonb_build_array(v))
      when 'in' then format('%s in (select value from jsonb_array_elements(%L::jsonb))', f,
                            case when jsonb_typeof(v) = 'array' then v else jsonb_build_array(v) end)
      else null end;
    if conds is null then
      raise exception 'ab:invalid_argument:0:unknown op: %', w->>'op';
    end if;
  end loop;
  for o in select value from jsonb_array_elements(coalesce(p_order, '[]')) loop
    ord := ord || format('(data #> %L) %s nulls last, ', public.ab_field(o->>'field'),
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

create function public.ab_get(p_project text, p_path text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare res jsonb;
begin
  perform public.ab_check_project(p_project);
  select public.ab_doc_json(d) into res from public.ab_docs d, public.ab_split(p_path) s
  where d.project = p_project and d.collection = s.collection and d.doc_id = s.doc_id;
  return res;
end $$;

-- A new project starts with the board's config, a copy of the rules for people and one notice.
-- Every member is on the board, pinned to their account; trim meta/config.people later if needed.
create function public.ab_create_project(p_actor uuid, p_id text, p_title text, p_protocol text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_role text := case when p_actor is null then 'admin' else public.ab_role(p_actor) end;
  v_at text := to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
  author text := coalesce((select person from public.ab_members where user_id = p_actor), 'admin');
  people jsonb; writes jsonb;
begin
  if v_role is null or v_role = 'viewer' then
    raise exception 'ab:permission_denied:0:this account cannot create projects';
  end if;
  if p_id is null or p_id !~ '^[a-z0-9][a-z0-9-]{0,39}$' then
    raise exception 'ab:invalid_argument:0:project id must be 1 to 40 lowercase letters, digits or hyphens';
  end if;
  if exists (select 1 from public.ab_projects where id = p_id) then
    raise exception 'ab:already_exists:0:project % already exists', p_id;
  end if;
  insert into public.ab_projects (id, title, created_by) values (p_id, btrim(p_title), p_actor);
  select coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object('id', person, 'name', name, 'uid', user_id)) order by created_at), '[]')
    into people from public.ab_members where role <> 'viewer';
  writes := jsonb_build_array(
    jsonb_build_object('op', 'set', 'path', 'meta/config', 'data', jsonb_build_object(
      'title', btrim(p_title), 'subtitle', '', 'milestone', 'M1', 'lang', 'ko', 'people', people, 'strings', '{}'::jsonb)),
    jsonb_build_object('op', 'set', 'path', 'meta/protocol', 'data', jsonb_build_object('text', coalesce(p_protocol, ''), 'rev', 1, 'updatedAt', v_at)),
    jsonb_build_object('op', 'set', 'path', 'notices/n-' || replace(v_at, ':', '-') || '-' || author, 'data', jsonb_build_object(
      'at', v_at, 'author', author, 'kind', 'human', 'type', 'note', 'text', '판을 열었어요.')));
  writes := writes || coalesce((select jsonb_agg(jsonb_build_object('op', 'set', 'path', 'people/' || (p->>'id'),
                                  'data', jsonb_build_object('uid', p->>'uid', 'at', v_at)))
                                from jsonb_array_elements(people) p), '[]');
  perform public.ab_apply(p_actor, p_id, writes);
  return jsonb_build_object('id', p_id, 'title', btrim(p_title));
end $$;

create function public.ab_new_project(p_id text, p_title text, p_protocol text) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then
    raise exception 'ab:permission_denied:0:not signed in';
  end if;
  return public.ab_create_project(auth.uid(), p_id, p_title, p_protocol);
end $$;

-- the project list: task counts by status and the latest change, for members only
create function public.ab_overview() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', p.id, 'title', coalesce(c.data->>'title', p.title), 'subtitle', c.data->>'subtitle', 'created_at', p.created_at,
    'tasks', coalesce(t.counts, '{}'::jsonb), 'total', coalesce(t.total, 0), 'last', a.last
  ) order by a.last desc nulls last, p.created_at), '[]')
  from public.ab_projects p
  left join public.ab_docs c on c.project = p.id and c.collection = 'meta' and c.doc_id = 'config'
  left join lateral (
    select jsonb_object_agg(s, n) counts, sum(n)::int total from (
      select coalesce(data->>'status', 'todo') s, count(*) n from public.ab_docs
      where project = p.id and collection = 'tasks' group by 1) x) t on true
  -- the latest time written on a task or notice, so imported history keeps its own dates
  left join lateral (
    select max(t)::timestamptz last from (
      select greatest(data->>'updatedAt', data->>'lastMessageAt', data->>'at') t from public.ab_docs
      where project = p.id and collection in ('tasks', 'notices')) x
    where t ~ '^\d{4}-\d{2}-\d{2}T') a on true
  where exists (select 1 from public.ab_members m where m.user_id = auth.uid())
     or auth.role() = 'service_role'
$$;

revoke all on function public.ab_check_project(text), public.ab_apply(uuid, text, jsonb), public.ab_batch(text, jsonb),
  public.ab_query(text, text, jsonb, jsonb, int, text), public.ab_get(text, text),
  public.ab_create_project(uuid, text, text, text), public.ab_new_project(text, text, text), public.ab_overview()
  from public, anon, authenticated;
grant execute on function public.ab_apply(uuid, text, jsonb), public.ab_query(text, text, jsonb, jsonb, int, text),
  public.ab_get(text, text), public.ab_create_project(uuid, text, text, text), public.ab_overview() to service_role;
grant execute on function public.ab_batch(text, jsonb), public.ab_new_project(text, text, text), public.ab_overview()
  to authenticated;
