// SQLite store: one file holds every project, member and document, so a board runs from a laptop,
// a small server or a container with nothing else installed. Writes are atomic per batch, and every
// change is pushed to the pages that watch the project (one server process owns the file).
import { EventEmitter } from 'node:events';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomBytes, randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import {
  BoardError, checkCollection, checkField, guardWrite, hashToken, isToken, MAX_DOC, MAX_PAGE, newToken, now, PERSON_ID, PROJECT_ID,
  projectSeed, ROLES, splitPath,
} from '../core.js';
import { changedFields, holderOf, mayChange } from '../tasks.js';

const SCHEMA = `
create table if not exists projects (
  id text primary key, title text not null, created_at text not null, created_by text);
create table if not exists docs (
  project text not null references projects (id) on delete cascade,
  collection text not null, doc_id text not null, data text not null, version integer not null default 1,
  created_at text not null, updated_at text not null, updated_by text,
  primary key (project, collection, doc_id));
create index if not exists docs_changed on docs (project, updated_at);
create index if not exists docs_updated on docs (updated_at);
-- the fields the everyday tools filter tasks on; the query text below spells them the same way so these indexes apply
create index if not exists docs_status on docs (project, collection, json_extract(data, '$."status"'));
create index if not exists docs_key on docs (project, collection, json_extract(data, '$."key"'));
create index if not exists docs_owner on docs (project, collection, json_extract(data, '$."owner"'));
create table if not exists members (
  uid text primary key, person text not null unique, name text, email text unique,
  role text not null default 'member', created_at text not null);
create table if not exists tokens (
  id text primary key, uid text not null references members (uid) on delete cascade, label text not null,
  token_hash text not null unique, created_at text not null, last_used_at text, revoked_at text);
create table if not exists sessions (
  hash text primary key, uid text not null references members (uid) on delete cascade, expires_at integer not null);
create table if not exists codes (
  hash text primary key, uid text not null references members (uid) on delete cascade, expires_at integer not null);
create table if not exists leases (path text primary key, holder text not null, expires_at integer not null);
create table if not exists pages (
  project text primary key references projects (id) on delete cascade, html text not null, version integer not null,
  updated_at text not null, updated_by text);
`;

const SESSION_MS = 30 * 864e5;
const CODE_MS = 36e5;

// A JSON value as two columns: the value and its json_type. Numbers compare as numbers, booleans and null by type.
const kind = (t) => `(case when ${t} in ('integer','real') then 'number' else ${t} end)`;
const same = (lv, lt, rv, rt) => `(${kind(lt)} = ${kind(rt)} and (${lt} in ('null','true','false') or ${lv} = ${rv}))`;
// field names are checked against [A-Za-z0-9_.], so the path can sit in the SQL text
const jpath = (field) => `'$.${checkField(field).map((k) => `"${k}"`).join('.')}'`;

function condition(w, params) {
  const p = jpath(w.field), ex = `json_extract(data, ${p})`, ty = `json_type(data, ${p})`, v = w.value;
  const equal = () => { params.push(JSON.stringify([v])); return `exists (select 1 from json_each(?) r where ${same(ex, ty, 'r.value', 'r.type')})`; };
  // a string or a number compares directly, so an index on the field applies and nothing is scanned per row
  const scalar = (x) => typeof x === 'string' || (typeof x === 'number' && Number.isFinite(x));
  const typed = (x) => (typeof x === 'string' ? `${ty} = 'text'` : `${ty} in ('integer','real')`);
  switch (w.op) {
    case '==':
      if (scalar(v)) { params.push(v); return `(${typed(v)} and ${ex} = ?)`; }
      return equal();
    case '!=': return `not ${equal()}`;
    case '<': case '<=': case '>': case '>=': {
      if (typeof v === 'number') { params.push(v); return `(${ty} in ('integer','real') and ${ex} ${w.op} ?)`; }
      if (typeof v === 'string') { params.push(v); return `(${ty} = 'text' and ${ex} ${w.op} ?)`; }
      throw new BoardError('invalid_argument', `${w.op} needs a string or a number`);
    }
    case 'array-contains':
      params.push(JSON.stringify([v]));
      return `(${ty} = 'array' and exists (select 1 from json_each(data, ${p}) l, json_each(?) r where ${same('l.value', 'l.type', 'r.value', 'r.type')}))`;
    case 'in': {
      const vs = Array.isArray(v) ? v : [v];
      if (vs.length && vs.every((x) => typeof x === 'string')) { params.push(JSON.stringify(vs)); return `(${typed('')} and ${ex} in (select value from json_each(?)))`; }
      params.push(JSON.stringify(vs));
      return `exists (select 1 from json_each(?) r where ${same(ex, ty, 'r.value', 'r.type')})`;
    }
    default: throw new BoardError('invalid_argument', `unknown op: ${w.op}`);
  }
}

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const docOut = (r) => ({ id: r.doc_id, path: `${r.collection}/${r.doc_id}`, version: r.version, updated_at: r.updated_at, data: JSON.parse(r.data) });
const rowOut = (r) => ({ collection: r.collection, doc_id: r.doc_id, version: r.version, updated_at: r.updated_at, data: JSON.parse(r.data) });
const memberOut = (r) => r && { uid: r.uid, person: r.person, name: r.name, email: r.email, role: r.role };

