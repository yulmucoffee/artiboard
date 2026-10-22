// The everyday agent actions, each one tool call: start a session, read a task, claim, post.
// They answer in short text lines, check versions on the server and stamp times with the server clock,
// so an agent spends no tokens on reads before a write, on version numbers or on `date`.
import { BoardError, now, stampId, toBoardError } from './core.js';

// 2026-10-21T08:57:33.000Z -> 10-21 08:57Z
const short = (iso) => (typeof iso === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d/.test(iso) ? `${iso.slice(5, 10)} ${iso.slice(11, 16)}Z` : '');
const oneLine = (s) => String(s ?? '').replace(/\s*\n\s*/g, ' ').trim();
function keyOrder(a, b) {
  const p = (k) => { const m = /^(.*?)(\d+)-(\d+)$/.exec(k || ''); return m ? [m[1], +m[2], +m[3]] : [k || '', 0, 0]; };
  const x = p(a), y = p(b);
  return x[0] < y[0] ? -1 : x[0] > y[0] ? 1 : x[1] - y[1] || x[2] - y[2];
}
const holderOf = (d) => d.claimedBy?.who || d.owner || null;
const OPEN = ['doing', 'review', 'blocked'];
const CLAIMED = { ko: '집었어요.', en: 'Claimed.' };

// a pinned write lost a race (someone wrote in between): read again and redo it once
async function retrying(fn) {
  try { return await fn(); } catch (e) {
    if (toBoardError(e).code !== 'version_conflict') throw e;
    return fn();
  }
}

