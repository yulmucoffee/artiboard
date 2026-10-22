-- Guards every write path enforces, not just the MCP server:
-- - only admins change who is who: meta/config.people, and people/<id> beyond a member linking their own account once
-- - messages and notices carry their writer's own person as author
-- - leases are for members who write, on projects that exist, and expired ones are cleared
-- - signed-out clients cannot read any table (realtime included), and revoking a member's tokens ends their sessions

revoke select on public.ab_docs, public.ab_members, public.ab_tokens, public.ab_leases, public.ab_projects, public.ab_pages from anon;

create or replace function public.ab_apply(p_actor uuid, p_project text, p_writes jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  w jsonb; i int := 0; c text; d text; cur public.ab_docs; had boolean; op text; payload jsonb; out jsonb := '[]'::jsonb;
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
    if op in ('set', 'update') and (jsonb_typeof(payload) <> 'object' or length(payload::text) > 262144) then
      raise exception 'ab:invalid_argument:%:data must be an object under 256 KiB', i;
    end if;
    select * into cur from public.ab_docs where project = p_project and collection = c and doc_id = d for update;
    had := found;
    if v_role <> 'admin' then
      if c = 'people' and (op <> 'set' or payload->>'uid' is distinct from p_actor::text or coalesce(cur.data->>'uid', '') <> '') then
        raise exception 'ab:permission_denied:%:only admins change people/; a member links only their own account to an unlinked person', i;
      end if;
      if c = 'meta' and d = 'config' and (op = 'delete' or not had
          or (op = 'set' and payload->'people' is distinct from cur.data->'people')
          or (op = 'update' and payload ? 'people' and payload->'people' is distinct from cur.data->'people')) then
        raise exception 'ab:permission_denied:%:only admins change meta/config.people', i;
      end if;
      if (c = 'notices' or c ~ '^tasks/[^/]+/messages$') and op in ('set', 'update') and payload ? 'author'
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

-- leases are `<project>:<path>`, held a few seconds while the page links an account
create or replace function public.ab_acquire(p_path text, p_holder text, p_ttl_ms int) returns boolean
language plpgsql security definer set search_path = public as $$
declare got boolean; v_role text := public.ab_role(auth.uid());
begin
  if v_role is null or v_role = 'viewer' then
    raise exception 'ab:permission_denied:0:this account cannot write';
  end if;
  if p_path is null or length(p_path) > 850 or length(coalesce(p_holder, '')) > 200 then
    raise exception 'ab:invalid_argument:0:lease path or holder too long';
  end if;
  perform public.ab_check_project(split_part(p_path, ':', 1));
  delete from public.ab_leases where expires_at < now() - interval '1 minute';
  insert into public.ab_leases as l (path, holder, expires_at)
  values (p_path, p_holder, now() + make_interval(secs => least(greatest(p_ttl_ms, 100), 60000) / 1000.0))
  on conflict (path) do update set holder = excluded.holder, expires_at = excluded.expires_at
    where l.expires_at < now() or l.holder = excluded.holder
  returning true into got;
  return coalesce(got, false);
end $$;

-- signs a member out everywhere: their refresh tokens go with the sessions, access tokens lapse within the hour
create function public.ab_end_sessions(p_user uuid) returns int
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  delete from auth.sessions where user_id = p_user;
  get diagnostics n = row_count;
  return n;
end $$;

revoke all on function public.ab_end_sessions(uuid) from public, anon, authenticated;
grant execute on function public.ab_end_sessions(uuid) to service_role;