export function openSqlite({ file, boardUrl }) {
  if (file !== ':memory:') mkdirSync(dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('pragma journal_mode = wal; pragma foreign_keys = on; pragma busy_timeout = 5000;');
  db.exec(SCHEMA);
  const changes = new EventEmitter();
  changes.setMaxListeners(0);
  const q = (sql) => db.prepare(sql);

  // updated_at strictly increases, so "everything after the newest row I saw" never skips a row
  let last = q('select max(updated_at) m from docs').get().m || '';
  function stamp() {
    let at = now();
    if (at <= last) at = new Date(Date.parse(last) + 1).toISOString();
    last = at;
    return at;
  }

  function tx(fn) {
    db.exec('begin immediate');
    try { const out = fn(); db.exec('commit'); return out; } catch (e) { db.exec('rollback'); throw e; }
  }

  const memberOf = (uid) => q('select uid, person, role from members where uid = ?').get(uid);
  const roleOf = (uid) => (uid == null ? 'admin' : q('select role from members where uid = ?').get(uid)?.role || null);
  function checkProject(project) {
    if (!q('select 1 from projects where id = ?').get(project)) throw new BoardError('not_found', `no project ${project ?? 'null'}`);
  }

  async function get(project, path) {
    checkProject(project);
    const [c, d] = splitPath(path);
    const r = q('select * from docs where project = ? and collection = ? and doc_id = ?').get(project, c, d);
    return r ? docOut(r) : null;
  }

  async function query(project, collection, { where = [], order = [], limit = 20, after = null } = {}) {
    checkProject(project);
    checkCollection(collection);
    if (!Array.isArray(where || []) || !Array.isArray(order || []) || (where || []).length > 10 || (order || []).length > 3) {
      throw new BoardError('invalid_argument', 'where is a list of at most 10 conditions, order_by of at most 3');
    }
    const params = [project, collection];
    const conds = ['project = ?', 'collection = ?'];
    for (const w of where || []) conds.push(condition(w, params));
    const ord = (order || []).map((o) => {
      const p = jpath(o.field), dir = String(o.dir || 'asc').toLowerCase() === 'desc' ? 'desc' : 'asc';
      return `(json_type(data, ${p}) is null or json_type(data, ${p}) = 'null'), json_extract(data, ${p}) ${dir}`;
    });
    if (after != null && !ord.length) { conds.push('doc_id > ?'); params.push(String(after)); }
    const n = Math.max(1, Math.min(Number(limit) || 20, 200));
    const sql = `select * from docs where ${conds.join(' and ')} order by ${[...ord, 'doc_id'].join(', ')} limit ${n}`;
    return q(sql).all(...params).map(docOut);
  }

  // The task rules on every member's write to a task or its details (the system, actor null, is not held to them):
  // a task someone else holds changes only as the rules open it to everyone, unless the write carries override.
  function holdTo(project, me, w, c, d, cur, payload, i) {
    const taskRow = c === 'tasks' ? cur : q("select data from docs where project = ? and collection = 'tasks' and doc_id = ?").get(project, d);
    if (!taskRow) return;
    const task = JSON.parse(taskRow.data), before = cur ? JSON.parse(cur.data) : {};
    const patch = changedFields(before, w.op === 'delete' ? {} : w.op === 'set' ? payload : { ...before, ...payload });
    if (c === 'details') delete patch.summaryAt;
    if (!mayChange(task, me, patch, w.override === true)) {
      throw new BoardError('not_yours', `${task.key || d} is held by ${holderOf(task)}; pass override true only when your person says so`, i);
    }
  }

  // Each write: {op: set|update|delete, path, data?, if_version?, if_absent?, override?}. set replaces, update merges
  // top-level fields.
  async function apply(actor, project, writes) {
    const member = actor == null ? null : memberOf(actor);
    const role = actor == null ? 'admin' : member?.role;
    if (!role || role === 'viewer') throw new BoardError('permission_denied', 'this account cannot write');
    checkProject(project);
    if (!Array.isArray(writes) || !writes.length || writes.length > 100) throw new BoardError('invalid_argument', 'writes must be an array of 1 to 100 entries');
    const touched = [];
    const out = tx(() => writes.map((w, i) => {
      if (!isObject(w)) throw new BoardError('invalid_argument', 'each write must be an object', i);
      const [c, d] = splitPath(w.path, i);
      const payload = w.data ?? {};
      if ((w.op === 'set' || w.op === 'update') && (!isObject(payload) || JSON.stringify(payload).length > MAX_DOC)) {
        throw new BoardError('invalid_argument', 'data must be an object under 256 KiB', i);
      }
      const cur = q('select * from docs where project = ? and collection = ? and doc_id = ?').get(project, c, d);
      if (role !== 'admin') guardWrite(member, w, c, d, cur && JSON.parse(cur.data), payload, i);
      if (w.if_version != null && (!cur || cur.version !== Number(w.if_version))) {
        throw new BoardError('version_conflict', `${w.path} is at version ${cur ? cur.version : 'none (missing)'}, not ${w.if_version}`, i);
      }
      if (w.if_absent && cur) throw new BoardError('already_exists', `${w.path} already exists`, i);
      // after the version check: a write that lost a race rereads and decides again, rather than being refused
      if (member && (c === 'tasks' || c === 'details')) holdTo(project, member.person, w, c, d, cur, payload, i);
      const at = stamp();
      if (w.op === 'delete') {
        q('delete from docs where project = ? and collection = ? and doc_id = ?').run(project, c, d);
        if (cur) touched.push({ collection: c, doc_id: d, gone: true });
        return { path: w.path, deleted: !!cur };
      }
      let data;
      if (w.op === 'set') data = payload;
      else if (w.op === 'update') {
        if (!cur) throw new BoardError('not_found', `${w.path} does not exist`, i);
        data = { ...JSON.parse(cur.data), ...payload };
      } else throw new BoardError('invalid_argument', 'op must be set, update or delete', i);
      const version = cur ? cur.version + 1 : 1, text = JSON.stringify(data);
      q(`insert into docs (project, collection, doc_id, data, version, created_at, updated_at, updated_by) values (?, ?, ?, ?, ?, ?, ?, ?)
         on conflict (project, collection, doc_id) do update set data = excluded.data, version = excluded.version,
         updated_at = excluded.updated_at, updated_by = excluded.updated_by`).run(project, c, d, text, version, at, at, actor ?? null);
      touched.push({ collection: c, doc_id: d, data: text, version, updated_at: at });
      return { path: w.path, version };
    }));
    for (const t of touched) changes.emit(project, t.gone ? t : rowOut(t));
    seen = last;
    return out;
  }

  // ---- pages read by the browser ----

  // whole collections, single documents, the first rows of one ordered collection, or rows changed after a time
  async function readRows(project, { whole = [], docs = {}, collection, order, limit, collections, since, limited } = {}) {
    checkProject(project);
    if (collection) {
      const rows = await query(project, collection, { order, limit: limit || 200 });
      return rows.map((r) => ({ collection, doc_id: r.id, version: r.version, updated_at: r.updated_at, data: r.data }));
    }
    // a page asks for a handful of collections at once; anything bigger is not the page
    const many = (list) => { if (!Array.isArray(list) || list.length > 20) throw new BoardError('invalid_argument', 'at most 20 collections per read'); };
    // several ordered, limited reads in one request (the latest message of each task in recent activity); i says which
    if (limited) {
      many(limited);
      const out = [];
      for (const [i, r] of limited.entries()) {
        for (const d of await query(project, r?.collection, { order: r?.order, limit: r?.limit || 200 })) {
          out.push({ i, collection: r.collection, doc_id: d.id, version: d.version, updated_at: d.updated_at, data: d.data });
        }
      }
      return out;
    }
    if (collections) {
      many(collections);
      collections.forEach(checkCollection);
      return q(`select * from docs where project = ? and updated_at > ? and collection in (select value from json_each(?))`)
        .all(project, String(since || ''), JSON.stringify(collections)).map(rowOut);
    }
    many(whole);
    many(Object.keys(docs || {}));
    const out = [];
    for (const c of whole) { checkCollection(c); out.push(...q('select * from docs where project = ? and collection = ?').all(project, c).map(rowOut)); }
    for (const [c, ids] of Object.entries(docs || {})) {
      if (whole.includes(c)) continue;
      checkCollection(c);
      if (!Array.isArray(ids) || ids.length > 200) throw new BoardError('invalid_argument', 'at most 200 documents per collection');
      out.push(...q('select * from docs where project = ? and collection = ? and doc_id in (select value from json_each(?))')
        .all(project, c, JSON.stringify(ids)).map(rowOut));
    }
    return out;
  }

  // short leases, so two viewers linking the same person at once cannot both win
  async function acquire(actor, project, path, holder, ttlMs) {
    const role = roleOf(actor);
    if (!role || role === 'viewer') throw new BoardError('permission_denied', 'this account cannot write');
    checkProject(project);
    if (typeof path !== 'string' || path.length > 800 || String(holder || '').length > 200) throw new BoardError('invalid_argument', 'lease path or holder too long');
    const t = Date.now(), ttl = Math.min(Math.max(Number(ttlMs) || 5000, 100), 60000);
    q('delete from leases where expires_at < ?').run(t - 60000);
    const r = q(`insert into leases (path, holder, expires_at) values (?, ?, ?) on conflict (path) do update
      set holder = excluded.holder, expires_at = excluded.expires_at where leases.expires_at < ? or leases.holder = excluded.holder`)
      .run(`${project}:${path}`, String(holder || ''), t + ttl, t);
    return r.changes > 0;
  }

  // Writes from another process on the same file (the CLI while the site runs) reach open pages
  // through a cheap look for newer rows every two seconds, only while someone is watching.
  let seen = last, watching = 0, timer = null;
  function poll() {
    for (const r of q('select * from docs where updated_at > ? order by updated_at limit 500').all(seen)) {
      seen = r.updated_at;
      if (seen > last) last = seen;
      changes.emit(r.project, rowOut(r));
    }
  }
  function subscribe(project, fn) {
    changes.on(project, fn);
    if (!watching++) { timer = setInterval(poll, 2000); timer.unref(); }
    return () => { changes.off(project, fn); if (!--watching) clearInterval(timer); };
  }

  // ---- projects ----

  async function overview() {
    const names = new Map(q('select person, name from members').all().map((m) => [m.person, m.name || null]));
    return q('select * from projects order by created_at').all().map((p) => {
      const c = q(`select data from docs where project = ? and collection = 'meta' and doc_id = 'config'`).get(p.id);
      const cfg = c ? JSON.parse(c.data) : {};
      const tasks = {};
      let total = 0;
      for (const r of q(`select coalesce(json_extract(data, '$.status'), 'todo') s, count(*) n from docs
          where project = ? and collection = 'tasks' group by 1`).all(p.id)) { tasks[r.s] = r.n; total += r.n; }
      // the latest time written on a task or notice, so imported history keeps its own dates
      const last = q(`select max(max(coalesce(json_extract(data, '$.updatedAt'), ''), coalesce(json_extract(data, '$.lastMessageAt'), ''),
          coalesce(json_extract(data, '$.at'), ''))) t from docs where project = ? and collection in ('tasks', 'notices')`).get(p.id).t;
      // who has work in hand (doing, review, blocked) on this board, most first, with their latest three tasks
      const held = new Map();
      for (const r of q(`select doc_id, data from docs where project = ? and collection = 'tasks'
          and json_extract(data, '$."status"') in ('doing', 'review', 'blocked')`).all(p.id)) {
        const d = JSON.parse(r.data), who = d.claimedBy?.who || d.owner;
        if (typeof who !== 'string' || !who) continue;
        const w = held.get(who) || { who, name: names.get(who) || null, n: 0, agent: false, tasks: [] };
        w.n++;
        w.agent ||= d.claimedBy?.agent === true;
        w.tasks.push({ key: d.key || r.doc_id, title: d.title || '', status: d.status, at: String(d.updatedAt || '') });
        held.set(who, w);
      }
      const working = [...held.values()].sort((a, b) => b.n - a.n || a.who.localeCompare(b.who))
        .map((w) => ({ ...w, tasks: w.tasks.sort((a, b) => b.at.localeCompare(a.at)).slice(0, 3).map(({ at, ...t }) => t) }));
      return { id: p.id, title: cfg.title || p.title, subtitle: cfg.subtitle || null, repos: Array.isArray(cfg.repos) ? cfg.repos : [], created_at: p.created_at, tasks, total, working, last: /^\d{4}-/.test(last || '') ? last : null };
    }).sort((a, b) => (b.last || '').localeCompare(a.last || '') || a.created_at.localeCompare(b.created_at));
  }

  async function createProject(actor, { id, title, lang = 'en', repos = [] }) {
    const role = roleOf(actor);
    if (!role || role === 'viewer') throw new BoardError('permission_denied', 'this account cannot create projects');
    if (typeof id !== 'string' || !PROJECT_ID.test(id)) throw new BoardError('invalid_argument', 'project id must be 1 to 40 lowercase letters, digits or hyphens');
    title = String(title || '').trim();
    if (!title || title.length > 120) throw new BoardError('invalid_argument', 'title must be 1 to 120 characters');
    if (q('select 1 from projects where id = ?').get(id)) throw new BoardError('already_exists', `project ${id} already exists`);
    q('insert into projects (id, title, created_at, created_by) values (?, ?, ?, ?)').run(id, title, now(), actor ?? null);
    const author = actor == null ? 'admin' : q('select person from members where uid = ?').get(actor).person;
    try {
      await apply(null, id, projectSeed({ title, lang, members: await listMembers(), author, repos }));
    } catch (e) {
      q('delete from projects where id = ?').run(id);
      throw e;
    }
    return { id, title };
  }

  async function dropProject(id) { return q('delete from projects where id = ?').run(id).changes > 0; }
  async function projectIds() { return q('select id from projects order by id').all().map((r) => r.id); }

  // ---- a project's own page, when it has one ----

  async function getPage(project) {
    checkProject(project);
    return q('select html, version, updated_at from pages where project = ?').get(project) || null;
  }
  async function setPage(actor, project, html, ifVersion) {
    if (roleOf(actor) !== 'admin') throw new BoardError('permission_denied', 'only admins change a board page');
    checkProject(project);
    if (typeof html !== 'string' || !html.trim() || html.length > MAX_PAGE) throw new BoardError('invalid_argument', 'page must be HTML under 1 MiB');
    return tx(() => {
      const cur = q('select version from pages where project = ?').get(project);
      if (ifVersion != null && (cur?.version || 0) !== Number(ifVersion)) {
        throw new BoardError('version_conflict', `the page is at version ${cur?.version || 0}, not ${ifVersion}`);
      }
      const version = (cur?.version || 0) + 1;
      q(`insert into pages (project, html, version, updated_at, updated_by) values (?, ?, ?, ?, ?) on conflict (project)
         do update set html = excluded.html, version = excluded.version, updated_at = excluded.updated_at, updated_by = excluded.updated_by`)
        .run(project, html, version, now(), actor ?? null);
      return version;
    });
  }
  async function resetPage(actor, project) {
    if (roleOf(actor) !== 'admin') throw new BoardError('permission_denied', 'only admins change a board page');
    checkProject(project);
    return q('delete from pages where project = ?').run(project).changes > 0;
  }

  // ---- members, tokens and sign-in ----

  async function memberForToken(token) {
    if (!isToken(token)) return null;
    const r = q(`select t.id tid, m.* from tokens t join members m on m.uid = t.uid where t.token_hash = ? and t.revoked_at is null`).get(hashToken(token));
    if (!r) return null;
    q('update tokens set last_used_at = ? where id = ?').run(now(), r.tid);
    return memberOut(r);
  }
  const memberByPerson = async (person) => memberOut(q('select * from members where person = ?').get(person));
  async function listMembers() {
    return q(`select m.*, (select count(*) from tokens t where t.uid = m.uid and t.revoked_at is null) tokens,
      (select max(last_used_at) from tokens t where t.uid = m.uid and t.revoked_at is null) last_used from members m order by created_at`)
      .all().map((r) => ({ ...memberOut(r), tokens: r.tokens, lastUsed: r.last_used }));
  }
  async function addMember({ person, name, email, role = 'member' }) {
    if (!PERSON_ID.test(person || '')) throw new BoardError('invalid_argument', 'person id must be short lowercase letters, digits, - or _');
    if (!ROLES.includes(role)) throw new BoardError('invalid_argument', 'access must be admin, member or viewer');
    if (q('select 1 from members where person = ?').get(person)) throw new BoardError('already_exists', `member ${person} already exists`);
    const uid = randomUUID();
    q('insert into members (uid, person, name, email, role, created_at) values (?, ?, ?, ?, ?, ?)').run(uid, person, name || null, email || null, role, now());
    return { uid, person, name: name || null, email: email || null, role };
  }
  async function setRole(uid, role) {
    if (!ROLES.includes(role)) throw new BoardError('invalid_argument', 'access must be admin, member or viewer');
    q('update members set role = ? where uid = ?').run(role, uid);
  }
  async function setMemberName(uid, name) { q('update members set name = ? where uid = ?').run(name || null, uid); }
  async function removeMember(uid) { q('delete from members where uid = ?').run(uid); }
  async function issueToken(uid, label = 'agent') {
    const token = newToken();
    q('insert into tokens (id, uid, label, token_hash, created_at) values (?, ?, ?, ?, ?)').run(randomUUID(), uid, label, hashToken(token), now());
    return token;
  }
  // revoking signs the member out everywhere: browser sessions and unused sign-in links go too
  async function revokeTokens(uid) {
    return tx(() => {
      q('delete from sessions where uid = ?').run(uid);
      q('delete from codes where uid = ?').run(uid);
      return q('update tokens set revoked_at = ? where uid = ? and revoked_at is null').run(now(), uid).changes;
    });
  }

  // A one-time link that signs the browser in; the code travels in the fragment, so it stays out of server logs.
  async function loginLink(member) {
    const code = randomBytes(24).toString('base64url');
    q('insert into codes (hash, uid, expires_at) values (?, ?, ?)').run(hashToken(code), member.uid, Date.now() + CODE_MS);
    return `${boardUrl}/#ab-code=${code}`;
  }
  // a browser session from a board token or a one-time code; the session id goes into an httpOnly cookie
  async function startSession({ token, code }) {
    let uid = null;
    if (token) uid = (await memberForToken(token))?.uid;
    else if (typeof code === 'string' && code) {
      const h = hashToken(code);
      const r = q('select uid, expires_at from codes where hash = ?').get(h);
      q('delete from codes where hash = ? or expires_at < ?').run(h, Date.now());
      if (r && r.expires_at > Date.now()) uid = r.uid;
    }
    if (!uid) return null;
    const sid = randomBytes(32).toString('base64url');
    q('delete from sessions where expires_at < ?').run(Date.now());
    q('insert into sessions (hash, uid, expires_at) values (?, ?, ?)').run(hashToken(sid), uid, Date.now() + SESSION_MS);
    return sid;
  }
  async function memberForSession(sid) {
    if (typeof sid !== 'string' || !sid) return null;
    const r = q('select m.* from sessions s join members m on m.uid = s.uid where s.hash = ? and s.expires_at > ?').get(hashToken(sid), Date.now());
    return memberOut(r);
  }
  async function endSession(sid) { if (sid) q('delete from sessions where hash = ?').run(hashToken(sid)); }

  return {
    kind: 'sqlite', get, query, apply, readRows, acquire, subscribe, overview, createProject, dropProject, projectIds,
    getPage, setPage, resetPage, memberForToken, memberByPerson, listMembers, addMember, setRole, setMemberName, removeMember, issueToken,
    revokeTokens, loginLink, startSession, memberForSession, endSession, close: () => db.close(),
  };
}
