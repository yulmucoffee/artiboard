-- artiboard on Supabase: one document store that behaves like a claude.ai artifact database.
-- Documents live at paths such as `tasks/M1-3` or `tasks/M1-3/messages/<id>`:
-- `collection` is everything before the last segment, `doc_id` the last segment.
-- Browsers read with RLS and write only through ab_batch; the MCP server writes through ab_apply as the token's member.

create table public.ab_members (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  email      text not null unique,
  person     text not null unique check (person ~ '^[a-z0-9][a-z0-9_-]{0,31}$'),
  name       text,
  role       text not null default 'member' check (role in ('admin', 'member', 'viewer')),
  created_at timestamptz not null default now()
);

create table public.ab_tokens (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references public.ab_members (user_id) on delete cascade,
  label        text not null default 'claude-code',
  token_hash   text not null unique,
  created_at   timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at   timestamptz
);

create table public.ab_docs (
  collection text not null check (collection ~ '^[^/]+(/[^/]+/[^/]+)*$' and length(collection) <= 512),
  doc_id     text not null check (doc_id !~ '/' and length(doc_id) between 1 and 256),
  data       jsonb not null default '{}'::jsonb check (jsonb_typeof(data) = 'object'),
  version    bigint not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid,
  primary key (collection, doc_id)
);

-- short leases, so two viewers linking the same person at once cannot both win
create table public.ab_leases (
  path       text primary key,
  holder     text not null,
  expires_at timestamptz not null
);

alter table public.ab_members enable row level security;
alter table public.ab_tokens enable row level security;
alter table public.ab_docs enable row level security;
alter table public.ab_leases enable row level security;

create function public.ab_role(p_actor uuid) returns text
language sql stable security definer set search_path = public as $$
  select role from public.ab_members where user_id = p_actor
$$;

create policy "members read docs" on public.ab_docs for select to authenticated
  using (exists (select 1 from public.ab_members m where m.user_id = auth.uid()));
create policy "members read themselves" on public.ab_members for select to authenticated
  using (user_id = auth.uid());

alter publication supabase_realtime add table public.ab_docs;

-- `a/b/c/d` -> ('a/b/c', 'd'); a document path has an even number of segments
create function public.ab_split(p_path text, out collection text, out doc_id text)
language plpgsql immutable as $$
declare n int := array_length(string_to_array(p_path, '/'), 1);
begin
  if p_path is null or p_path !~ '^[^/]+(/[^/]+)*$' or n % 2 <> 0 then
    raise exception 'ab:invalid_argument:not a document path: %', coalesce(p_path, 'null');
  end if;
  collection := regexp_replace(p_path, '/[^/]+$', '');
  doc_id := regexp_replace(p_path, '^.*/', '');
end $$;

create function public.ab_doc_json(d public.ab_docs) returns jsonb
language sql immutable as $$
  select jsonb_build_object('path', d.collection || '/' || d.doc_id, 'id', d.doc_id, 'version', d.version,
                            'updated_at', d.updated_at, 'data', d.data)
$$;

