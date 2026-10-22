#!/usr/bin/env node
// artiboard: run a board site and manage its members, projects and pages.
// Settings come from the environment (see README "Self-host"); --env loads them from a file first.
import { createServer } from 'node:http';
import { readFileSync, writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { BoardError, now, toBoardError } from './core.js';
import { loadConfig, openStore } from './config.js';
import { defaultPage } from './page.js';

const USAGE = `usage: artiboard <command> [options]   (--env FILE loads settings first)

  serve    [--port N] [--host H]               run the site (pages, project list, MCP at /mcp)
  init     --person ID [--name N] [--email E] [--project ID --title T]
           the first admin, with a token, and optionally the first project

  member add     --person ID [--name N] [--email E] [--access member|admin|viewer] [--projects a,b]
  member token   --person ID [--label L]     another token (shown once)
  member link    --person ID                 a one-time browser sign-in link
  member revoke  --person ID                 revoke all of a person's tokens
  member access  --person ID --access LEVEL
  member join    --person ID --projects a,b  put a member on more boards
  member remove  --person ID                 delete the account; their tasks and messages stay
  member list

  project add    --id ID --title T [--lang en|ko]
  project drop   --id ID                     delete a project and everything on its board
  project list

  page show      --project ID [--out FILE]   the project's page (its own, or the bundled one)
  page set       --project ID --file FILE    serve FILE as the project's page
  page reset     --project ID                back to the bundled page

  import         --project ID --file FILE [--map old=new,...]
           documents exported from a claude.ai artifact board ({"path": data} or {"docs": {...}})`;

const { positionals: [cmd, sub], values: o } = parseArgs({
  allowPositionals: true,
  options: {
    env: { type: 'string' }, port: { type: 'string' }, host: { type: 'string' },
    person: { type: 'string' }, name: { type: 'string' }, email: { type: 'string' }, access: { type: 'string' }, label: { type: 'string' },
    projects: { type: 'string' }, project: { type: 'string' }, id: { type: 'string' }, title: { type: 'string' }, lang: { type: 'string' },
    file: { type: 'string' }, out: { type: 'string' }, map: { type: 'string' }, help: { type: 'boolean', short: 'h' },
  },
});
if (o.env) process.loadEnvFile(o.env);
if (o.port) process.env.PORT = o.port;
if (o.host) process.env.HOST = o.host;

const die = (msg) => { console.error(msg); process.exit(1); };
if (!cmd || o.help) die(USAGE);
const cfg = loadConfig();
const store = await openStore(cfg);
const need = (...keys) => { for (const k of keys) if (!o[k]) die(`--${k} is required\n\n${USAGE}`); };

async function member(person) {
  need('person');
  return (await store.memberByPerson(person)) || die(`no member ${person}`);
}

function connectHelp(person, token) {
  const url = `${cfg.boardUrl}/mcp`;
  console.log(`\nToken for ${person} (shown once; send it privately):\n  ${token}\n`);
  console.log('Claude Code:');
  console.log(`  claude mcp add --scope user --transport http artiboard ${url} --header "Authorization: Bearer ${token}"`);
  console.log('Codex (keep the token in the environment, e.g. in your shell profile):');
  console.log(`  export ARTIBOARD_TOKEN=${token}`);
  console.log(`  codex mcp add artiboard --url ${url} --bearer-token-env-var ARTIBOARD_TOKEN`);
  console.log('  (optional) let board_batch run without asking, in ~/.codex/config.toml:');
  console.log('  [mcp_servers.artiboard.tools.board_batch]\n  approval_mode = "approve"');
  console.log(`Browser: open ${cfg.boardUrl} and paste the token, or ask the agent for a sign-in link.\n`);
}

// Put a person on a project's board (meta/config.people, pinned to their account) or take them off.
// An existing entry keeps its name and role unless new ones are given.
async function setPerson(project, m, entry) {
  const cfg = await store.get(project, 'meta/config');
  const people = cfg?.data.people || [];
  const old = people.find((p) => p.id === m.person);
  const next = people.filter((p) => p.id !== m.person);
  if (entry) next.push({ ...old, ...entry });
  await store.apply(null, project, [
    cfg ? { op: 'update', path: 'meta/config', data: { people: next }, if_version: cfg.version } : { op: 'set', path: 'meta/config', data: { people: next } },
    entry ? { op: 'set', path: `people/${m.person}`, data: { uid: m.uid, at: now() } } : { op: 'delete', path: `people/${m.person}` },
  ]);
}
const entryFor = (m) => ({ id: m.person, uid: m.uid, ...(o.name && { name: o.name }) });
const pickProjects = async () => (o.projects ? o.projects.split(',').map((s) => s.trim()).filter(Boolean) : store.projectIds());

async function addMember(access) {
  need('person');
  const m = await store.addMember({ person: o.person, name: o.name, email: o.email, role: access });
  const projects = access === 'viewer' ? [] : await pickProjects();
  for (const p of projects) await setPerson(p, m, entryFor(m));
  console.log(`added ${m.person} as ${access}${projects.length ? ' on ' + projects.join(', ') : ''}`);
  connectHelp(m.person, await store.issueToken(m.uid, o.label || 'agent'));
}

// Rename people in documents exported from another board: owners, claims, authors, cursors and the people list.
function renamePeople(docs, map) {
  const rn = (v) => (typeof v === 'string' && map[v] ? map[v] : v);
  const out = {};
  for (let [path, data] of Object.entries(docs)) {
    if (path.startsWith('people/')) continue; // links to claude.ai accounts mean nothing here
    data = structuredClone(data);
    if ('owner' in data) data.owner = rn(data.owner);
    if (data.claimedBy?.who) data.claimedBy.who = rn(data.claimedBy.who);
    if ('author' in data) data.author = rn(data.author);
    if (path === 'meta/config' && Array.isArray(data.people)) data.people = data.people.map(({ uid, ...p }) => ({ ...p, id: rn(p.id) }));
    const cur = /^cursors\/(.+)$/.exec(path);
    out[cur ? `cursors/${rn(cur[1])}` : path] = data;
  }
  return out;
}

const commands = {
  async serve() {
    const { makeApp } = await import('./app.js');
    const handle = makeApp({ store, cfg });
    const server = createServer((req, res) => handle(req, res));
    server.listen(cfg.port, cfg.host, () => {
      console.log(`${cfg.site} (${store.kind}) on ${cfg.boardUrl}  · listening on ${cfg.host}:${cfg.port}`);
      if (store.kind === 'sqlite') console.log(`data: ${cfg.dbFile}`);
    });
    // open pages hold a live event stream each, so close those too instead of waiting for them
    const stop = () => { server.close(() => { store.close(); process.exit(0); }); server.closeAllConnections(); };
    process.on('SIGINT', stop);
    process.on('SIGTERM', stop);
  },

  async init() {
    need('person');
    if ((await store.listMembers()).some((m) => m.role === 'admin')) die('this site already has an admin; use `artiboard member add`');
    if (o.project) {
      need('title');
      await store.createProject(null, { id: o.project, title: o.title, lang: o.lang || cfg.lang });
      console.log(`created ${cfg.boardUrl}/p/${o.project}`);
    }
    await addMember('admin');
  },

  member: {
    add: () => addMember(o.access || 'member'),
    async token() { const m = await member(o.person); connectHelp(m.person, await store.issueToken(m.uid, o.label || 'agent')); },
    async link() { console.log(await store.loginLink(await member(o.person))); },
    async revoke() { const m = await member(o.person); console.log(`revoked ${await store.revokeTokens(m.uid)} token(s) for ${m.person}`); },
    async access() { need('access'); const m = await member(o.person); await store.setRole(m.uid, o.access); console.log(`${m.person} is now ${o.access}`); },
    async join() {
      need('projects');
      const m = await member(o.person);
      for (const p of await pickProjects()) await setPerson(p, m, entryFor(m));
      console.log(`${m.person} is on ${o.projects}`);
    },
    async remove() {
      const m = await member(o.person);
      for (const p of await store.projectIds()) {
        const c = await store.get(p, 'meta/config');
        if (c?.data.people?.some((x) => x.id === m.person)) await setPerson(p, m, null);
      }
      await store.removeMember(m.uid);
      console.log(`removed ${m.person}; their tasks and messages stay`);
    },
    async list() {
      for (const m of await store.listMembers()) {
        console.log(`${m.person.padEnd(12)} ${m.role.padEnd(7)} ${(m.name || '').padEnd(14)} tokens=${m.tokens}  last used ${m.lastUsed || 'never'}`);
      }
    },
  },

  project: {
    async add() {
      need('id', 'title');
      await store.createProject(null, { id: o.id, title: o.title, lang: o.lang || cfg.lang });
      console.log(`created ${cfg.boardUrl}/p/${o.id}`);
    },
    async drop() { need('id'); console.log((await store.dropProject(o.id)) ? `dropped ${o.id}` : `no project ${o.id}`); },
    async list() { for (const p of await store.overview()) console.log(`${p.id.padEnd(16)} ${p.title}  tasks=${p.total}`); },
  },

  page: {
    async show() {
      need('project');
      const own = await store.getPage(o.project);
      const html = own?.html ?? defaultPage();
      if (o.out) { writeFileSync(o.out, html); console.log(`wrote ${o.out} (${own ? `version ${own.version}` : 'bundled page'})`); }
      else process.stdout.write(html);
    },
    async set() {
      need('project', 'file');
      console.log(`page version ${await store.setPage(null, o.project, readFileSync(o.file, 'utf8'))} for ${cfg.boardUrl}/p/${o.project}`);
    },
    async reset() { need('project'); console.log((await store.resetPage(null, o.project)) ? 'back to the bundled page' : 'already on the bundled page'); },
  },

  async import() {
    need('project', 'file');
    const raw = JSON.parse(readFileSync(o.file, 'utf8'));
    const map = Object.fromEntries((o.map || '').split(',').filter(Boolean).map((p) => p.split('=').map((s) => s.trim())));
    const docs = renamePeople(raw.docs || raw, map);
    // people on the board who are members here get pinned to their accounts
    const members = await store.listMembers();
    if (docs['meta/config']?.people) {
      docs['meta/config'].people = docs['meta/config'].people.map((p) => {
        const m = members.find((x) => x.person === p.id);
        return m ? { ...p, uid: m.uid } : p;
      });
      for (const p of docs['meta/config'].people) if (p.uid) docs[`people/${p.id}`] = { uid: p.uid, at: now() };
    }
    const writes = Object.entries(docs).map(([path, data]) => ({ op: 'set', path, data }));
    for (let i = 0; i < writes.length; i += 100) await store.apply(null, o.project, writes.slice(i, i + 100));
    console.log(`imported ${writes.length} documents into ${cfg.boardUrl}/p/${o.project}`);
  },
};

const run = typeof commands[cmd] === 'function' ? commands[cmd] : commands[cmd]?.[sub];
if (!run) die(USAGE);
try {
  await run();
  if (cmd !== 'serve') { store.close(); }
} catch (e) {
  const err = e instanceof BoardError ? e : toBoardError(e);
  die(`${err.code}: ${err.message}`);
}
