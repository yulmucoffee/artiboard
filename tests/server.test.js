// End-to-end checks of a hosted board: the MCP tools agents use, the page API, sign-in and per-project pages.
// SQLite runs in-process against a throwaway file. Supabase runs too when AB_SUPABASE=1 and SUPABASE_URL,
// SUPABASE_SECRET_KEY and SUPABASE_PUBLISHABLE_KEY point at a project with supabase/migrations applied
// (`supabase start` gives a local one); it adds a smoke-<random> project and members, and removes them afterwards.
// Run: npm test
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, test } from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { makeApp } from '../server/app.js';
import { loadConfig, openStore } from '../server/config.js';

const backends = [{ name: 'sqlite', env: { ARTIBOARD_BACKEND: 'sqlite' } }];
if (process.env.AB_SUPABASE === '1') backends.push({ name: 'supabase', env: { ARTIBOARD_BACKEND: 'supabase' } });

for (const backend of backends) {
  describe(`hosted board on ${backend.name}`, () => {
    const R = Math.random().toString(36).slice(2, 8);
    const P = `smoke-${R}`;
    const C = `scratch-${R}`;
    const K = (n) => `S${R}-${n}`;
    let dir, store, http, BASE, cfg, tokens = {}, people = {}, board;

    async function connect(token) {
      const client = new Client({ name: 'artiboard-test', version: '1.0.0' });
      await client.connect(new StreamableHTTPClientTransport(new URL(BASE + '/mcp'), { requestInit: { headers: { Authorization: `Bearer ${token}` } } }));
      return client;
    }
    async function call(client, name, args = {}) {
      const r = await client.callTool({ name, arguments: args });
      let value;
      try { value = JSON.parse(r.content[0].text); } catch { value = r.content[0].text; }
      return { error: !!r.isError, value };
    }
    const api = (path, { method = 'GET', body, cookie, headers = {} } = {}) => fetch(BASE + path, {
      method,
      headers: { ...(body && { 'Content-Type': 'application/json' }), ...(cookie && { Cookie: cookie }), ...headers },
      body: body && JSON.stringify(body),
    });

    before(async () => {
      dir = mkdtempSync(join(tmpdir(), 'artiboard-'));
      http = createServer();
      await new Promise((r) => http.listen(0, '127.0.0.1', r));
      BASE = `http://127.0.0.1:${http.address().port}`;
      cfg = loadConfig({ ...process.env, ...backend.env, ARTIBOARD_DB: join(dir, 'board.db'), BOARD_URL: BASE, ARTIBOARD_SITE: 'Test site' });
      store = await openStore(cfg);
      const handle = makeApp({ store, cfg });
      http.on('request', (req, res) => handle(req, res));
      for (const [key, role] of [['admin', 'admin'], ['member', 'member'], ['viewer', 'viewer']]) {
        const m = await store.addMember({ person: `${key.slice(0, 3)}${R}`, name: key, role });
        people[key] = m;
        tokens[key] = await store.issueToken(m.uid, 'test');
      }
      await store.createProject(null, { id: P, title: 'Smoke', lang: 'en' });
      board = await connect(tokens.admin);
    });
    after(async () => {
      await board?.close();
      await store.dropProject(P).catch(() => {});
      for (const m of Object.values(people)) await store.removeMember(m.uid).catch(() => {});
      store.close();
      http.closeAllConnections();
      await new Promise((r) => http.close(r));
      rmSync(dir, { recursive: true, force: true });
    });

    test('a new project starts with config, a notice and its people; its rules are the team\'s to write', async () => {
      const cfg = (await call(board, 'board_get', { project: P, path: 'meta/config' })).value;
      assert.equal(cfg.data.title, 'Smoke');
      assert.deepEqual(cfg.data.repos, []);
      const ids = cfg.data.people.map((p) => p.id);
      assert.ok(ids.includes(people.admin.person) && ids.includes(people.member.person) && !ids.includes(people.viewer.person));
      assert.equal((await call(board, 'board_get', { project: P, path: 'meta/rules' })).value, null);
      assert.equal((await call(board, 'board_get', { project: P, path: 'meta/protocol' })).value, null);
      assert.equal((await call(board, 'board_get', { project: P, path: `people/${people.member.person}` })).value.data.uid, people.member.uid);
    });

    test('lists the tools, the projects and who is connected', async () => {
      const { tools } = await board.listTools();
      assert.deepEqual(tools.map((t) => t.name).sort(), ['board_batch', 'board_claim', 'board_create_project', 'board_get', 'board_login_link',
        'board_page', 'board_post', 'board_projects', 'board_query', 'board_start', 'board_task', 'board_whoami']);
      assert.ok(!JSON.stringify(tools).includes('$schema'), 'listed schemas carry no boilerplate');
      assert.ok(!JSON.stringify(tools).includes('"pattern"'), 'nor patterns zod enforces on the call');
      assert.ok(JSON.stringify(tools).length < 7200, `every session reads the listing, so it stays small (${JSON.stringify(tools).length} chars)`);
      // the listing is the agents' protocol: it changes only on purpose, with UPDATE_SNAPSHOTS=1 npm test and the diff in review
      const snap = new URL('./tools.snapshot.json', import.meta.url), now = JSON.stringify(tools, null, 1) + '\n';
      if (process.env.UPDATE_SNAPSHOTS === '1') writeFileSync(snap, now);
      assert.equal(now, readFileSync(snap, 'utf8'), 'the tool listing differs from tests/tools.snapshot.json; rerun with UPDATE_SNAPSHOTS=1 if the change is meant');
      const other = await connect(tokens.member);
      try {
        assert.deepEqual((await other.listTools()).tools, tools, 'the listing is the same for every member, so a prompt cache keeps it');
        assert.equal(other.getInstructions(), board.getInstructions(), 'and so are the instructions');
      } finally {
        await other.close();
      }
      const me = (await call(board, 'board_whoami')).value;
      assert.equal(me.person, people.admin.person);
      assert.equal(me.backend, backend.name);
      assert.ok((await call(board, 'board_projects')).value.some((p) => p.id === P));
    });

    test('writes a batch, then finds ready work and dependents with queries', async () => {
      const at = new Date().toISOString();
      const w = await call(board, 'board_batch', { project: P, writes: [
        { op: 'set', path: `${C}/T-1`, data: { key: 'T-1', status: 'todo', deps: [], waitingOn: [], n: 3, updatedAt: at } },
        { op: 'set', path: `${C}/T-2`, data: { key: 'T-2', status: 'todo', deps: ['T-1'], waitingOn: ['T-1'], n: 10, flag: true, updatedAt: at } },
        { op: 'set', path: `${C}/T-3`, data: { key: 'T-3', status: 'done', deps: [], waitingOn: [], owner: null, updatedAt: at } },
        { op: 'set', path: `${C}/T-1/messages/${at.replace(/:/g, '-')}-a`, data: { at, text: 'first' } },
        { op: 'set', path: `${C}/T-1/messages/${at.replace(/:/g, '-')}-b`, data: { at: new Date(Date.parse(at) + 1000).toISOString(), text: 'second' } },
      ] });
      assert.equal(w.error, false, JSON.stringify(w.value));
      assert.equal(w.value[`${C}/T-1`], 1);
      const ids = async (where, extra = {}) => (await call(board, 'board_query', { project: P, collection: C, where, ...extra })).value.docs.map((d) => d.id);

      assert.deepEqual(await ids([{ field: 'status', op: '==', value: 'todo' }, { field: 'waitingOn', op: '==', value: [] }]), ['T-1']);
      assert.deepEqual(await ids([{ field: 'deps', op: 'array-contains', value: 'T-1' }]), ['T-2']);
      assert.deepEqual(await ids([{ field: 'key', op: 'in', value: ['T-2', 'T-3'] }]), ['T-2', 'T-3']);
      assert.deepEqual(await ids([{ field: 'n', op: '>', value: 5 }]), ['T-2'], 'numbers compare as numbers');
      assert.deepEqual(await ids([{ field: 'flag', op: '==', value: true }]), ['T-2']);
      assert.deepEqual(await ids([{ field: 'owner', op: '==', value: null }]), ['T-3'], 'null matches a stored null, not a missing field');
      assert.deepEqual(await ids([{ field: 'flag', op: '!=', value: true }]), ['T-1', 'T-3'], 'missing fields are distinct');
      assert.deepEqual(await ids([], { order_by: [{ field: 'n', dir: 'desc' }] }), ['T-2', 'T-1', 'T-3'], 'missing values sort last');
      assert.deepEqual(await ids([], { limit: 1, after: 'T-1' }), ['T-2']);

      const thread = await call(board, 'board_query', { project: P, collection: `${C}/T-1/messages`, order_by: [{ field: 'at', dir: 'desc' }], limit: 1 });
      assert.equal(thread.value.docs[0].data.text, 'second');
      const slim = await call(board, 'board_get', { project: P, path: `${C}/T-2`, fields: ['status', 'waitingOn'] });
      assert.deepEqual(slim.value, { id: 'T-2', version: 1, data: { status: 'todo', waitingOn: ['T-1'] } });
    });

    test('if_version stops a stale write and the whole batch rolls back', async () => {
      const doc = (await call(board, 'board_get', { project: P, path: `${C}/T-1` })).value;
      assert.equal((await call(board, 'board_batch', { project: P, writes: [{ op: 'update', path: `${C}/T-1`, data: { status: 'doing' }, if_version: doc.version }] })).error, false);
      const stale = await call(board, 'board_batch', { project: P, writes: [
        { op: 'update', path: `${C}/T-3`, data: { status: 'todo' } },
        { op: 'update', path: `${C}/T-1`, data: { status: 'doing', owner: 'late' }, if_version: doc.version },
      ] });
      assert.equal(stale.value.code, 'version_conflict');
      assert.equal(stale.value.index, 1);
      assert.equal((await call(board, 'board_get', { project: P, path: `${C}/T-3` })).value.data.status, 'done');
      const t1 = (await call(board, 'board_get', { project: P, path: `${C}/T-1` })).value;
      assert.equal(t1.version, 2);
      assert.equal(t1.data.owner, undefined);
      assert.equal(t1.data.deps.length, 0, 'update merges instead of replacing');
    });

    test('claims, posts and finishes a task in one call each', async () => {
      const at = new Date().toISOString();
      const task = (n, deps) => ({ op: 'set', path: `tasks/${K(n)}`, data: { key: K(n), title: `smoke ${n}`, status: 'todo', deps, waitingOn: deps, updatedAt: at } });
      await call(board, 'board_batch', { project: P, writes: [
        task(1, []), task(2, [K(1)]), task(3, [K(1), 'X-9']),
        { op: 'set', path: `details/${K(1)}`, data: { spec: 'docs/x.md §1', acceptance: 'it works' } },
      ] });

      assert.match((await call(board, 'board_claim', { project: P, id: K(2) })).value, /^waiting: /);
      assert.match((await call(board, 'board_start', { project: P, ready: 50, peek: true })).value, new RegExp(`^${K(1)} smoke 1$`, 'm'));
      const claimed = await call(board, 'board_claim', { project: P, id: K(1), text: 'on it' });
      assert.match(claimed.value, /^claimed /);
      assert.match(claimed.value, /spec: docs\/x\.md §1/);
      assert.match((await call(board, 'board_claim', { project: P, id: K(1) })).value, /^already yours/);
      const me = people.admin.person, them = people.member.person;

      const other = await connect(tokens.member);
      try {
        assert.match((await call(other, 'board_claim', { project: P, id: K(1) })).value, new RegExp(`^taken: .* held by ${me}`));
        assert.match((await call(other, 'board_post', { project: P, task: K(1), text: 'x', status: 'blocked' })).value, /^not_yours: /);
        assert.match((await call(other, 'board_post', { project: P, task: K(1), start: '2026-10-19' })).value, /^not_yours: /, 'start is the holder\'s');
        assert.equal((await call(other, 'board_post', { project: P, task: K(1), due: '2026-10-30' })).value, `ok ${K(1)}`, 'anyone moves a due day');
        const moved = (await call(other, 'board_task', { project: P, id: K(1) })).value;
        assert.match(moved, /^due 2026-10-30$/m);
        assert.match(moved, new RegExp(`${them} update: due 2026-10-30$`, 'm'), 'the thread says who moved it');
        assert.equal((await call(other, 'board_post', { project: P, task: K(1), text: 'a question', type: 'question' })).error, false);
        const people = await call(other, 'board_batch', { project: P, writes: [{ op: 'set', path: 'people/x', data: {} }] });
        assert.equal(people.value.code, 'permission_denied', 'agents do not write people/');
      } finally {
        await other.close();
      }

      assert.equal((await call(board, 'board_post', { project: P, task: K(1), text: 'PR open', status: 'review', pr: 'https://example.com/pr/1', summary: 'state\nleft: nothing' })).value, `ok ${K(1)} → review`);
      assert.equal((await call(board, 'board_post', { project: P, task: K(1), text: 'after the summary', due: '2026-10-23', start: '2026-10-20' })).value, `ok ${K(1)}`);
      assert.equal((await call(board, 'board_post', { project: P, task: K(1), text: 'x', due: 'friday' })).error, true, 'due is a day');
      assert.match((await call(board, 'board_post', { project: P, task: K(1) })).value, /^invalid_argument: /, 'a post says or changes something');
      await call(board, 'board_post', { project: P, task: K(1), branch: 'feat/x' });
      await call(board, 'board_post', { project: P, task: K(1), pr: '' });
      const said = (await call(board, 'board_query', { project: P, collection: `tasks/${K(1)}/messages`, order_by: [{ field: 'at', dir: 'desc' }], limit: 2, fields: ['text'] })).value.docs.map((d) => d.data.text);
      assert.deepEqual(said, ['pr none', 'branch feat/x'], 'a post without text still says what changed');
      await call(board, 'board_post', { project: P, task: K(1), pr: 'https://example.com/pr/1', branch: '' });
      const shown = (await call(board, 'board_task', { project: P, id: K(1) })).value;
      assert.match(shown, new RegExp(`^${K(1)} review · ${me} \\(agent\\) · https://example.com/pr/1$`, 'm'));
      assert.match(shown, /^start 2026-10-20 · due 2026-10-23$/m);
      assert.match(shown, /^summary .*: state\nleft: nothing$/m);
      assert.doesNotMatch(shown, /on it|a question/, 'only messages after the summary');

      assert.equal((await call(board, 'board_post', { project: P, task: K(1), text: 'merged', status: 'done' })).value, `ok ${K(1)} → done · unblocked ${K(2)}`);
      const finished = (await call(board, 'board_get', { project: P, path: `tasks/${K(1)}`, fields: ['due', 'doneAt'] })).value.data;
      assert.equal(finished.due, '2026-10-23');
      assert.match(finished.doneAt, /^\d{4}-\d\d-\d\dT/, 'done stamps doneAt');
      const left = await call(board, 'board_query', { project: P, collection: 'tasks', where: [{ field: 'key', op: 'in', value: [K(2), K(3)] }], fields: ['waitingOn'] });
      assert.deepEqual(left.value.docs.map((d) => d.data.waitingOn), [[], ['X-9']]);
      await call(board, 'board_batch', { project: P, writes: [{ op: 'update', path: `tasks/${K(1)}`, data: { archivedAt: new Date().toISOString() } }] });
      assert.match((await call(board, 'board_task', { project: P, id: K(1), thread: 0 })).value, /· archived \d\d-\d\d/, 'an archived task says so');
      assert.equal((await call(board, 'board_post', { project: P, task: K(1), text: 'qa pass', status: 'qa' })).value, `ok ${K(1)} → qa`, 'a status the board adds');
      assert.equal((await call(board, 'board_get', { project: P, path: `tasks/${K(1)}` })).value.data.doneAt, undefined, 'leaving done clears doneAt');
      assert.equal((await call(board, 'board_get', { project: P, path: `tasks/${K(1)}` })).value.data.archivedAt, undefined, 'and takes it out of the archive');
    });

    test('a reviewer finishes a task in review, and an agent changes or takes over another\'s task only with override', async () => {
      const at = new Date().toISOString(), me = people.admin.person, them = people.member.person;
      const task = (n) => ({ op: 'set', path: `tasks/${K(n)}`, data: { key: K(n), title: `held ${n}`, status: 'todo', deps: [], waitingOn: [], updatedAt: at } });
      await call(board, 'board_batch', { project: P, writes: [task('h1'), task('h2')] });
      await call(board, 'board_claim', { project: P, id: K('h1') });
      await call(board, 'board_claim', { project: P, id: K('h2') });
      await call(board, 'board_post', { project: P, task: K('h1'), status: 'review', pr: 'https://example.com/pr/2' });
      const last = async (n) => (await call(board, 'board_query', { project: P, collection: `tasks/${K(n)}/messages`, order_by: [{ field: 'at', dir: 'desc' }], limit: 1, fields: ['text', 'author'] })).value.docs[0].data;

      const other = await connect(tokens.member);
      try {
        assert.match((await call(other, 'board_post', { project: P, task: K('h1'), status: 'done', branch: 'x' })).value, /^not_yours: .*review it/, 'a reviewer changes only the status');
        assert.equal((await call(other, 'board_post', { project: P, task: K('h1'), text: 'merged', status: 'done' })).value, `ok ${K('h1')} → done`);
        assert.match((await call(other, 'board_task', { project: P, id: K('h1'), thread: 0 })).value, new RegExp(`^${K('h1')} done · ${me} \\(agent\\)`), 'the holder keeps the credit');
        assert.match((await call(other, 'board_post', { project: P, task: K('h1'), status: 'doing' })).value, /^not_yours: .*override true/, 'out of review it is the holder\'s again');
        assert.equal((await call(other, 'board_post', { project: P, task: K('h1'), text: 'reopened for the fix', status: 'doing', override: true })).value, `ok ${K('h1')} → doing`);
        assert.deepEqual(await last('h1'), { text: `reopened for the fix (override; held by ${me})`, author: them }, 'the thread names the holder');

        assert.match((await call(other, 'board_claim', { project: P, id: K('h2') })).value, /^taken: /);
        assert.equal((await call(other, 'board_claim', { project: P, id: K('h2'), text: 'taking this', override: true })).value, `took over ${K('h2')} from ${me}`);
        assert.match((await call(other, 'board_task', { project: P, id: K('h2'), thread: 0 })).value, new RegExp(`^${K('h2')} doing · ${them} \\(agent\\)`));
        assert.equal((await last('h2')).text, `taking this (taken over from ${me})`);
        await call(board, 'board_post', { project: P, task: K('h1'), status: 'done' });
        assert.match((await call(other, 'board_claim', { project: P, id: K('h1'), override: true })).value, /^taken: /, 'a done task is not taken over');
        const working = (await store.overview()).find((p) => p.id === P).working;
        assert.deepEqual(working.map(({ who, n, agent, tasks }) => ({ who, n, agent, tasks })),
          [{ who: them, n: 1, agent: true, tasks: [{ key: K('h2'), title: 'held h2', status: 'doing' }] }], 'the project list says who has what in hand');
      } finally {
        await other.close();
      }
    });

    test('the start lists what was assigned to you and repairs readiness from the deps themselves', async () => {
      const at = new Date().toISOString(), me = people.admin.person;
      const task = (n, data) => ({ op: 'set', path: `tasks/${K(n)}`, data: { key: K(n), title: `drift ${n}`, status: 'todo', deps: [], updatedAt: at, ...data } });
      assert.equal((await call(board, 'board_batch', { project: P, writes: [
        task('d1', { status: 'done' }),
        task('d2', { deps: [K('d1')] }), // written without waitingOn
        task('d3', { deps: [K('d1')], waitingOn: [K('d1')] }), // stale: d1 finished while no page was open
        task('d4', { deps: [K('d2')], waitingOn: [] }), // wrong the other way
        task('d5', { owner: me }), // assigned to me on the page, not started
      ] })).error, false);
      const s = (await call(board, 'board_start', { project: P, ready: 50, rules: false, peek: true })).value;
      assert.match(s, new RegExp(`^${K('d2')} drift d2$`, 'm'), 'ready without a waitingOn field');
      assert.match(s, new RegExp(`^${K('d3')} drift d3$`, 'm'), 'ready although waitingOn still names a done dep');
      assert.doesNotMatch(s, new RegExp(`^${K('d4')} `, 'm'), 'not ready although waitingOn is empty');
      assert.match(s, new RegExp(`^${K('d5')} todo drift d5$`, 'm'), 'an assigned task is listed as yours, with its status');
      assert.doesNotMatch(s, new RegExp(`^${K('d5')} drift d5$`, 'm'), 'and not as anyone\'s ready work');
      const fixed = (await call(board, 'board_query', { project: P, collection: 'tasks', where: [{ field: 'key', op: 'in', value: [K('d2'), K('d3'), K('d4')] }], fields: ['waitingOn'] })).value.docs;
      assert.deepEqual(fixed.map((d) => d.data.waitingOn), [[], [], [K('d2')]], 'the start wrote the repairs');

      assert.match((await call(board, 'board_claim', { project: P, id: K('d5') })).value, /^claimed /);
      assert.equal((await call(board, 'board_post', { project: P, task: K('d5'), type: 'handoff', summary: 'half done', status: 'todo' })).value, `ok ${K('d5')} → todo`);
      const released = (await call(board, 'board_get', { project: P, path: `tasks/${K('d5')}` })).value.data;
      assert.equal(released.owner, undefined, 'a released task has no owner');
      assert.equal(released.claimedBy, undefined, 'and no holder');
      const other = await connect(tokens.member);
      try {
        assert.match((await call(other, 'board_claim', { project: P, id: K('d5') })).value, /^claimed [\s\S]*summary .*: half done$/, 'anyone picks it up with the summary');
      } finally {
        await other.close();
      }
      await call(board, 'board_batch', { project: P, writes: ['d1', 'd2', 'd3', 'd4', 'd5'].map((n) => ({ op: 'delete', path: `tasks/${K(n)}` })) });
    });

    test('a project names its repos: agents find it from a git remote, and the start brings both rules', async () => {
      const api = `acme-${R}/API`, web = `acme-${R}/web`;
      const cfgDoc = (await call(board, 'board_get', { project: P, path: 'meta/config' })).value;
      const at = new Date().toISOString();
      const task = (n, repo) => ({ op: 'set', path: `tasks/${K(`r${n}`)}`, data: { key: K(`r${n}`), title: `repo ${n}`, status: 'todo', deps: [], waitingOn: [], ...(repo && { repo }), updatedAt: at } });
      assert.equal((await call(board, 'board_batch', { project: P, writes: [
        { op: 'update', path: 'meta/config', data: { repos: [{ repo: api, label: 'api' }, web] }, if_version: cfgDoc.version },
        { op: 'set', path: 'meta/rules', data: { text: '1. Roles\n- the api is ours', rev: 2, by: people.admin.person, updatedAt: at } },
        task(1, 'api'), task(2, web), task(3),
      ] })).error, false);

      const listed = (await call(board, 'board_projects')).value.find((p) => p.id === P);
      assert.deepEqual(listed.repos, [`${api} (api)`, web]);
      const s = (await call(board, 'board_start', { project: undefined, repo: `git@github.com:${api.toLowerCase()}.git`, ready: 50, peek: true })).value;
      assert.match(s, new RegExp(`^${people.admin.person} · ${P}`), 'the remote finds the project');
      assert.match(s, new RegExp(`^repos: ${api} \\(api\\) · ${web}$`, 'm'));
      assert.match(s, /^board rules \(every board\):$/m);
      const rules = /^board rules \(every board\):\n(?:- .*\n)+/m.exec(s)[0];
      assert.ok(rules.length < 1800, `every session that does board work reads the board rules once, so they stay short (${rules.length} chars)`);
      assert.match(s, new RegExp(`^project rules \\(rev 2 · ${people.admin.person} \\d\\d-\\d\\d\\):\n1\\. Roles\n- the api is ours$`, 'm'));
      assert.match(s, new RegExp(`^${K('r1')} \\[?.*repo:api.* repo 1$`, 'm'));
      assert.match(s, new RegExp(`^${K('r3')} repo 3$`, 'm'), 'tasks that name no repo are anyone\'s');
      assert.doesNotMatch(s, new RegExp(K('r2')), 'another repo\'s tasks stay out');
      assert.match(s, /; 1 more in other repos\):$/m);

      const refuse = async (writes, why) => assert.equal((await call(board, 'board_batch', { project: P, writes })).value.code, 'invalid_argument', why);
      await refuse([{ op: 'set', path: 'meta/protocol', data: { text: 'rules' } }], 'the old mixed rules card is retired');
      await refuse([{ op: 'update', path: 'meta/rules', data: { text: 'Start with board_start, then board_claim.' } }], 'board rules stay out of project rules');
      await refuse([{ op: 'set', path: 'meta/notes', data: { text: 'pass if_version on writes' } }], 'and out of notes');
      await refuse([{ op: 'set', path: 'meta/rules', data: { text: 5 } }], 'rules are text');
      assert.equal((await call(board, 'board_batch', { project: P, writes: [{ op: 'delete', path: 'meta/protocol' }] })).error, false, 'agents may clear the old card');
      assert.equal((await call(board, 'board_batch', { project: P, writes: [{ op: 'set', path: 'meta/notes', data: { text: 'Mon: deploy', rev: 1, updatedAt: at } }] })).error, false);
      assert.match((await call(board, 'board_start', { project: P, ready: 0, peek: true })).value, /^project notes: meta\/notes \(rev 1 \d\d-\d\d\); board_get it/m, 'notes are pointed at, not printed');

      const byLabel = (await call(board, 'board_start', { project: P, repo: 'api', ready: 50, rules: false, peek: true })).value;
      assert.match(byLabel, /; 1 more in other repos\):$/m, 'with a project, repo may be one of its labels');
      const stray = (await call(board, 'board_start', { project: P, repo: `acme-${R}/elsewhere`, ready: 50, rules: false, peek: true })).value;
      assert.match(stray, new RegExp(`^repo acme-${R}/elsewhere is not linked to ${P}; showing all ready work`, 'm'));
      assert.match(stray, new RegExp(`^${K('r2')} `, 'm'), 'an unlinked repo filters nothing');
      const token = await call(board, 'board_start', { repo: `https://x-access-token:SECRET@github.com/${api}.git`, ready: 0, rules: false, peek: true });
      assert.match(token.value, new RegExp(`^${people.admin.person} · ${P}`), 'a remote with credentials still finds the project');
      assert.doesNotMatch((await call(board, 'board_start', { repo: 'https://x:SECRET@gitlab.com/a/b' })).value, /SECRET/, 'errors never echo a remote');

      const lean = (await call(board, 'board_start', { project: P, rules: false, ready: 0, peek: true })).value;
      assert.doesNotMatch(lean, /board rules|project rules|project notes/, 'rules: false leaves them out');
      assert.match((await call(board, 'board_start', { repo: `acme-${R}/nothing` })).value, /^not_found: /);
      assert.match((await call(board, 'board_start', { repo: 'not a repo' })).value, /^invalid_argument: /);
      assert.match((await call(board, 'board_start', {})).value, /^invalid_argument: /);

      const other = `${P}-x`;
      const made = await call(board, 'board_create_project', { id: other, title: 'Other', repos: [`https://github.com/acme-${R}/other`, { repo: `acme-${R}/docs`, label: 'docs' }] });
      try {
        assert.equal(made.error, false, JSON.stringify(made.value));
        assert.deepEqual((await call(board, 'board_get', { project: other, path: 'meta/config' })).value.data.repos, [{ repo: `acme-${R}/other` }, { repo: `acme-${R}/docs`, label: 'docs' }]);
        assert.equal((await call(board, 'board_create_project', { id: `${P}-y`, title: 'Bad', repos: ['gitlab.com/a/b'] })).value.code, 'invalid_argument');
      } finally {
        await store.dropProject(other);
      }
    });

    test('posts a notice and shows it once at the next start', async () => {
      await call(board, 'board_start', { project: P, ready: 0 });
      assert.equal((await call(board, 'board_post', { project: P, text: `smoke notice ${R}` })).value, 'posted notice');
      assert.match((await call(board, 'board_start', { project: P, ready: 0 })).value, new RegExp(`smoke notice ${R}`));
      assert.doesNotMatch((await call(board, 'board_start', { project: P, ready: 0 })).value, new RegExp(`smoke notice ${R}`));
      assert.match((await call(board, 'board_post', { project: P, text: 'x', status: 'done' })).value, /^invalid_argument: /);
    });

    test('rejects bad input without writing', async () => {
      assert.equal((await call(board, 'board_batch', { project: P, writes: [{ op: 'update', path: `${C}/nope`, data: { a: 1 } }] })).value.code, 'not_found');
      assert.equal((await call(board, 'board_batch', { project: P, writes: [{ op: 'set', path: C, data: {} }] })).value.code, 'invalid_argument');
      const field = await call(board, 'board_query', { project: P, collection: C, where: [{ field: "x'); drop table docs; --", op: '==', value: 1 }] });
      assert.equal(field.value.code, 'invalid_argument');
      assert.equal((await call(board, 'board_batch', { project: P, writes: [{ op: 'set', path: `${C}/T-1`, data: {}, if_absent: true }] })).value.code, 'already_exists');
      assert.equal((await call(board, 'board_get', { project: 'no-such-project', path: 'meta/config' })).value.code, 'not_found');
    });

    test('a viewer reads but cannot write', async () => {
      const viewer = await connect(tokens.viewer);
      try {
        assert.equal((await call(viewer, 'board_get', { project: P, path: `${C}/T-1` })).value.id, 'T-1');
        assert.equal((await call(viewer, 'board_batch', { project: P, writes: [{ op: 'set', path: `${C}/V-1`, data: {} }] })).value.code, 'permission_denied');
      } finally {
        await viewer.close();
      }
    });

    test('who is who and who wrote what are guarded on every path', async () => {
      const member = await connect(tokens.member);
      const me = people.member.person;
      try {
        const deny = async (writes, why) => assert.equal((await call(member, 'board_batch', { project: P, writes })).value.code, 'permission_denied', why);
        await deny([{ op: 'set', path: `people/${people.admin.person}`, data: { uid: people.member.uid } }], 'no taking over a linked person');
        await deny([{ op: 'set', path: `people/ghost${R}`, data: { uid: people.admin.uid } }], 'no linking someone else\'s account');
        await deny([{ op: 'delete', path: `people/${me}` }], 'no unlinking');
        assert.equal((await call(member, 'board_batch', { project: P, writes: [{ op: 'set', path: `people/ghost${R}`, data: { uid: people.member.uid } }] })).error, false,
          'a member links their own account to an unlinked person, as the page does');
        await deny([{ op: 'set', path: `people/ghost${R}`, data: { uid: people.member.uid } }], 'once linked, only admins change it');
        const cfgDoc = (await call(member, 'board_get', { project: P, path: 'meta/config' })).value;
        await deny([{ op: 'update', path: 'meta/config', data: { people: [{ id: me, uid: people.member.uid }] } }], 'no rewriting meta/config.people');
        assert.equal((await call(member, 'board_batch', { project: P, writes: [{ op: 'update', path: 'meta/config', data: { subtitle: 'by a member' }, if_version: cfgDoc.version }] })).error, false, 'other config fields stay open');
        const at = new Date().toISOString();
        await deny([{ op: 'set', path: `notices/n-${R}-fake`, data: { at, author: people.admin.person, text: 'not me' } }], 'no posting as someone else');
        assert.equal((await call(member, 'board_batch', { project: P, writes: [{ op: 'set', path: `notices/n-${R}-mine`, data: { at, author: me, text: 'me' } }] })).error, false);
        if (store.kind === 'sqlite') {
          const cookie = (await api('/api/login', { method: 'POST', body: { token: tokens.member } })).headers.get('set-cookie').split(';')[0];
          const r = await api(`/api/p/${P}/batch`, { method: 'POST', cookie, body: { writes: [{ op: 'set', path: `people/${people.admin.person}`, data: { uid: people.member.uid } }] } });
          assert.equal(r.status, 403, 'the page API enforces the same rules');
        }
      } finally {
        await member.close();
      }
      assert.equal((await call(board, 'board_batch', { project: P, writes: [{ op: 'delete', path: `people/ghost${R}` }, { op: 'delete', path: `notices/n-${R}-mine` }] })).error, false, 'admins may');
    });

    test('agents change pages only where the site allows it', async () => {
      cfg.agentPageEdits = false;
      const off = await call(board, 'board_page', { project: P, edits: [{ old: '<title>Project Board</title>', new: '<title>x</title>' }] });
      assert.equal(off.value.code, 'permission_denied');
      assert.match(off.value.message, /artiboard page set/);
      cfg.agentPageEdits = true;
    });

    test('admins change a project page with exact edits; others cannot', async () => {
      cfg.agentPageEdits = true;
      const info = (await call(board, 'board_page', { project: P })).value;
      assert.deepEqual([info.version, info.custom], [0, false]);
      assert.match((await call(board, 'board_page', { project: P, find: "var STATUS=", context: 0 })).value, /^version 0 \(bundled\)\n\d+: /);
      const member = await connect(tokens.member);
      try {
        const denied = await call(member, 'board_page', { project: P, edits: [{ old: '<title>Project Board</title>', new: '<title>Mine</title>' }] });
        assert.equal(denied.value.code, 'permission_denied');
      } finally {
        await member.close();
      }
      assert.equal((await call(board, 'board_page', { project: P, edits: [{ old: 'var ', new: 'let ' }] })).value.code, 'invalid_argument', 'old text must be unique');
      const set = await call(board, 'board_page', { project: P, edits: [{ old: '<title>Project Board</title>', new: '<title>Smoke Board</title>' }], if_version: 0 });
      assert.equal(set.value.version, 1, JSON.stringify(set.value));
      assert.equal((await call(board, 'board_page', { project: P, html: '<p>x</p>', if_version: 0 })).value.code, 'version_conflict');
      const page = await api(`/p/${P}`);
      assert.equal(page.status, 200);
      const html = await page.text();
      assert.match(html, /<title>Smoke Board<\/title>/);
      assert.match(html, /<script src="\/shim.js"><\/script>/);
      assert.match(page.headers.get('content-security-policy'), /connect-src 'self'/);
      assert.equal((await call(board, 'board_page', { project: P, reset: true })).value.reset, true);
      const bundled = await (await api(`/p/${P}`)).text();
      assert.match(bundled, /<title>Project Board<\/title>/);
      assert.match(bundled, /^<!doctype html>[\s\S]*<meta name="viewport"[\s\S]*<script src="\/shim.js"><\/script>\n<\/head>/, 'the bundled page is wrapped in a document with a viewport, its <header> notwithstanding');
      assert.equal((await api('/p/no-such-project')).status, 200, 'unknown projects look like any other board until sign-in');
    });

    test('refuses requests without a valid token', async () => {
      for (const auth of [undefined, 'Bearer abt_not-a-real-token-at-all-000']) {
        const r = await api('/mcp', { method: 'POST', body: { jsonrpc: '2.0', id: 1, method: 'tools/list' },
          headers: { Accept: 'application/json, text/event-stream', ...(auth && { Authorization: auth }) } });
        assert.equal(r.status, 401);
      }
      assert.equal((await api('/mcp')).status, 405, 'no server-sent stream on GET');
      assert.equal((await api('/api/projects')).status, 401);
    });

    test('site config tells the page which backend to use', async () => {
      const cfg = await (await api('/api/config')).json();
      assert.equal(cfg.backend, backend.name);
      assert.equal(cfg.site, 'Test site');
      assert.equal(!!cfg.supabaseKey, backend.name === 'supabase');
      assert.ok(!JSON.stringify(cfg).includes(process.env.SUPABASE_SECRET_KEY || 'no secret'), 'the secret key never leaves the server');
    });

    test('the project list can read the changelog without signing in', async () => {
      const r = await api('/changelog.json');
      assert.equal(r.status, 200);
      assert.equal((await r.json()).versions[0].version, JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version);
    });

    if (backend.name === 'sqlite') {
      test('the page signs in with a token or a one-time link, reads, writes and hears changes live', async () => {
        assert.equal((await api('/api/login', { method: 'POST', body: { token: 'abt_wrong-token-wrong-token-00' } })).status, 401);
        const login = await api('/api/login', { method: 'POST', body: { token: tokens.member } });
        assert.equal(login.status, 200);
        const set = login.headers.get('set-cookie');
        assert.match(set, /HttpOnly/);
        const cookie = set.split(';')[0];
        assert.equal((await (await api('/api/me', { cookie })).json()).person, people.member.person);

        const rows = await (await api(`/api/p/${P}/read`, { method: 'POST', cookie, body: { whole: ['tasks'], docs: { meta: ['config'] } } })).json();
        assert.ok(rows.some((r) => r.collection === 'meta' && r.doc_id === 'config'));
        assert.ok(rows.some((r) => r.doc_id === K(1)));
        const latest = await (await api(`/api/p/${P}/read`, { method: 'POST', cookie, body: { limited: [
          { collection: `${C}/T-1/messages`, order: [{ field: 'at', dir: 'desc' }], limit: 1 },
          { collection: `tasks/${K(1)}/messages`, order: [{ field: 'at', dir: 'desc' }], limit: 2 },
        ] } })).json();
        assert.deepEqual(latest.filter((r) => r.i === 0).map((r) => r.data.text), ['second'], 'limited reads go out together, each answered by its index');
        assert.equal(latest.filter((r) => r.i === 1).length, 2);

        const events = await fetch(`${BASE}/api/p/${P}/events`, { headers: { Cookie: cookie } });
        assert.equal(events.headers.get('content-type'), 'text/event-stream');
        const reader = events.body.getReader();
        const heard = (async () => {
          let text = '';
          while (!text.includes('"doc_id":"live"')) text += new TextDecoder().decode((await reader.read()).value);
          return text;
        })();
        const w = await api(`/api/p/${P}/batch`, { method: 'POST', cookie, body: { writes: [{ op: 'set', path: `${C}/live`, data: { v: 1 } }] } });
        assert.deepEqual(await w.json(), [{ path: `${C}/live`, version: 1 }]);
        assert.match(await heard, /"version":1/);
        await reader.cancel();

        const since = rows.map((r) => r.updated_at).sort().pop();
        const changed = await (await api(`/api/p/${P}/read`, { method: 'POST', cookie, body: { collections: [C], since } })).json();
        assert.deepEqual(changed.map((r) => r.doc_id), ['live']);
        assert.deepEqual(await (await api(`/api/p/${P}/acquire`, { method: 'POST', cookie, body: { path: 'people/x', holder: 'a', ttlMs: 2000 } })).json(), { acquired: true });
        assert.deepEqual(await (await api(`/api/p/${P}/acquire`, { method: 'POST', cookie, body: { path: 'people/x', holder: 'b', ttlMs: 2000 } })).json(), { acquired: false });

        const cross = await api(`/api/p/${P}/batch`, { method: 'POST', cookie, headers: { Origin: 'https://evil.example' }, body: { writes: [{ op: 'delete', path: `${C}/live` }] } });
        assert.equal(cross.status, 403, 'other sites cannot write with the cookie');

        await api('/api/logout', { method: 'POST', cookie });
        assert.equal((await api('/api/me', { cookie })).status, 401);

        const { url } = (await call(board, 'board_login_link')).value;
        const code = /#ab-code=(.+)$/.exec(url)[1];
        assert.equal((await api('/api/login', { method: 'POST', body: { code } })).status, 200);
        assert.equal((await api('/api/login', { method: 'POST', body: { code } })).status, 401, 'a link works once');
      });

      test('revoking a token signs the member out; leases and logout are guarded', async () => {
        const extra = await store.addMember({ person: `rev${R}`, role: 'member' });
        people.revoked = extra;
        const token = await store.issueToken(extra.uid, 'test');
        const cookie = (await api('/api/login', { method: 'POST', body: { token } })).headers.get('set-cookie').split(';')[0];
        const { url } = (await call(await connect(token), 'board_login_link')).value;
        assert.equal((await api('/api/me', { cookie })).status, 200);
        await store.revokeTokens(extra.uid);
        assert.equal((await api('/api/me', { cookie })).status, 401, 'the browser session ends');
        assert.equal((await api('/api/login', { method: 'POST', body: { code: /#ab-code=(.+)$/.exec(url)[1] } })).status, 401, 'unused links die too');

        const viewer = (await api('/api/login', { method: 'POST', body: { token: tokens.viewer } })).headers.get('set-cookie').split(';')[0];
        assert.equal((await api(`/api/p/${P}/acquire`, { method: 'POST', cookie: viewer, body: { path: 'people/x', holder: 'v' } })).status, 403);
        const admin = (await api('/api/login', { method: 'POST', body: { token: tokens.admin } })).headers.get('set-cookie').split(';')[0];
        assert.equal((await api('/api/p/no-such-project/acquire', { method: 'POST', cookie: admin, body: { path: 'people/x', holder: 'a' } })).status, 404);
        assert.equal((await api(`/api/p/${P}/acquire`, { method: 'POST', cookie: admin, body: { path: 'x'.repeat(900), holder: 'a' } })).status, 400);
        assert.equal((await api(`/api/p/${P}/read`, { method: 'POST', cookie: admin, body: { whole: Array.from({ length: 30 }, (_, i) => `c${i}`) } })).status, 400);
        assert.equal((await api('/api/logout', { cookie: admin })).status, 405, 'no logging people out with a link');
      });

      test('admins add members from the page, the token signs them in, and members keep their own profile', async () => {
        const admin = (await api('/api/login', { method: 'POST', body: { token: tokens.admin } })).headers.get('set-cookie').split(';')[0];
        const member = (await api('/api/login', { method: 'POST', body: { token: tokens.member } })).headers.get('set-cookie').split(';')[0];
        assert.equal((await api('/api/members', { cookie: member })).status, 403, 'members are the admin\'s to manage');
        assert.equal((await api('/api/members', { method: 'POST', cookie: member, body: { person: `nope${R}` } })).status, 403);

        const made = await api('/api/members', { method: 'POST', cookie: admin, body: { person: `new${R}`, name: 'Newcomer', access: 'member' } });
        assert.equal(made.status, 200);
        const b = await made.json();
        people.newcomer = b.member;
        assert.equal(b.member.role, 'member');
        assert.ok(b.projects.includes(P), 'a new member sits on every board');
        assert.match(b.token, /^abt_/, 'the token comes back once');
        assert.match(b.connect.claude, new RegExp(`--header "Authorization: Bearer ${b.token}"`), 'with the connect commands');
        const cfgDoc = (await call(board, 'board_get', { project: P, path: 'meta/config' })).value;
        assert.deepEqual(cfgDoc.data.people.find((x) => x.id === `new${R}`), { id: `new${R}`, uid: b.member.uid, name: 'Newcomer' });
        assert.equal((await call(board, 'board_get', { project: P, path: `people/new${R}` })).value.data.uid, b.member.uid, 'pinned to the account');
        assert.equal((await api('/api/members', { method: 'POST', cookie: admin, body: { person: `new${R}` } })).status, 409, 'ids are unique');
        assert.equal((await api('/api/members', { method: 'POST', cookie: admin, body: { person: 'Bad Id' } })).status, 400);

        const login = await api('/api/login', { method: 'POST', body: { token: b.token } });
        assert.equal(login.status, 200, 'the new member signs in with that token');
        const cookie = login.headers.get('set-cookie').split(';')[0];
        const agent = await connect(b.token);
        try { assert.equal((await call(agent, 'board_whoami')).value.person, `new${R}`, 'and so does their agent'); } finally { await agent.close(); }

        assert.equal((await api('/api/me', { method: 'POST', cookie, body: { name: '  New  Name ', title: 'backend' } })).status, 200);
        const meDoc = await (await api('/api/me', { cookie })).json();
        assert.equal(meDoc.name, 'New Name');
        assert.equal(meDoc.title, 'backend');
        const onBoard = (await call(board, 'board_get', { project: P, path: 'meta/config' })).value.data.people.find((x) => x.id === `new${R}`);
        assert.deepEqual(onBoard, { id: `new${R}`, uid: b.member.uid, name: 'New Name', role: 'backend' }, 'the profile shows on every board');
        assert.equal((await api('/api/me', { method: 'POST', cookie, body: { name: 5 } })).status, 400);
        assert.equal((await api('/api/me', { method: 'POST', cookie, body: { name: '', title: '' } })).status, 200);
        assert.equal((await call(board, 'board_get', { project: P, path: 'meta/config' })).value.data.people.find((x) => x.id === `new${R}`).role, undefined, 'an empty role is cleared');
        const listed = (await (await api('/api/members', { cookie: admin })).json()).find((m) => m.person === `new${R}`);
        assert.equal(listed.name, null);
        assert.equal(listed.tokens, 1);

        const again = await (await api(`/api/members/new${R}/token`, { method: 'POST', cookie: admin })).json();
        assert.match(again.token, /^abt_/);
        const url = (await (await api(`/api/members/new${R}/link`, { method: 'POST', cookie: admin })).json()).url;
        assert.equal((await api('/api/login', { method: 'POST', body: { code: /#ab-code=(.+)$/.exec(url)[1] } })).status, 200, 'an admin-made link signs the member in');
        assert.equal((await api(`/api/members/new${R}/access`, { method: 'POST', cookie: admin, body: { access: 'viewer' } })).status, 200);
        assert.equal((await api(`/api/members/${people.admin.person}/access`, { method: 'POST', cookie: admin, body: { access: 'member' } })).status, 400, 'not your own access');
        assert.equal((await (await api(`/api/members/new${R}/revoke`, { method: 'POST', cookie: admin })).json()).revoked, 2);
        assert.equal((await api('/api/me', { cookie })).status, 401, 'revoking signs them out');
        assert.equal((await api(`/api/members/no-such${R}/token`, { method: 'POST', cookie: admin })).status, 404);
        assert.equal((await api(`/api/members?person=new${R}&action=link`, { method: 'POST', cookie: admin })).status, 200, 'the form Vercel rewrites sub-paths to works too');
        assert.equal((await api(`/api/members/${people.admin.person}/remove`, { method: 'POST', cookie: admin })).status, 400, 'not yourself');
        assert.equal((await api(`/api/members/new${R}/remove`, { method: 'POST', cookie: admin })).status, 200);
        delete people.newcomer;
        assert.ok(!(await call(board, 'board_get', { project: P, path: 'meta/config' })).value.data.people.some((x) => x.id === `new${R}`), 'removed from the boards too');
        assert.equal((await call(board, 'board_get', { project: P, path: `people/new${R}` })).value, null);
      });

      test('a viewer page reads but cannot write; projects are listed and created from the page', async () => {
        const cookie = (await api('/api/login', { method: 'POST', body: { token: tokens.viewer } })).headers.get('set-cookie').split(';')[0];
        assert.equal((await api(`/api/p/${P}/batch`, { method: 'POST', cookie, body: { writes: [{ op: 'set', path: `${C}/v`, data: {} }] } })).status, 403);
        assert.ok((await (await api('/api/projects', { cookie })).json()).some((p) => p.id === P));
        assert.equal((await api('/api/projects', { method: 'POST', cookie, body: { id: `${P}-v`, title: 'nope' } })).status, 403);
        const admin = (await api('/api/login', { method: 'POST', body: { token: tokens.admin } })).headers.get('set-cookie').split(';')[0];
        const made = await api('/api/projects', { method: 'POST', cookie: admin, body: { id: `${P}-2`, title: 'Second' } });
        assert.deepEqual(await made.json(), { id: `${P}-2`, title: 'Second' });
        await store.dropProject(`${P}-2`);
      });
    } else {
      test('revoking a token ends Supabase sessions', async () => {
        const extra = await store.addMember({ person: `rev${R}`, role: 'member' });
        people.revoked = extra;
        await store.issueToken(extra.uid, 'test');
        assert.equal(await store.revokeTokens(extra.uid), 1);
      });

      test('gives a one-time Supabase sign-in link', async () => {
        assert.match((await call(board, 'board_login_link')).value.url, /\/auth\/v1\/verify\?token=/);
      });
    }
  });
}