-- Applies writes atomically. Each write: {op: set|update|delete, path, data?, if_version?, if_absent?}.
-- set replaces the document, update merges top-level fields into an existing one.
-- Errors look like `ab:<code>:<index>:<detail>` and roll the whole batch back.
create function public.ab_apply(p_actor uuid, p_writes jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  w jsonb; i int := 0; c text; d text; cur public.ab_docs; had boolean; op text; payload jsonb; out jsonb := '[]'::jsonb;
  v_role text := case when p_actor is null then 'admin' else public.ab_role(p_actor) end;
begin
  if v_role is null or v_role = 'viewer' then
    raise exception 'ab:permission_denied:0:this account cannot write';
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
    if op in ('set', 'update') and (jsonb_typeof(payload) <> 'object' or length(payload::text) > 262144) then
      raise exception 'ab:invalid_argument:%:data must be an object under 256 KiB', i;
    end if;
    select * into cur from public.ab_docs where collection = c and doc_id = d for update;
    had := found;
    if w ? 'if_version' and (not had or cur.version <> (w->>'if_version')::bigint) then
      raise exception 'ab:version_conflict:%:% is at version %, not %', i, w->>'path',
        coalesce(cur.version::text, 'none (missing)'), w->>'if_version';
    end if;
    if coalesce((w->>'if_absent')::boolean, false) and had then
      raise exception 'ab:already_exists:%:% already exists', i, w->>'path';
    end if;
    if op = 'set' then
      insert into public.ab_docs as t (collection, doc_id, data, updated_by)
      values (c, d, payload, p_actor)
      on conflict (collection, doc_id) do update
        set data = excluded.data, version = t.version + 1, updated_at = now(), updated_by = p_actor
      returning * into cur;
    elsif op = 'update' then
      if not had then
        raise exception 'ab:not_found:%:% does not exist', i, w->>'path';
      end if;
      update public.ab_docs set data = data || payload, version = version + 1, updated_at = now(), updated_by = p_actor
      where collection = c and doc_id = d returning * into cur;
    elsif op = 'delete' then
      delete from public.ab_docs where collection = c and doc_id = d;
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
create function public.ab_batch(p_writes jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then
    raise exception 'ab:permission_denied:0:not signed in';
  end if;
  return public.ab_apply(auth.uid(), p_writes);
end $$;

-- `claimedBy.who` -> '{claimedBy,who}'
create function public.ab_field(p_field text) returns text[]
language plpgsql immutable as $$
begin
  if p_field is null or p_field !~ '^[A-Za-z0-9_]+(\.[A-Za-z0-9_]+)*$' then
    raise exception 'ab:invalid_argument:0:bad field name: %', coalesce(p_field, 'null');
  end if;
  return string_to_array(p_field, '.');
end $$;

-- where: [{field, op, value}] with op one of == != < <= > >= array-contains in.
-- order_by: [{field, dir}] (dir asc|desc). Missing fields never match a comparison.
-- after: a doc id; only used without order_by, for paging a plain listing.
create function public.ab_query(p_collection text, p_where jsonb default '[]', p_order jsonb default '[]',
                                p_limit int default 20, p_after text default null) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  sql text := 'select coalesce(jsonb_agg(j order by rn), ''[]'') from (select public.ab_doc_json(d) j, row_number() over (order by ';
  conds text := format('collection = %L', p_collection);
  ord text := '';
  w jsonb; o jsonb; f text; v jsonb; res jsonb;
begin
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

create function public.ab_get(p_path text) returns jsonb
language sql stable security definer set search_path = public as $$
  select public.ab_doc_json(d) from public.ab_docs d, public.ab_split(p_path) s
  where d.collection = s.collection and d.doc_id = s.doc_id
$$;

create function public.ab_acquire(p_path text, p_holder text, p_ttl_ms int) returns boolean
language plpgsql security definer set search_path = public as $$
declare got boolean;
begin
  if public.ab_role(auth.uid()) is null then
    raise exception 'ab:permission_denied:0:not a member';
  end if;
  insert into public.ab_leases as l (path, holder, expires_at)
  values (p_path, p_holder, now() + make_interval(secs => least(greatest(p_ttl_ms, 100), 60000) / 1000.0))
  on conflict (path) do update set holder = excluded.holder, expires_at = excluded.expires_at
    where l.expires_at < now() or l.holder = excluded.holder
  returning true into got;
  return coalesce(got, false);
end $$;

create function public.ab_whoami() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('user_id', user_id, 'person', person, 'name', name, 'role', role)
  from public.ab_members where user_id = auth.uid()
$$;

revoke insert, update, delete, truncate on public.ab_docs, public.ab_members, public.ab_tokens, public.ab_leases
  from anon, authenticated;

-- internal helpers are for the server only; browsers get ab_batch, ab_acquire and ab_whoami
revoke all on function public.ab_role(uuid), public.ab_split(text), public.ab_doc_json(public.ab_docs),
  public.ab_apply(uuid, jsonb), public.ab_field(text), public.ab_query(text, jsonb, jsonb, int, text),
  public.ab_get(text), public.ab_batch(jsonb), public.ab_acquire(text, text, int), public.ab_whoami()
  from public, anon, authenticated;
grant execute on function public.ab_apply(uuid, jsonb), public.ab_query(text, jsonb, jsonb, int, text),
  public.ab_get(text) to service_role;
grant execute on function public.ab_batch(jsonb), public.ab_acquire(text, text, int), public.ab_whoami()
  to authenticated;
