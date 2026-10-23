// The everyday agent actions, each one tool call: start a session, read a task, claim, post.
// They answer in short text lines, check versions on the server and stamp times with the server clock,
// so an agent spends no tokens on reads before a write, on version numbers or on `date`.
import { BOARD_RULES, BoardError, now, repoName, reposOf, stampId, toBoardError } from './core.js';

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
const holderOf = (d) => d.claimedBy?.who || d.owner || null;
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

export function makeFlow(store) {
  const get = (project, path) => store.get(project, path);
  const query = (project, collection, opts) => store.query(project, collection, opts);
  const apply = (member, project, writes) => store.apply(member.uid, project, writes);

  // The project a repository belongs to: the one whose meta/config.repos lists it.
  async function projectFor(repo) {
    const want = repoName(repo);
    if (!want) throw new BoardError('invalid_argument', 'repo is not a GitHub repository: pass owner/name or the git remote URL');
    const hits = (await store.overview()).filter((p) => reposOf(p).some((r) => repoName(r.repo) === want)).map((p) => p.id);
    if (!hits.length) throw new BoardError('not_found', `no project lists ${want}; board_projects shows each project's repos`);
    if (hits.length > 1) throw new BoardError('invalid_argument', `${want} is on ${hits.join(', ')}; pass project`);
    return hits[0];
  }

  // Ready work: todo tasks nobody holds whose deps are all done. waitingOn is the stored answer the page and the
  // ready query rely on; here it is checked against the dep tasks themselves and repaired in passing, so a task
  // written without it, or a dep finished while no page was open, still shows up (and a stale one stays out).
  async function readyWork(member, project, todo) {
    const free = todo.filter((t) => !t.data.claimedBy);
    const depsOf = (t) => (Array.isArray(t.data.deps) ? t.data.deps.filter((k) => typeof k === 'string') : []);
    const keys = [...new Set(free.flatMap(depsOf))];
    const done = new Set(), chunks = [];
    for (let i = 0; i < keys.length; i += 100) chunks.push(keys.slice(i, i + 100));
    // one round trip for all of them, however many deps there are
    for (const found of await Promise.all(chunks.map((ks) => query(project, 'tasks', { where: [{ field: 'key', op: 'in', value: ks }, { field: 'status', op: '==', value: 'done' }], limit: 200 })))) {
      for (const d of found) done.add(d.data.key);
    }
    const repairs = [], ready = [];
    for (const t of free) {
      const want = depsOf(t).filter((k) => !done.has(k)), cur = t.data.waitingOn;
      if (!Array.isArray(cur) || cur.length !== want.length || cur.some((k, i) => k !== want[i])) {
        repairs.push({ op: 'update', path: `tasks/${t.id}`, if_version: t.version, data: { waitingOn: want } });
      }
      if (!want.length) ready.push(t);
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
    const [config, cursor, owned, todo, own, notes, latest] = await Promise.all([
      get(project, 'meta/config'),
      get(project, `cursors/${me}`),
      query(project, 'tasks', { where: [{ field: 'owner', op: '==', value: me }], limit: 50 }),
      ready ? query(project, 'tasks', { where: [{ field: 'status', op: '==', value: 'todo' }], limit: 200 }) : [],
      rules ? get(project, 'meta/rules') : null,
      rules ? get(project, 'meta/notes') : null,
      query(project, 'notices', { order: [{ field: 'at', dir: 'desc' }], limit: 20 }),
    ]);
    // a todo task you own was assigned to you and not started: it is listed as yours, not as anyone's ready work
    const mine = owned.filter((t) => (t.data.status || 'todo') !== 'done');
    // the 20 latest notices: those after the cursor are new (all 20 new: older ones went unread); no cursor yet, the latest 5
    const since = cursor?.data?.noticesAt || null;
    const notices = (since ? latest.filter((n) => typeof n.data.at === 'string' && n.data.at > since) : latest.slice(0, 5)).reverse();
    const newest = notices.map((n) => n.data.at).filter((a) => typeof a === 'string').sort().pop();
    const moving = !peek && newest && (!since || newest > since) ? moveCursor(member, project, cursor, newest).catch(() => {}) : null;

    // repo, given with a project, may also be one of its labels; one the project does not list turns the filter off
    const c = config?.data || {}, repos = reposOf(c);
    let want = repo ? repoName(repos.find((r) => r.label === repo)?.repo ?? repo) : null, stray = '';
    if (repo && (!want || !repos.some((r) => repoName(r.repo) === want))) {
      stray = `repo ${want || '(not a GitHub repository)'} is not linked to ${project}; showing all ready work (link it in meta/config.repos)`;
      want = null;
    }
    let free = (ready ? await readyWork(member, project, todo) : []).filter((t) => t.data.owner !== me).sort((a, b) => keyOrder(a.data.key || a.id, b.data.key || b.id));
    await moving;
    const elsewhere = want ? free.filter((t) => { const r = taskRepo(t.data, repos); return r && r !== want; }).length : 0;
    if (want) free = free.filter((t) => { const r = taskRepo(t.data, repos); return !r || r === want; });

    const out = [`${me} · ${project}${c.milestone ? ` · ${c.milestone}` : ''}`];
    if (repos.length) out.push(`repos: ${repoList(repos)}`);
    if (stray) out.push(stray);
    if (rules) {
      out.push(BOARD_RULES);
      const r = own?.data;
      if (typeof r?.text === 'string' && r.text.trim()) out.push(`project rules (rev ${r.rev || 1}${r.by ? ` · ${r.by}` : ''}${r.updatedAt ? ` ${short(r.updatedAt).slice(0, 5)}` : ''}):`, r.text.trim());
      else out.push('project rules: none yet');
      // the shared status (schedule, where things stand) is long and changes daily: pointed at, not printed
      const n = notes?.data;
      if (typeof n?.text === 'string' && n.text.trim()) out.push(`project notes: meta/notes (rev ${n.rev || 1}${n.updatedAt ? ` ${short(n.updatedAt).slice(0, 5)}` : ''}); board_get it when you need the schedule or status`);
    }
    out.push(notices.length ? `notices${since ? (notices.length === latest.length ? ' (new, the latest 20; older ones skipped)' : ' (new)') : ' (latest)'}:` : 'notices: none new');
    notices.forEach((n) => out.push(msgLine(n.data)));
    if (mine.length) {
      out.push('mine:');
      mine.sort((a, b) => keyOrder(a.data.key || a.id, b.data.key || b.id)).forEach((t) => out.push(taskLine(t.data, t.id, true)));
    }
    if (ready) {
      const more = elsewhere ? `; ${elsewhere} more in other repos` : '';
      out.push(free.length ? `ready (${free.length > ready ? `${ready} of ` : ''}${free.length}${more}):` : `ready: none${more}`);
      free.slice(0, ready).forEach((t) => out.push(taskLine(t.data, t.id)));
    }
    return out.join('\n');
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
    const [t, det] = await Promise.all([get(project, `tasks/${id}`), get(project, `details/${id}`)]);
    if (!t) throw new BoardError('not_found', `no task ${id}`);
    const d = t.data;
    const since = det?.data?.summaryAt;
    const msgs = thread
      ? (await query(project, `tasks/${id}/messages`, {
          where: since ? [{ field: 'at', op: '>', value: since }] : [], order: [{ field: 'at', dir: 'desc' }], limit: thread,
        })).reverse()
      : [];
    const who = d.claimedBy?.who ? `${d.claimedBy.who}${d.claimedBy.agent ? ' (agent)' : ''}` : d.owner || 'unassigned';
    const out = [`${d.key || id} ${d.status || 'todo'} · ${who}${d.repo ? ` · repo:${d.repo}` : ''}${d.branch ? ` · ${d.branch}` : ''}${d.pr ? ` · ${d.pr}` : ''}`, d.title || ''];
    if (d.deps?.length) out.push(`deps ${d.deps.join(', ')}${d.waitingOn?.length ? ` · waiting on ${d.waitingOn.join(', ')}` : ''}`);
    const dates = [day(d.start) && `start ${d.start}`, day(d.due) && `due ${d.due}`, d.doneAt && `done ${short(d.doneAt)}`].filter(Boolean);
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
    const [det, config] = await Promise.all([get(project, `details/${id}`), get(project, 'meta/config')]);
    const result = await retrying(async () => {
      const t = await get(project, `tasks/${id}`);
      if (!t) throw new BoardError('not_found', `no task ${id}`);
      const d = t.data, status = d.status || 'todo', holder = holderOf(d);
      if (d.claimedBy?.who === me && status !== 'todo') return `already yours ${id}`;
      const held = status !== 'todo' || !!d.claimedBy;
      if (held && (!override || status === 'done')) throw new BoardError('taken', `${d.key || id} is ${status}${holder ? `, held by ${holder}` : ''}; pick another`);
      if (!held && d.waitingOn?.length) throw new BoardError('waiting', `${d.key || id} waits on ${d.waitingOn.join(', ')}`);
      const from = held && holder && holder !== me ? holder : null;
      const at = now();
      await apply(member, project, [
        { op: 'update', path: `tasks/${id}`, if_version: t.version, data: {
          status: 'doing', owner: me, claimedBy: { who: me, agent: true, ...(session && { session }), at }, updatedAt: at, lastMessageAt: at } },
        { op: 'set', path: `tasks/${id}/messages/${stampId(at, me)}`, if_absent: true, data: {
          at, author: me, kind: 'agent', type: 'update', text: (text || CLAIMED[config?.data?.lang] || CLAIMED.en) + (from ? ` (taken over from ${from})` : '') } },
      ]);
      return from ? `took over ${id} from ${from}` : `claimed ${id}`;
    });
    return [result, ...detailLines(det)].join('\n');
  }

  // A thread message, optionally with a status, branch, PR, start or due day, repo or summary change; without a task, a notice.
  // Only the task's holder changes it, except: anyone moves its due day (the thread records who and from what), anyone
  // reviews a task in review (status done after the merge, or doing to send it back, with a summary), and override,
  // passed when the agent's person says so, opens the rest (the thread names the holder).
  // status todo releases the task (no holder, no owner). status done stamps doneAt (leaving done clears it) and takes
  // the key out of every dependent's waitingOn.
  async function post(member, project, { task: id, text, type, status, branch, pr, start, due, repo, summary, override }) {
    const me = member.person;
    if (!id) {
      if (status || branch !== undefined || pr !== undefined || start !== undefined || due !== undefined || repo !== undefined || summary !== undefined) {
        throw new BoardError('invalid_argument', 'status, branch, pr, start, due, repo and summary need a task');
      }
      if (!text?.trim()) throw new BoardError('invalid_argument', 'a notice needs text');
      const at = now();
      await apply(member, project, [{ op: 'set', path: `notices/n-${stampId(at, me)}`, if_absent: true,
        data: { at, author: me, kind: 'agent', type: type || 'note', text } }]);
      return 'posted notice';
    }
    const holderOnly = status !== undefined || branch !== undefined || pr !== undefined || start !== undefined || repo !== undefined || summary !== undefined;
    if (!text?.trim() && !holderOnly && due === undefined) throw new BoardError('invalid_argument', 'pass text, or a change');
    return retrying(async () => {
      const [t, det] = await Promise.all([get(project, `tasks/${id}`), summary !== undefined ? get(project, `details/${id}`) : null]);
      if (!t) throw new BoardError('not_found', `no task ${id}`);
      const d = t.data, key = d.key || id, holder = holderOf(d);
      const theirs = holderOnly && holder && holder !== me;
      const review = d.status === 'review' && (status === 'done' || status === 'doing')
        && branch === undefined && pr === undefined && start === undefined && repo === undefined;
      if (theirs && !override && !review) {
        throw new BoardError('not_yours', `${key} is held by ${holder}; you may post text or move its due day${d.status === 'review' ? ', or review it (status done or doing)' : ''}; for the rest ask in its thread, or override true when your person tells you to`);
      }
      const at = now();
      const patch = { updatedAt: at, lastMessageAt: at };
      if (status !== undefined) patch.status = status;
      if (status === 'todo') { patch.claimedBy = null; patch.owner = null; }
      if (status === 'done' && d.status !== 'done') patch.doneAt = at;
      if (status !== undefined && status !== 'done' && d.doneAt) patch.doneAt = null;
      if (branch !== undefined) patch.branch = branch || null;
      if (pr !== undefined) patch.pr = pr || null;
      if (start !== undefined) patch.start = start || null;
      if (due !== undefined) patch.due = due || null;
      if (repo !== undefined) patch.repo = repo || null;
      // with no text, the thread still says what changed
      const said = `${text?.trim() || [
        status && `status ${status}`, branch !== undefined && `branch ${branch || 'none'}`, pr !== undefined && `pr ${pr || 'none'}`,
        start !== undefined && `start ${start || 'none'}${day(d.start) ? ` (was ${d.start})` : ''}`,
        due !== undefined && `due ${due || 'none'}${day(d.due) ? ` (was ${d.due})` : ''}`,
        repo !== undefined && `repo ${repo || 'none'}`, summary !== undefined && 'summary updated',
      ].filter(Boolean).join(' · ') || 'updated'}${theirs && !review ? ` (override; held by ${holder})` : ''}`;
      const writes = [
        { op: 'update', path: `tasks/${id}`, if_version: t.version, data: patch },
        { op: 'set', path: `tasks/${id}/messages/${stampId(at, me)}`, if_absent: true, data: {
          at, author: me, kind: 'agent', type: type || (status === 'blocked' ? 'blocker' : 'update'), text: said } },
      ];
      if (summary !== undefined) {
        const s = { summary, summaryAt: at };
        writes.push(det ? { op: 'update', path: `details/${id}`, if_version: det.version, data: s } : { op: 'set', path: `details/${id}`, if_absent: true, data: s });
      }
      const unblocked = [];
      if (status === 'done') {
        const after = await query(project, 'tasks', { where: [{ field: 'deps', op: 'array-contains', value: key }], limit: 200 });
        for (const o of after) {
          const waiting = Array.isArray(o.data.waitingOn) ? o.data.waitingOn : [];
          if (!waiting.includes(key)) continue;
          const left = waiting.filter((k) => k !== key);
          writes.push({ op: 'update', path: `tasks/${o.id}`, if_version: o.version, data: { waitingOn: left } });
          if (!left.length && (o.data.status || 'todo') === 'todo') unblocked.push(o.data.key || o.id);
        }
      }
      await apply(member, project, writes);
      return [`ok ${key}${status ? ` → ${status}` : ''}`, unblocked.length && `unblocked ${unblocked.sort(keyOrder).join(', ')}`].filter(Boolean).join(' · ');
    });
  }

  return { start, task, claim, post, projectFor };
}
