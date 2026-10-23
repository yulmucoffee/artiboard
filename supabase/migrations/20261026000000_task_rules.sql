-- The holder rule in the database, for every member's write (the page, agents, scripts with a member's session): the
-- same rule server/tasks.js holds for the server and the page; tests/task-cases.js runs one table of cases through
-- both databases so they cannot drift apart. A task someone else holds (claimed by or assigned to them) and its details
-- change only as the rules open them to everyone: the due day and the board's bookkeeping, a review (done or back to
-- doing, and its summary), the archive of done work. Anything else needs the write to carry override, which the page
-- and agents pass when a person says so.

-- who holds a task: whoever claimed it, else whoever it is assigned to
create or replace function public.ab_task_holder(t jsonb) returns text
language sql immutable set search_path = public as $$
  select coalesce(nullif(t->'claimedBy'->>'who', ''), nullif(t->>'owner', ''))
$$;

-- the fields a write changes, with their new values; a missing field equals null
create or replace function public.ab_task_changed(p_before jsonb, p_after jsonb) returns jsonb
language sql immutable set search_path = public as $$
  select coalesce(jsonb_object_agg(k, coalesce(p_after->k, 'null'::jsonb)), '{}'::jsonb)
  from (select jsonb_object_keys(p_before) k union select jsonb_object_keys(p_after)) ks
  where coalesce(p_before->k, 'null'::jsonb) is distinct from coalesce(p_after->k, 'null'::jsonb)
$$;

create or replace function public.ab_task_may_change(t jsonb, p_me text, p_patch jsonb, p_override boolean) returns boolean
language sql immutable set search_path = public as $$
  with h as (select public.ab_task_holder(t) holder, coalesce(nullif(t->>'status', ''), 'todo') s),
       k as (select coalesce(array_agg(key), '{}') keys from jsonb_object_keys(p_patch) key
             where key not in ('due', 'waitingOn', 'updatedAt', 'lastMessageAt'))
  select h.holder is null or h.holder = p_me or p_override or cardinality(k.keys) = 0
    or (h.s = 'review' and (not p_patch ? 'status' or p_patch->>'status' in ('done', 'doing'))
        and k.keys <@ array['status', 'summary', 'doneAt'])
    or (h.s = 'done' and k.keys <@ array['archivedAt'])
  from h, k
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


-- a todo task with a claim was assigned, not started: the rules already treat its claimer as the holder, and this
-- states it the way the page and the tools write it (found on one board, 21 tasks, each claimed by its owner)
update public.ab_docs
set data = data || jsonb_build_object('claimedBy', null, 'owner', coalesce(nullif(data->>'owner', ''), data->'claimedBy'->>'who')),
    version = version + 1, updated_at = now()
where collection = 'tasks' and coalesce(nullif(data->>'status', ''), 'todo') = 'todo' and jsonb_typeof(data->'claimedBy') = 'object';
