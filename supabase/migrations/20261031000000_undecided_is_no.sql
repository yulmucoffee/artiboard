-- A write the rules cannot decide is refused. A patch {status: null} on someone else's task in review made the review
-- test NULL, so the function answered NULL and `if not NULL` let the write through; server/tasks.js refuses it.

create or replace function public.ab_task_may_change(t jsonb, p_me text, p_patch jsonb, p_override boolean) returns boolean
language sql immutable set search_path = public as $$
  with h as (select public.ab_task_holder(t) holder, coalesce(nullif(t->>'status', ''), 'todo') s),
       k as (select coalesce(array_agg(key), '{}') keys from jsonb_object_keys(p_patch) key
             where key not in ('due', 'waitingOn', 'updatedAt', 'lastMessageAt', 'lastMessageBy'))
  select coalesce(h.holder is null or h.holder = p_me or p_override or cardinality(k.keys) = 0
    or (h.s = 'review' and (not p_patch ? 'status' or p_patch->>'status' in ('done', 'doing'))
        and k.keys <@ array['status', 'summary', 'doneAt'])
    or (h.s = 'done' and k.keys <@ array['archivedAt']), false)
  from h, k
$$;
