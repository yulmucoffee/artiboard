// The everyday agent actions, each one tool call: start a session, read a task, claim, post.
// They answer in short text lines, check versions on the server and stamp times with the server clock,
// so an agent spends no tokens on reads before a write, on version numbers or on `date`.
import { BOARD_RULES, BoardError, now, repoName, reposOf, stampId, toBoardError } from './core.js';
import { TASK_STATUSES, boardStatuses, holderOf, isReady, mayChange, statusEffects, statusOf, unmetDeps } from './tasks.js';
import { VERSION } from './version.js';

// 2026-10-21T08:57:33.000Z -> 10-21 08:57Z
const short = (iso) => (typeof iso === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d/.test(iso) ? `${iso.slice(5, 10)} ${iso.slice(11, 16)}Z` : '');
const oneLine = (s) => String(s ?? '').replace(/\s*\n\s*/g, ' ').trim();
const DAY = /^\d{4}-\d\d-\d\d$/;
const day = (v) => (typeof v === 'string' && DAY.test(v) ? v : '');
function keyOrder(a, b) {
  const p = (k) => { const m = /^(.*?)(\d+)-(\d+)$/.exec(k || ''); return m ? [m[1], +m[2], +m[3]] : [k || '', 0, 0]; };
  const x = p(a), y = p(b);
  return x[0] < y[0] ? -1 : x[0] > y[0] ? 1 : x[1] - y[1] || x[2] - y[2];
}
// documents in key order: M1-2 before M1-10, an id standing in for a missing key
const byDocKey = (a, b) => keyOrder(a.data.key || a.id, b.data.key || b.id);
const CLAIMED = { ko: '집었어요.', en: 'Claimed.' };

// a pinned write lost a race (someone wrote in between): read again and redo it once
async function retrying(fn) {
  try { return await fn(); } catch (e) {
    if (toBoardError(e).code !== 'version_conflict') throw e;
    return fn();
  }
}

// A task's repo is a label from meta/config.repos or an owner/name; both name one repository.
function taskRepo(d, repos) {
  if (!d.repo) return null;
  const hit = repos.find((r) => r.label === d.repo);
  return hit ? repoName(hit.repo) : repoName(d.repo);
}

// Dates in lines are short (10-24); the server's day is UTC, so "late" only shows once the day is over everywhere.
function dateBits(d) {
  if (d.status === 'done') return [];
  const today = now().slice(0, 10), bits = [];
  if (day(d.start) && (d.status || 'todo') === 'todo') bits.push(`start ${d.start.slice(5)}`);
  if (day(d.due)) bits.push(`due ${d.due.slice(5)}${d.due < today ? ' late' : ''}`);
  return bits;
}

function taskLine(d, id, withStatus) {
  const bits = [d.key || id];
  if (withStatus) bits.push(d.status || 'todo');
  if (d.feature) bits.push(`[${d.feature}]`);
  if (d.repo) bits.push(`repo:${d.repo}`);
  if (d.branch && withStatus) bits.push(d.branch);
  if (d.pr && withStatus) bits.push(d.pr);
  bits.push(...dateBits(d));
  return `${bits.join(' ')} ${d.title || ''}`.trim();
}
const reviewLine = (d, id) => [d.key || id, d.feature && `[${d.feature}]`, d.repo && `repo:${d.repo}`, d.pr, ...dateBits(d), d.title]
  .filter(Boolean).join(' ') + (holderOf(d) ? ` · ${holderOf(d)}` : '');
const msgLine = (m) => `${short(m.at)} ${m.author || '?'}${m.type && m.type !== 'note' ? ` ${m.type}` : ''}: ${oneLine(m.text)}`;
const repoList = (repos) => repos.map((r) => `${r.repo}${r.label ? ` (${r.label})` : ''}`).join(' · ');

function detailLines(det) {
  const d = det?.data || {};
  return [
    d.spec && `spec: ${oneLine(d.spec)}`,
    d.acceptance && `acceptance: ${oneLine(d.acceptance)}`,
    d.summary && `summary ${short(d.summaryAt)}: ${d.summary.trim()}`,
  ].filter(Boolean);
}