function taskLine(d, id, withStatus) {
  const bits = [d.key || id];
  if (withStatus) bits.push(d.status || 'todo');
  if (d.feature) bits.push(`[${d.feature}]`);
  if (d.branch && withStatus) bits.push(d.branch);
  if (d.pr && withStatus) bits.push(d.pr);
  return `${bits.join(' ')} ${d.title || ''}`.trim();
}
const msgLine = (m) => `${short(m.at)} ${m.author || '?'}${m.type && m.type !== 'note' ? ` ${m.type}` : ''}: ${oneLine(m.text)}`;

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

  // Session start: notices after this person's cursor (and move the cursor), their open tasks, and ready work.
  async function start(member, project, { ready = 8, peek = false } = {}) {
    const me = member.person;
    const [config, cursor, mine, todo] = await Promise.all([
      get(project, 'meta/config'),
      get(project, `cursors/${me}`),
      query(project, 'tasks', { where: [{ field: 'owner', op: '==', value: me }, { field: 'status', op: 'in', value: OPEN }], limit: 50 }),
      ready ? query(project, 'tasks', { where: [{ field: 'status', op: '==', value: 'todo' }, { field: 'waitingOn', op: '==', value: [] }], limit: 200 }) : [],
    ]);
    const since = cursor?.data?.noticesAt || null;
    const notices = since
      ? await query(project, 'notices', { where: [{ field: 'at', op: '>', value: since }], order: [{ field: 'at' }], limit: 20 })
      : (await query(project, 'notices', { order: [{ field: 'at', dir: 'desc' }], limit: 5 })).reverse();
    const newest = notices.map((n) => n.data.at).filter((a) => typeof a === 'string').sort().pop();
    if (!peek && newest && (!since || newest > since)) await moveCursor(member, project, cursor, newest).catch(() => {});

    const c = config?.data || {};
    const free = todo.filter((t) => !t.data.claimedBy).sort((a, b) => keyOrder(a.data.key || a.id, b.data.key || b.id));
    const out = [`${me} · ${project}${c.milestone ? ` · ${c.milestone}` : ''}`];
    out.push(notices.length ? `notices${since ? ' (new)' : ' (latest)'}:` : 'notices: none new');
    notices.forEach((n) => out.push(msgLine(n.data)));
    if (mine.length) {
      out.push('mine:');
      mine.sort((a, b) => keyOrder(a.data.key || a.id, b.data.key || b.id)).forEach((t) => out.push(taskLine(t.data, t.id, true)));
    }
    if (ready) {
      out.push(free.length ? `ready (${free.length > ready ? `${ready} of ` : ''}${free.length}):` : 'ready: none');
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
    const out = [`${d.key || id} ${d.status || 'todo'} · ${who}${d.branch ? ` · ${d.branch}` : ''}${d.pr ? ` · ${d.pr}` : ''}`, d.title || ''];
    if (d.deps?.length) out.push(`deps ${d.deps.join(', ')}${d.waitingOn?.length ? ` · waiting on ${d.waitingOn.join(', ')}` : ''}`);
    out.push(...detailLines(det));
    if (thread) {
      out.push(msgs.length ? `messages${since ? ' after summary' : ''}:` : `messages${since ? ' after summary' : ''}: none`);
      msgs.forEach((m) => out.push(msgLine(m.data)));
    }
    return out.join('\n');
  }

  // Claim a ready task and post the claim, then hand back its details so work can start at once.
  async function claim(member, project, id, { text, session } = {}) {
    const me = member.person;
    const [det, config] = await Promise.all([get(project, `details/${id}`), get(project, 'meta/config')]);
    const result = await retrying(async () => {
      const t = await get(project, `tasks/${id}`);
      if (!t) throw new BoardError('not_found', `no task ${id}`);
      const d = t.data, status = d.status || 'todo', holder = holderOf(d);
      if (d.claimedBy?.who === me && status !== 'todo') return 'already yours';
      if (status !== 'todo' || d.claimedBy) throw new BoardError('taken', `${d.key || id} is ${status}${holder ? `, held by ${holder}` : ''}; pick another`);
      if (d.waitingOn?.length) throw new BoardError('waiting', `${d.key || id} waits on ${d.waitingOn.join(', ')}`);
      const at = now();
      await apply(member, project, [
        { op: 'update', path: `tasks/${id}`, if_version: t.version, data: {
          status: 'doing', owner: me, claimedBy: { who: me, agent: true, ...(session && { session }), at }, updatedAt: at, lastMessageAt: at } },
        { op: 'set', path: `tasks/${id}/messages/${stampId(at, me)}`, data: {
          at, author: me, kind: 'agent', type: 'update', text: text || CLAIMED[config?.data?.lang] || CLAIMED.en } },
      ]);
      return 'claimed';
    });
    return [`${result} ${id}`, ...detailLines(det)].join('\n');
  }

  // A thread message, optionally with a status, branch, PR or summary change; without a task, a notice.
  // status done also takes the key out of every dependent's waitingOn.
  async function post(member, project, { task: id, text, type, status, branch, pr, summary }) {
    const me = member.person;
    if (!id) {
      if (status || branch !== undefined || pr !== undefined || summary !== undefined) throw new BoardError('invalid_argument', 'status, branch, pr and summary need a task');
      const at = now();
      await apply(member, project, [{ op: 'set', path: `notices/n-${stampId(at, me)}`, if_absent: true,
        data: { at, author: me, kind: 'agent', type: type || 'note', text } }]);
      return 'posted notice';
    }
    const changes = status !== undefined || branch !== undefined || pr !== undefined;
    return retrying(async () => {
      const [t, det] = await Promise.all([get(project, `tasks/${id}`), summary !== undefined ? get(project, `details/${id}`) : null]);
      if (!t) throw new BoardError('not_found', `no task ${id}`);
      const d = t.data, key = d.key || id, holder = holderOf(d);
      if ((changes || summary !== undefined) && holder && holder !== me) {
        throw new BoardError('not_yours', `${key} is held by ${holder}; post without status, branch, pr or summary, or ask your person`);
      }
      const at = now();
      const patch = { updatedAt: at, lastMessageAt: at };
      if (status !== undefined) patch.status = status;
      if (status === 'todo') patch.claimedBy = null;
      if (branch !== undefined) patch.branch = branch || null;
      if (pr !== undefined) patch.pr = pr || null;
      const writes = [
        { op: 'update', path: `tasks/${id}`, if_version: t.version, data: patch },
        { op: 'set', path: `tasks/${id}/messages/${stampId(at, me)}`, data: {
          at, author: me, kind: 'agent', type: type || (status === 'blocked' ? 'blocker' : 'update'), text } },
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

  return { start, task, claim, post };
}
