// The task document and its rules, in one place for every writer: the MCP tools, agents' batch writes and the board
// page, which carries a copy of this file between its task-rules markers (scripts/inline-rules.mjs keeps it current).
// Pure functions over plain task data; nothing here reads or writes the database.

export const TASK_STATUSES = ['todo', 'doing', 'review', 'blocked', 'done'];

// every field of tasks/<id>; references/protocol.md lists the same ones
export const TASK_FIELDS = ['key', 'title', 'feature', 'milestone', 'status', 'owner', 'deps', 'waitingOn', 'claimedBy', 'branch', 'pr',
  'start', 'due', 'repo', 'doneAt', 'archivedAt', 'updatedAt', 'lastMessageAt', 'lastMessageBy'];

// what anyone may write on any task: the due day, and what the board keeps up to date by itself
const OPEN_FIELDS = ['due', 'waitingOn', 'updatedAt', 'lastMessageAt', 'lastMessageBy'];

// The fields a write changes, with their new values: a missing field equals null, and object keys compare in any
// order, as both databases store them.
export function changedFields(before, after) {
  const canon = (v) => (v == null ? null : Array.isArray(v) ? v.map(canon)
    : typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, canon(v[k])])) : v);
  const patch = {};
  for (const k of new Set(Object.keys(before).concat(Object.keys(after)))) {
    if (JSON.stringify(canon(before[k])) !== JSON.stringify(canon(after[k]))) patch[k] = after[k] == null ? null : after[k];
  }
  return patch;
}

export function statusOf(t) { return (t && t.status) || 'todo'; }

// who has the task: whoever claimed it, else whoever it is assigned to; an assignment holds it like a claim
export function holderOf(t) { return (t && ((t.claimedBy && t.claimedBy.who) || t.owner)) || null; }

// the deps not done yet; isDone(key) says whether the task with that key is done
export function unmetDeps(t, isDone) {
  return (Array.isArray(t.deps) ? t.deps : []).filter((k) => typeof k === 'string' && !isDone(k));
}

// free to pick: to do, nobody holds it, nothing it waits on is left
export function isReady(t, isDone) { return statusOf(t) === 'todo' && !holderOf(t) && !unmetDeps(t, isDone).length; }

// What else a status change sets: back to todo releases the task, done stamps when, and leaving done takes back
// the done day and the archive.
export function statusEffects(t, status, at) {
  const fx = {};
  if (status === 'todo') { fx.claimedBy = null; fx.owner = null; }
  if (status === 'done' && statusOf(t) !== 'done') fx.doneAt = at;
  if (status !== 'done' && t.doneAt) fx.doneAt = null;
  if (status !== 'done' && t.archivedAt) fx.archivedAt = null;
  return fx;
}

// Whether `me` may write `patch` (field names to values; a details document's fields count too) on a task someone
// else holds. Anyone moves the due day, reviews a task in review (done after the merge or back to doing, and its
// summary) and moves done work in or out of the archive. The rest needs the holder, or override when a person
// says so. Both databases check this on every write to a task or its details.
export function mayChange(t, me, patch, override) {
  const h = holderOf(t);
  if (!h || h === me || override) return true;
  const keys = Object.keys(patch).filter((k) => OPEN_FIELDS.indexOf(k) < 0);
  if (!keys.length) return true;
  const s = statusOf(t);
  if (s === 'review' && (!('status' in patch) || patch.status === 'done' || patch.status === 'doing')
    && keys.every((k) => k === 'status' || k === 'summary' || k === 'doneAt')) return true;
  return s === 'done' && keys.every((k) => k === 'archivedAt');
}