// how much of a person's own work board_start prints: lines for work at hand, keys for work in review
const MINE_LINES = 20, MINE_KEYS = 30;

export function makeFlow(store) {
  const get = (project, path) => store.get(project, path);
  const query = (project, collection, opts) => store.query(project, collection, opts);
  const apply = (member, project, writes) => store.apply(member.uid, project, writes);
  // reads that do not wait on each other go together, as one database request on Supabase (at most 20 a request)
  const read = async (project, reads) => {
    const parts = [];
    for (let i = 0; i < reads.length; i += 20) parts.push(store.readMany(project, reads.slice(i, i + 20)));
    return (await Promise.all(parts)).flat();
  };

  // The project a repository belongs to: the one whose meta/config.repos lists it.
  async function projectFor(repo) {
    const want = repoName(repo);
    if (!want) throw new BoardError('invalid_argument', 'repo is not a GitHub repository: pass owner/name or the git remote URL');
    const hits = (await store.overview()).filter((p) => reposOf(p).some((r) => repoName(r.repo) === want)).map((p) => p.id);
    if (!hits.length) throw new BoardError('not_found', `no project lists ${want}; board_projects shows each project's repos`);
    if (hits.length > 1) throw new BoardError('invalid_argument', `${want} is on ${hits.join(', ')}; pass project`);
    return hits[0];
  }

  // The rest of a query whose first page came back full (200, a page's most), page by page: a list cut short would drop
  // someone's work without saying so. Boards smaller than a page pay nothing.
  async function rest(project, first, { collection, where }) {
    const all = first.slice();
    for (let page = first; page.length === 200 && all.length < 5000;) {
      page = await query(project, collection, { where, limit: 200, after: page[page.length - 1].id });
      all.push(...page);
    }
    return all;
  }

  // Which of these task keys are done, in one round trip however many there are.
  async function doneKeys(project, keys) {
    const all = [...new Set(keys)], done = new Set(), chunks = [];
    for (let i = 0; i < all.length; i += 100) chunks.push(all.slice(i, i + 100));
    for (const found of await read(project, chunks.map((ks) => ({ collection: 'tasks', where: [{ field: 'key', op: 'in', value: ks }, { field: 'status', op: '==', value: 'done' }], limit: 200 })))) {
      for (const d of found) done.add(d.data.key);
    }
    return done;
  }

  // Ready work: todo tasks nobody holds whose deps are all done. waitingOn is the stored answer the page and the
  // ready query rely on; here it is checked against the dep tasks themselves and repaired in passing, so a task
  // written without it, or a dep finished while no page was open, still shows up (and a stale one stays out).
  async function readyWork(member, project, todo) {
    const free = todo.filter((t) => !holderOf(t.data));
    const done = await doneKeys(project, free.flatMap((t) => unmetDeps(t.data, () => false)));
    const repairs = [], ready = [];
    const isDone = (k) => done.has(k);
    for (const t of free) {
      const want = unmetDeps(t.data, isDone), cur = t.data.waitingOn;
      if (!Array.isArray(cur) || cur.length !== want.length || cur.some((k, i) => k !== want[i])) {
        repairs.push({ op: 'update', path: `tasks/${t.id}`, if_version: t.version, data: { waitingOn: want } });
      }
      if (isReady(t.data, isDone)) ready.push(t);
    }
    // best effort: a conflict means someone else just wrote the task, a viewer may not write at all
    const batches = [];
    for (let i = 0; i < repairs.length; i += 100) batches.push(repairs.slice(i, i + 100));
    await Promise.all(batches.map((b) => apply(member, project, b).catch(() => {})));
    return ready;
  }

  // Session start: the rules, notices after this person's cursor (and move the cursor), their tasks, and ready work.
  // With a repo, ready work is the tasks of that repository and the tasks that name none.
  // On a remote database every read is a round trip, so they go out together: the reads, then the dependency
  // check, then the writes (cursor and readiness repairs) side by side.
  async function start(member, { project, repo, ready = 8, peek = false, rules = true } = {}) {
    if (!project && !repo) throw new BoardError('invalid_argument', 'pass project, or repo (owner/name from git remote) to find it');
    if (!project) project = await projectFor(repo);
    const me = member.person;
    const got = await readStart(project, me, { ready, rules });
    const since = got.cursor?.data?.noticesAt || null;
    const notices = newNotices(got.latest, since);
    const newest = notices.map((n) => n.data.at).filter((a) => typeof a === 'string').sort().pop();
    const moving = !peek && newest && (!since || newest > since) ? moveCursor(member, project, got.cursor, newest).catch(() => {}) : null;
    const config = got.config?.data || {}, scope = repoScope(repo, project, config);
    let free = (ready ? await readyWork(member, project, got.todo) : []).sort(byDocKey);
    await moving;
    const elsewhere = scope.want ? free.filter((t) => { const r = taskRepo(t.data, scope.repos); return r && r !== scope.want; }).length : 0;
    if (scope.want) free = free.filter(scope.here);
    // someone else's work waiting for a review, which anyone may finish after the merge or send back
    const toReview = got.inReview.filter((t) => holderOf(t.data) !== me && scope.here(t)).sort(byDocKey);
    // a todo task you own was assigned to you and not started: it is listed as yours, not as anyone's ready work
    const mine = got.owned.filter((t) => statusOf(t.data) !== 'done');

    const out = [`${me} · ${project}${config.milestone ? ` · ${config.milestone}` : ''} · artiboard ${VERSION}`];
    if (scope.repos.length) out.push(`repos: ${repoList(scope.repos)}`);
    if (scope.stray) out.push(scope.stray);
    if (rules) out.push(...rulesLines(got.rules, got.notes));
    out.push(...noticeLines(notices, got.latest.length, since));
    out.push(...mineLines(mine, me));
    if (ready) out.push(...readyLines(free, toReview, ready, elsewhere));
    return out.join('\n');
  }

  // Everything board_start reads, in one request, by name; a list whose first page came back full continues page by page.
  async function readStart(project, me, { ready, rules }) {
    const wanted = {
      config: { path: 'meta/config' },
      cursor: { path: `cursors/${me}` },
      owned: { collection: 'tasks', where: [{ field: 'owner', op: '==', value: me }], limit: 200 },
      todo: ready && { collection: 'tasks', where: [{ field: 'status', op: '==', value: 'todo' }], limit: 200 },
      rules: rules && { path: 'meta/rules' },
      notes: rules && { path: 'meta/notes' },
      latest: { collection: 'notices', order: [{ field: 'at', dir: 'desc' }], limit: 20 },
      inReview: ready && { collection: 'tasks', where: [{ field: 'status', op: '==', value: 'review' }], limit: 200 },
    };
    const names = Object.keys(wanted).filter((k) => wanted[k]);
    const results = await read(project, names.map((k) => wanted[k]));
    const got = Object.fromEntries(names.map((k, i) => [k, results[i]]));
    const [owned, todo, inReview] = await Promise.all(['owned', 'todo', 'inReview'].map((k) => (wanted[k] ? rest(project, got[k], wanted[k]) : [])));
    return { ...got, owned, todo, inReview };
  }

  // the 20 latest notices, oldest first: those after the cursor are new (all 20 new: older ones went unread); no cursor
  // yet, the latest 5
  function newNotices(latest, since) {
    return (since ? latest.filter((n) => typeof n.data.at === 'string' && n.data.at > since) : latest.slice(0, 5)).reverse();
  }

  // Which repository's work to show. repo, given with a project, may also be one of its labels; one the project does
  // not list turns the filter off and says so.
  function repoScope(repo, project, config) {
    const repos = reposOf(config);
    let want = repo ? repoName(repos.find((r) => r.label === repo)?.repo ?? repo) : null, stray = '';
    if (repo && (!want || !repos.some((r) => repoName(r.repo) === want))) {
      stray = `repo ${want || '(not a GitHub repository)'} is not linked to ${project}; showing all ready work (link it in meta/config.repos)`;
      want = null;
    }
    const here = (t) => { const r = want && taskRepo(t.data, repos); return !r || r === want; };
    return { repos, want, stray, here };
  }

  // the board rules, the project's rules in full, and a pointer to its notes: the shared status (schedule, where things
  // stand) is long and changes daily, so it is pointed at, not printed
  function rulesLines(own, notes) {
    const out = [BOARD_RULES];
    const r = own?.data;
    if (typeof r?.text === 'string' && r.text.trim()) out.push(`project rules (rev ${r.rev || 1}${r.by ? ` · ${r.by}` : ''}${r.updatedAt ? ` ${short(r.updatedAt).slice(0, 5)}` : ''}):`, r.text.trim());
    else out.push('project rules: none yet');
    const n = notes?.data;
    if (typeof n?.text === 'string' && n.text.trim()) out.push(`project notes: meta/notes (rev ${n.rev || 1}${n.updatedAt ? ` ${short(n.updatedAt).slice(0, 5)}` : ''}); board_get it when you need the schedule or status`);
    return out;
  }

  function noticeLines(notices, latestCount, since) {
    const head = notices.length ? `notices${since ? (notices.length === latestCount ? ' (new, the latest 20; older ones skipped)' : ' (new)') : ' (latest)'}:` : 'notices: none new';
    return [head, ...notices.map((n) => msgLine(n.data))];
  }

  // This person's own work. Where someone else wrote last (a question, a review, an override) comes first, so the holder
  // opens that thread first, then work under way before work not started; work in review waits on others, so it is one
  // line of keys. A person holding a great many sees the first ones and how many more, not a page per session.
  function mineLines(mine, me) {
    const other = (d) => d.lastMessageBy && d.lastMessageBy !== me ? d.lastMessageBy : null;
    const rank = (d) => (other(d) ? 0 : 1) * 10 + ({ doing: 0, blocked: 1, todo: 3 }[statusOf(d)] ?? 2);
    const working = mine.filter((t) => t.data.status !== 'review').sort((a, b) => rank(a.data) - rank(b.data) || byDocKey(a, b));
    const waiting = mine.filter((t) => t.data.status === 'review').sort((a, b) => (other(a.data) ? 0 : 1) - (other(b.data) ? 0 : 1) || byDocKey(a, b));
    const out = [];
    if (working.length) {
      out.push(working.length > MINE_LINES ? `mine (${MINE_LINES} of ${working.length}):` : 'mine:');
      working.slice(0, MINE_LINES).forEach((t) => out.push(`${taskLine(t.data, t.id, true)}${other(t.data) ? ` · ${other(t.data)} wrote last` : ''}`));
    }
    if (waiting.length) {
      const keys = waiting.slice(0, MINE_KEYS).map((t) => `${t.data.key || t.id}${other(t.data) ? ` (${other(t.data)} wrote last)` : ''}`);
      out.push(`mine in review (${waiting.length}): ${keys.join(', ')}${waiting.length > MINE_KEYS ? `, and ${waiting.length - MINE_KEYS} more` : ''}`);
    }
    return out;
  }

  // ready work, then others' work to review: the header says review and the PR stands for the branch, so a review line
  // carries who to ask instead
  function readyLines(free, toReview, ready, elsewhere) {
    const more = elsewhere ? `; ${elsewhere} more in other repos` : '';
    const out = [free.length ? `ready (${free.length > ready ? `${ready} of ` : ''}${free.length}${more}):` : `ready: none${more}`];
    free.slice(0, ready).forEach((t) => out.push(taskLine(t.data, t.id)));
    if (toReview.length) {
      out.push(`to review (${toReview.length > ready ? `${ready} of ` : ''}${toReview.length}):`);
      toReview.slice(0, ready).forEach((t) => out.push(reviewLine(t.data, t.id)));
    }
    return out;
  }

  // cursors only move forward; another session of the same person may have moved it meanwhile
  async function moveCursor(member, project, cursor, at) {
    const path = `cursors/${member.person}`;
    const write = (cur) => apply(member, project, [cur
      ? { op: 'update', path, data: { noticesAt: at }, if_version: cur.version }
      : { op: 'set', path, data: { noticesAt: at }, if_absent: true }]);
    try { await write(cursor); } catch (e) {
      const fresh = await get(project, path);
      if (!fresh?.data?.noticesAt || fresh.data.noticesAt < at) await write(fresh);
    }
  }

  // One task with what an agent needs to continue it: status, details, and the messages after the summary.
  async function task(project, id, { thread = 8 } = {}) {
    // the latest messages come in the same round trip, then those before the summary drop out. A message posted with
    // the summary carries its time, so it stays: it is what the summary's writer said (a fix list, "PR open").
    const [t, det, latest = []] = await read(project, [{ path: `tasks/${id}` }, { path: `details/${id}` },
      ...(thread ? [{ collection: `tasks/${id}/messages`, order: [{ field: 'at', dir: 'desc' }], limit: thread }] : [])]);
    if (!t) throw new BoardError('not_found', `no task ${id}`);
    const d = t.data;
    const since = det?.data?.summaryAt;
    const msgs = latest.filter((m) => !since || (typeof m.data.at === 'string' && m.data.at >= since)).reverse();
    const who = d.owner ? `${d.owner}${d.claimedBy?.agent && d.claimedBy.who === d.owner ? ' (agent)' : ''}` : 'unassigned';
    const out = [`${d.key || id} ${d.status || 'todo'} · ${who}${d.repo ? ` · repo:${d.repo}` : ''}${d.branch ? ` · ${d.branch}` : ''}${d.pr ? ` · ${d.pr}` : ''}`, d.title || ''];
    if (d.deps?.length) out.push(`deps ${d.deps.join(', ')}${d.waitingOn?.length ? ` · waiting on ${d.waitingOn.join(', ')}` : ''}`);
    const dates = [day(d.start) && `start ${d.start}`, day(d.due) && `due ${d.due}`, d.doneAt && `done ${short(d.doneAt)}`, d.archivedAt && `archived ${short(d.archivedAt)}`].filter(Boolean);
    if (dates.length) out.push(dates.join(' · '));
    out.push(...detailLines(det));
    if (thread) {
      out.push(msgs.length ? `messages${since ? ' after summary' : ''}:` : `messages${since ? ' after summary' : ''}: none`);
      msgs.forEach((m) => out.push(msgLine(m.data)));
    }
    return out.join('\n');
  }

  // Claim a ready task and post the claim, then hand back its details so work can start at once.
  // override takes over a task someone else holds (not a done one), when the agent's person says so.
  async function claim(member, project, id, { text, session, override } = {}) {
    const me = member.person;
    const [det, config] = await read(project, [{ path: `details/${id}` }, { path: 'meta/config' }]);
    const result = await retrying(async () => {
      const t = await get(project, `tasks/${id}`);
      if (!t) throw new BoardError('not_found', `no task ${id}`);
      const d = t.data, status = statusOf(d), holder = holderOf(d);
      // done work is nobody's to take, so it names no holder
      const taken = () => new BoardError('taken', `${d.key || id} is ${status}${holder && status !== 'done' ? `, held by ${holder}` : ''}; pick another`);
      if (status === 'done') throw taken();
      if (holder === me && status !== 'todo') return `already yours ${id}`;
      // started, or claimed or assigned by someone else
      const held = status !== 'todo' || (!!holder && holder !== me);
      if (held && !override) throw taken();
      // ready as board_start sees it, from the deps themselves: a stored waitingOn may lag a dep that finished
      if (!held) {
        const done = await doneKeys(project, unmetDeps(d, () => false)), waiting = unmetDeps(d, (k) => done.has(k));
        if (waiting.length) throw new BoardError('waiting', `${d.key || id} waits on ${waiting.join(', ')}`);
      }
      const from = held && holder && holder !== me ? holder : null;
      const at = now();
      await apply(member, project, [
        { op: 'update', path: `tasks/${id}`, if_version: t.version, ...(from && { override: true }), data: {
          status: 'doing', owner: me, claimedBy: { who: me, agent: true, ...(session && { session }), at }, ...(!held && { waitingOn: [] }), updatedAt: at, lastMessageAt: at, lastMessageBy: me } },
        { op: 'set', path: `tasks/${id}/messages/${stampId(at, me)}`, if_absent: true, data: {
          at, author: me, kind: 'agent', type: 'update', text: (text || CLAIMED[config?.data?.lang] || CLAIMED.en) + (from ? ` (taken over from ${from})` : '') } },
      ]);
      return from ? `took over ${id} from ${from}` : `claimed ${id}`;
    });
    return [result, ...detailLines(det)].join('\n');
  }

  // Finished tasks leave every dependent's waitingOn. A dependent changed in the same call takes the key out with its own
  // patch (one write per document); the rest get a write each. unblocked names the todo tasks now waiting on nothing.
  async function unblockDependents(project, keys, patches) {
    const finished = new Set(keys), seen = new Map(), more = [], unblocked = [];
    for (const found of await Promise.all(keys.map((k) => query(project, 'tasks', { where: [{ field: 'deps', op: 'array-contains', value: k }], limit: 200 })))) {
      for (const o of found) seen.set(o.id, o);
    }
    for (const o of seen.values()) {
      const waiting = Array.isArray(o.data.waitingOn) ? o.data.waitingOn : [];
      const left = waiting.filter((k) => !finished.has(k));
      if (left.length === waiting.length) continue;
      if (patches.has(o.id)) { patches.get(o.id).waitingOn = left; continue; }
      more.push({ op: 'update', path: `tasks/${o.id}`, if_version: o.version, data: { waitingOn: left } });
      if (!left.length && statusOf(o.data) === 'todo') unblocked.push(o.data.key || o.id);
    }
    return { more, unblocked };
  }

  // A thread message, optionally with a status, branch, PR, start or due day, repo or summary change; without a task, a notice.
  // Only the task's holder changes it, except: anyone moves its due day (the thread records who and from what), anyone
  // reviews a task in review (status done after the merge, or doing to send it back, with a summary), and override,
  // passed when the agent's person says so, opens the rest (the thread names the holder).
  // status todo releases the task (no holder, no owner). status done stamps doneAt (leaving done clears it) and takes
  // the key out of every dependent's waitingOn.
  // tasks, in place of task, gives several tasks one status and one message in one write, all or none (a deploy
  // finishing a list of reviews).
  async function post(member, project, { task: id, tasks, text, type, status, branch, pr, start, due, repo, summary, override }) {
    const me = member.person;
    // the asked-for change, empty strings clearing a field
    const change = Object.fromEntries(Object.entries({ status, branch, pr, start, due, repo, summary }).filter(([, v]) => v !== undefined));
    const asked = Object.keys(change);
    if (tasks && (id || asked.some((k) => k !== 'status'))) throw new BoardError('invalid_argument', 'tasks takes status and text only, and no task');
    const ids = tasks ? [...new Set(tasks)] : id ? [id] : null;
    if (!ids) {
      if (asked.length) throw new BoardError('invalid_argument', 'status, branch, pr, start, due, repo and summary need a task');
      if (!text?.trim()) throw new BoardError('invalid_argument', 'a notice needs text');
      const at = now();
      await apply(member, project, [{ op: 'set', path: `notices/n-${stampId(at, me)}`, if_absent: true,
        data: { at, author: me, kind: 'agent', type: type || 'note', text } }]);
      return 'posted notice';
    }
    if (!text?.trim() && !asked.length) throw new BoardError('invalid_argument', 'pass text, or a change');
    // a status outside the five is checked against the board's own list, read only on that rare path
    if (status !== undefined && TASK_STATUSES.indexOf(status) < 0) {
      const statuses = boardStatuses((await get(project, 'meta/config'))?.data);
      if (statuses.indexOf(status) < 0) throw new BoardError('invalid_argument', `status ${status} is not on this board (${statuses.join(', ')}); a board adds statuses in meta/config.statuses`);
    }
    return retrying(async () => {
      const got = await read(project, [...ids.map((i) => ({ path: `tasks/${i}` })), ...(summary !== undefined ? [{ path: `details/${id}` }] : [])]);
      const ts = got.slice(0, ids.length), det = got[ids.length] ?? null;
      const at = now(), patches = new Map(), writes = [], keys = [];
      ts.forEach((t, n) => {
        if (!t) throw new BoardError('not_found', `no task ${ids[n]}`);
        const d = t.data, key = d.key || t.id, holder = holderOf(d);
        // the thread names the holder when the change took override
        const overriding = !mayChange(d, me, change, false);
        if (overriding && !override) {
          throw new BoardError('not_yours', `${key} is held by ${holder}; you may post text or move its due day${statusOf(d) === 'review' ? ', or review it (status done or doing)' : ''}; for the rest ask in its thread, or override true when your person tells you to`);
        }
        const patch = { updatedAt: at, lastMessageAt: at, lastMessageBy: me };
        for (const f of ['branch', 'pr', 'start', 'due', 'repo']) if (f in change) patch[f] = change[f] || null;
        if (status !== undefined) Object.assign(patch, { status }, statusEffects(d, status, at));
        // with no text, the thread still says what changed
        const said = `${text?.trim() || [
          status && `status ${status}`, branch !== undefined && `branch ${branch || 'none'}`, pr !== undefined && `pr ${pr || 'none'}`,
          start !== undefined && `start ${start || 'none'}${day(d.start) ? ` (was ${d.start})` : ''}`,
          due !== undefined && `due ${due || 'none'}${day(d.due) ? ` (was ${d.due})` : ''}`,
          repo !== undefined && `repo ${repo || 'none'}`, summary !== undefined && 'summary updated',
        ].filter(Boolean).join(' · ') || 'updated'}${overriding ? ` (override; held by ${holder})` : ''}`;
        const update = { op: 'update', path: `tasks/${t.id}`, if_version: t.version, data: patch, ...(overriding && { override: true }) };
        patches.set(t.id, patch);
        keys.push(key);
        writes.push(update, { op: 'set', path: `tasks/${t.id}/messages/${stampId(at, me)}`, if_absent: true, data: {
          at, author: me, kind: 'agent', type: type || (status === 'blocked' ? 'blocker' : 'update'), text: said } });
        // the summary goes first, so the database judges it against the task as it stands, not after this status
        // change: a reviewer finishing a task writes its summary in the same call
        if (summary !== undefined) {
          const s = { summary, summaryAt: at }, o = overriding && { override: true };
          writes.unshift(det ? { op: 'update', path: `details/${id}`, if_version: det.version, data: s, ...o } : { op: 'set', path: `details/${id}`, if_absent: true, data: s, ...o });
        }
      });
      const { more, unblocked } = status === 'done' ? await unblockDependents(project, keys, patches) : { more: [], unblocked: [] };
      writes.push(...more);
      if (writes.length > 100) throw new BoardError('invalid_argument', `${writes.length} writes is more than one call takes (100): pass fewer tasks`);
      await apply(member, project, writes);
      return [`ok ${keys.join(', ')}${status ? ` → ${status}` : ''}`, unblocked.length && `unblocked ${unblocked.sort(keyOrder).join(', ')}`].filter(Boolean).join(' · ');
    });
  }

  // An agent's batch writes; the database holds them to the task rules. With override (only when the agent's person
  // says so) every task and details write carries it, and each task touched gets a thread line saying what changed.
  async function batch(member, project, writes, override = false) {
    if (!override) return apply(member, project, writes);
    const me = member.person, at = now(), notes = new Map();
    const out = writes.map((w) => {
      const m = /^(tasks|details)\/([^/]+)$/.exec(w.path);
      if (!m) return w;
      notes.set(m[2], [...(notes.get(m[2]) || []), ...Object.keys(w.data || { [w.op]: 1 })]);
      // the task says who wrote last, so its holder's next start shows the change
      const said = m[1] === 'tasks' && w.op !== 'delete' && { data: { ...w.data, lastMessageAt: at, lastMessageBy: me } };
      return { ...w, ...said, override: true };
    });
    for (const [id, fields] of notes) {
      out.push({ op: 'set', path: `tasks/${id}/messages/${stampId(at, me)}`, if_absent: true,
        data: { at, author: me, kind: 'agent', type: 'update', text: `changed ${[...new Set(fields)].join(', ')} (override)` } });
    }
    return apply(member, project, out);
  }

  return { start, task, claim, post, batch, projectFor };
}
