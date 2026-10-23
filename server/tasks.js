// The task document and its rules, in one place for every writer: the MCP tools, agents' batch writes and the board
// page, which carries a copy of this file between its task-rules markers (scripts/inline-rules.mjs keeps it current).
// Pure functions over plain task data; nothing here reads or writes the database.

export const TASK_STATUSES = ['todo', 'doing', 'review', 'blocked', 'done'];

// every field of tasks/<id>; references/protocol.md lists the same ones
export const TASK_FIELDS = ['key', 'title', 'feature', 'milestone', 'status', 'owner', 'deps', 'waitingOn', 'claimedBy', 'branch', 'pr',
  'start', 'due', 'repo', 'doneAt', 'archivedAt', 'updatedAt', 'lastMessageAt'];

// what anyone may write on any task: the due day, and what the board keeps up to date by itself
const OPEN_FIELDS = ['due', 'waitingOn', 'updatedAt', 'lastMessageAt'];

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

// Whether `me` may write `patch` (field names to values; `summary` counts as a field) on a task someone else holds.
// Anyone moves the due day, reviews a task in review (done after the merge, or back to doing, with a summary) and
// moves done work in or out of the archive. The rest needs the holder, or override when a person says so.
export function mayChange(t, me, patch, override) {
  const h = holderOf(t);
  if (!h || h === me || override) return true;
  const keys = Object.keys(patch).filter((k) => OPEN_FIELDS.indexOf(k) < 0);
  if (!keys.length) return true;
  const s = statusOf(t);
  if (s === 'review' && (patch.status === 'done' || patch.status === 'doing')
    && keys.every((k) => k === 'status' || k === 'summary' || k === 'doneAt')) return true;
  return s === 'done' && keys.every((k) => k === 'archivedAt');
}
