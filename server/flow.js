// The everyday agent actions, each one tool call: start a session, read a task, claim, post.
// They answer in short text lines, check versions on the server and stamp times with the server clock,
// so an agent spends no tokens on reads before a write, on version numbers or on `date`.
import { GRAPH_LINKS, loadGraph, mapSource } from './codemap/graph.js';
import { BOARD_RULES, BoardError, MAP_RULES, cleanRepos, now, repoName, reposOf, stampId, toBoardError } from './core.js';
import { TASK_STATUSES, boardStatuses, depsOf, holderOf, isReady, mayChange, statusEffects, statusOf, unmetDeps } from './tasks.js';
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

// A task's line is one line: any writer sets its fields, and a line break in a title would start a line that reads
// like the board's own (a second "project rules" block) in every agent's answer.
function taskLine(d, id, withStatus) {
  const bits = [d.key || id];
  if (withStatus) bits.push(d.status || 'todo');
  if (d.feature) bits.push(`[${d.feature}]`);
  if (d.repo) bits.push(`repo:${d.repo}`);
  if (d.branch && withStatus) bits.push(d.branch);
  if (d.pr && withStatus) bits.push(d.pr);
  bits.push(...dateBits(d));
  return oneLine(`${bits.join(' ')} ${d.title || ''}`);
}
const reviewLine = (d, id) => oneLine([d.key || id, d.feature && `[${d.feature}]`, d.repo && `repo:${d.repo}`, d.pr, ...dateBits(d), d.title]
  .filter(Boolean).join(' ') + (holderOf(d) ? ` · ${holderOf(d)}` : ''));
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

// A code map is an index document per repository, map/<owner--name>, and its chunks, map/<owner--name>/chunks/<n>: at
// most MAP_CHUNKS of them (about 25,000 symbols), each at most MAP_CHUNK bytes of JSON, under the store's document
// limit with room for how each database spells JSON.
const MAP_CHUNK = 200000, MAP_CHUNKS = 60;
// how many files and symbols a task's touches keep: enough for a large change, few enough to print and compare
const TOUCHES = 60;
// the index documents: the collection map holds nothing else
const MAPS = { collection: 'map', limit: 50 };
// open work: held (an owner is a non-empty string, which both databases rank above '') and not done
const OPEN = { collection: 'tasks', where: [{ field: 'owner', op: '>', value: '' }, { field: 'status', op: '!=', value: 'done' }], limit: 200 };
// what a map adds to the everyday answers stays a few lines: the code a task names, and where its work meets others'
const CODE_LINES = 7, OVERLAP_LINES = 5;
// the most an unsized board_map answer may run to: about a screen, under a thousand tokens
const MAP_ANSWER = 3000;
// Maps loaded in this process, by project and key, kept while their index says the same build (builtAt); a few at
// most, the least recently used going first.
const loaded = new Map(), LOADED = 8;

const touchesOf = (d) => (Array.isArray(d.touches) ? d.touches : []);
const touching = (t) => ({ key: t.data.key || t.id, holder: holderOf(t.data), touches: touchesOf(t.data) });
// a few items and how many more, so a line stays short
const few = (xs, n = 3) => xs.slice(0, n).join(', ') + (xs.length > n ? ` +${xs.length - n} more` : '');
// a map's label: its repo's on the board now, else the one it was built with; its name falls back to owner/name
const mapLabel = (m, repos) => repos.find((r) => repoName(r.repo) === repoName(m.data.repo))?.label || m.data.label;
const mapName = (m, repos) => mapLabel(m, repos) || m.data.repo || m.id;
const mapLine = (m, repos) => [`${mapName(m, repos)} · ${m.data.counts?.symbols ?? 0} symbols · built ${short(m.data.builtAt).slice(0, 5)} by ${m.data.by || '?'}`,
  ...mapSource(m.data)].join(' · ');
// the call is made by now: a map that cannot be read leaves its lines out rather than turning the answer into an error
const quiet = (e) => { console.error(e); return []; };

// the maps a repo names: a label (the board's, or the one a map was built with) or owner/name; no repo, every map
function mapsNamed(maps, repo, repos) {
  if (!repo) return maps;
  const want = taskRepo({ repo }, repos);
  return maps.filter((m) => m.data.label === repo || (want && repoName(m.data.repo) === want));
}

// a map's document id: its repository, which a label added or changed later leaves the same
const repoKey = (name) => repoName(name).replace('/', '--');

// What a map must look like to be kept: the page and loadGraph read it whole, so one bad field would break it for every
// reader. One pass over the index and every node and edge; the answer names the first bad field.
const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isCount = (v) => Number.isInteger(v) && v >= 0;
// a string of at most max characters
const upTo = (max) => (v) => typeof v === 'string' && v.length <= max;
const NODE = [['i', upTo(1000), 'an id'], ['k', (v) => ['file', 'sym', 'doc', 'sec'].includes(v), 'file, sym, doc or sec'], ['n', upTo(1000), 'a name'],
  ['f', upTo(1000), 'a path'], ['l', isCount, 'a line'], ['t', upTo(20), 'a type'], ['s', upTo(160), 'a signature of at most 160 characters'],
  ['d', upTo(200), 'a comment of at most 200 characters'], ['c', isCount, 'a community'], ['q', (v) => v === 't', "'t'"]];
const OPTIONAL = new Set(['t', 's', 'd', 'c', 'q']);
const EDGES = new Set(['imports', 'defines', 'calls', 'uses', 'extends', 'mentions', 'contains']);
const isCommunity = (v) => Number.isInteger(v) && v >= 0 && v < 40;
function mapProblem(index, chunks) {
  if (index.label !== undefined && !(upTo(40)(index.label) && !/[/#]/.test(index.label))) return 'index.label is not a name of at most 40 characters without / or #';
  if (index.commit !== undefined && !upTo(64)(index.commit)) return 'index.commit is not a commit id of at most 64 characters';
  if (index.branch !== undefined && !upTo(200)(index.branch)) return 'index.branch is not a branch name of at most 200 characters';
  if (index.dirty !== undefined && index.dirty !== true) return 'index.dirty is not true: a checkout with no changes leaves it out';
  if (!isObject(index.counts)) return 'index.counts is not {files, symbols, edges, docs}';
  for (const [k, v] of Object.entries(index.counts)) if (!isCount(v)) return `index.counts.${k} is not a count`;
  if (index.langs !== undefined && !isObject(index.langs)) return 'index.langs is not {language: files}';
  for (const [k, v] of Object.entries(index.langs || {})) if (!isCount(v)) return `index.langs.${k} is not a count`;
  if (!Array.isArray(index.communities) || index.communities.length > 40) return 'index.communities is not a list of at most 40';
  for (const [i, c] of index.communities.entries()) {
    if (!isObject(c) || typeof c.name !== 'string' || !isCount(c.n) || !Array.isArray(c.top) || c.top.length > 40 || !c.top.every(upTo(300))) {
      return `index.communities[${i}] is not {name, n, top: [ids]}`;
    }
  }
  if (!Array.isArray(index.god) || index.god.length > 40) return 'index.god is not a list of at most 40';
  for (const [i, g] of index.god.entries()) if (!upTo(300)(g)) return `index.god[${i}] is not an id`;
  // a map built before the builder wrote links has none, and the page finds them in its chunks
  if (index.links !== undefined && !(Array.isArray(index.links) && index.links.length <= GRAPH_LINKS)) return `index.links is not a list of at most ${GRAPH_LINKS}`;
  for (const [i, l] of (index.links || []).entries()) {
    if (!Array.isArray(l) || l.length !== 3 || !isCommunity(l[0]) || !isCommunity(l[1]) || l[0] >= l[1] || !(Number.isInteger(l[2]) && l[2] > 0)) {
      return `index.links[${i}] is not [a, b, n]`;
    }
  }
  for (const [i, c] of chunks.entries()) {
    if (!isObject(c) || !Array.isArray(c.nodes) || !Array.isArray(c.edges)) return `chunks[${i}] is not {nodes, edges}`;
    for (const [j, n] of c.nodes.entries()) {
      if (!isObject(n)) return `chunks[${i}].nodes[${j}] is not a node`;
      for (const [f, ok, what] of NODE) if (!(n[f] === undefined && OPTIONAL.has(f)) && !ok(n[f])) return `chunks[${i}].nodes[${j}].${f} is not ${what}`;
    }
    for (const [j, e] of c.edges.entries()) {
      if (!Array.isArray(e) || e.length !== 4 || typeof e[0] !== 'string' || typeof e[1] !== 'string' || !EDGES.has(e[2]) || (e[3] !== 'x' && e[3] !== 'i')) {
        return `chunks[${i}].edges[${j}] is not [from, to, type, x|i]`;
      }
    }
  }
  return null;
}

// a map with nothing in it still finds the touches two tasks share
const NO_MAP = loadGraph({}, []);

// Where mine meet the rest of the open work held by someone else. The map decides what an overlap is (a touch both
// share, the same file under two names, a file of one importing one of the other's), given all the open work at once;
// the lines read from the side of mine. Computed when printed, never stored.
function overlapLines(mine, others, graphs) {
  const keys = new Set(mine.map((t) => t.key)), all = mine.concat(others.filter((t) => !keys.has(t.key)));
  const holder = new Map(all.map((t) => [t.key, t.holder])), seen = new Set(), out = [];
  for (const g of graphs.length ? graphs : [NO_MAP]) {
    for (const p of g.overlaps(all).pairs) {
      const [a, b] = keys.has(p.a) ? [p.a, p.b] : [p.b, p.a];
      if (!keys.has(a) || holder.get(a) === holder.get(b) || seen.has(`${a} ${b}`)) continue;
      seen.add(`${a} ${b}`);
      out.push(`overlap ${a} ↔ ${b} (${holder.get(b)}): ${p.shared ? few(p.shared) : few(p.imports.map(([x, y]) => `${x} → ${y}`), 2)}`);
    }
  }
  return out.slice(0, OVERLAP_LINES);
}

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

  // The project's code maps, one index document per repository, and its repos, whose labels name them.
  async function mapsOf(project) {
    const [config, maps] = await read(project, [{ path: 'meta/config' }, MAPS]);
    return { maps, repos: reposOf(config?.data) };
  }

  // What the build script asks before it builds: which code each map describes and when it was built, without its
  // chunks. An unknown project has no maps, as an unknown board address still gets a page.
  async function mapsMeta(project) {
    const { maps, repos } = await mapsOf(project).catch((e) => {
      if (toBoardError(e).code !== 'not_found') throw e;
      return { maps: [], repos: [] };
    });
    const meta = (m) => {
      const { repo, commit, branch, dirty, builtAt, by, counts, chunks } = m.data;
      return { repo, label: mapLabel(m, repos), commit, branch, dirty, builtAt, by, counts, chunks };
    };
    return { maps: maps.map(meta) };
  }

  // A map as a graph. The caller has just read its index; the chunks are read only when that index says the map was
  // rebuilt since this process loaded it, and then together with the index, so a rebuild landing in between cannot
  // mix two builds.
  async function readMap(project, index) {
    const key = `${project}/${index.id}`, hit = loaded.get(key);
    loaded.delete(key);
    if (hit && hit.builtAt === index.data.builtAt) { loaded.set(key, hit); return hit.graph; }
    const [fresh, chunks] = await read(project, [{ path: `map/${index.id}` }, { collection: `map/${index.id}/chunks`, limit: 200 }]);
    if (!fresh) return null;
    const graph = loadGraph(fresh.data, chunks.filter((c) => +c.id < fresh.data.chunks).sort((a, b) => a.id - b.id).map((c) => c.data));
    loaded.set(key, { builtAt: fresh.data.builtAt, graph });
    if (loaded.size > LOADED) loaded.delete(loaded.keys().next().value);
    return graph;
  }
  const graphsOf = async (project, maps) => (await Promise.all(maps.map((m) => readMap(project, m)))).filter(Boolean);

  // Where these tasks' touches meet the rest of the open work; only a task that touches something costs a read, and a
  // map for the import hop is loaded only when other work touches something too.
  // maps: the map documents, or their read still under way.
  async function meeting(project, mine, maps) {
    if (!mine.length) return [];
    const [open, docs] = await Promise.all([query(project, OPEN.collection, OPEN).then((first) => rest(project, first, OPEN)), maps]);
    const others = open.map(touching).filter((t) => t.touches.length);
    return others.length ? overlapLines(mine, others, await graphsOf(project, docs)) : [];
  }

  // What board_claim and board_task add to a task: the code its text and touches name, from its repo's map (every map
  // when it names no repo), and where its touches meet other open work. A board without a map and a task that touches
  // nothing read nothing more.
  async function codeLines(project, key, d, det, maps, repos) {
    const mine = { key, holder: holderOf(d), touches: touchesOf(d) }, named = mapsNamed(maps, d.repo, repos);
    const ask = { title: d.title, spec: det?.data?.spec, acceptance: det?.data?.acceptance, touches: mine.touches };
    const code = (await graphsOf(project, named)).flatMap((g) => g.context(ask, { limit: CODE_LINES }).lines).slice(0, CODE_LINES);
    return [...(code.length ? ['code:', ...code] : []), ...await meeting(project, mine.touches.length ? [mine] : [], named)];
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
    // a todo task you own was assigned to you and not started: it is listed as yours, not as anyone's ready work
    const mine = got.owned.filter((t) => statusOf(t.data) !== 'done');
    // where your work meets others', read alongside the ready work
    const meets = meeting(project, mine.map(touching).filter((t) => t.touches.length), got.maps).catch(quiet);
    let free = (ready ? await readyWork(member, project, got.todo) : []).sort(byDocKey);
    await moving;
    const elsewhere = scope.want ? free.filter((t) => { const r = taskRepo(t.data, scope.repos); return r && r !== scope.want; }).length : 0;
    if (scope.want) free = free.filter(scope.here);
    // someone else's work waiting for a review, which anyone may finish after the merge or send back
    const toReview = got.inReview.filter((t) => holderOf(t.data) !== me && scope.here(t)).sort(byDocKey);

    const out = [`${me} · ${project}${config.milestone ? ` · ${oneLine(config.milestone)}` : ''} · artiboard ${VERSION}`];
    if (scope.repos.length) out.push(`repos: ${repoList(scope.repos)}`);
    out.push(...got.maps.map((m) => `code map: ${mapLine(m, scope.repos)}`));
    if (scope.stray) out.push(scope.stray);
    if (rules) out.push(...rulesLines(got.rules, got.notes, got.maps.length > 0));
    out.push(...noticeLines(notices, got.latest.length, since));
    out.push(...mineLines(mine, me), ...await meets);
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
      maps: MAPS,
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

  // the board rules (with the code map's rule where there is a map), the project's rules in full, and a pointer to its
  // notes: the shared status (schedule, where things stand) is long and changes daily, so it is pointed at, not printed
  function rulesLines(own, notes, mapped) {
    const out = mapped ? [BOARD_RULES, MAP_RULES] : [BOARD_RULES];
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
    const other = (d) => d.lastMessageBy && d.lastMessageBy !== me ? oneLine(d.lastMessageBy) : null;
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
    const [t, det, config, maps, latest = []] = await read(project, [{ path: `tasks/${id}` }, { path: `details/${id}` }, { path: 'meta/config' }, MAPS,
      ...(thread ? [{ collection: `tasks/${id}/messages`, order: [{ field: 'at', dir: 'desc' }], limit: thread }] : [])]);
    if (!t) throw new BoardError('not_found', `no task ${id}`);
    const d = t.data;
    const since = det?.data?.summaryAt;
    const msgs = latest.filter((m) => !since || (typeof m.data.at === 'string' && m.data.at >= since)).reverse();
    const who = d.owner ? `${d.owner}${d.claimedBy?.agent && d.claimedBy.who === d.owner ? ' (agent)' : ''}` : 'unassigned';
    const out = [`${d.key || id} ${d.status || 'todo'} · ${who}${d.repo ? ` · repo:${d.repo}` : ''}${d.branch ? ` · ${d.branch}` : ''}${d.pr ? ` · ${d.pr}` : ''}`, d.title || ''];
    const deps = depsOf(d), waiting = depsOf({ deps: d.waitingOn });
    if (deps.length) out.push(`deps ${deps.join(', ')}${waiting.length ? ` · waiting on ${waiting.join(', ')}` : ''}`);
    const dates = [day(d.start) && `start ${d.start}`, day(d.due) && `due ${d.due}`, d.doneAt && `done ${short(d.doneAt)}`, d.archivedAt && `archived ${short(d.archivedAt)}`].filter(Boolean);
    if (dates.length) out.push(dates.join(' · '));
    if (touchesOf(d).length) out.push(`touches: ${touchesOf(d).join(', ')}`);
    out.push(...detailLines(det), ...await codeLines(project, d.key || id, d, det, maps, reposOf(config?.data)).catch(quiet));
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
    const [det, config, maps] = await read(project, [{ path: `details/${id}` }, { path: 'meta/config' }, MAPS]);
    let claimed;
    const result = await retrying(async () => {
      const t = await get(project, `tasks/${id}`);
      if (!t) throw new BoardError('not_found', `no task ${id}`);
      const d = t.data, status = statusOf(d), holder = holderOf(d);
      claimed = { ...d, owner: me };
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
    return [result, ...detailLines(det), ...await codeLines(project, claimed.key || id, claimed, det, maps, reposOf(config?.data)).catch(quiet)].join('\n');
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
  // touches adds files and symbols to what the task's work touches ("" or [] clears them), and the answer says where
  // they meet other open work.
  async function post(member, project, { task: id, tasks, text, type, status, branch, pr, start, due, repo, summary, touches, override }) {
    const me = member.person;
    // only "" or [] clears; a blank name is no name, and a leading ./ names the same file
    const clears = touches === '' || (Array.isArray(touches) && !touches.length);
    const named = clears || touches === undefined ? [] : [...new Set(touches.map((x) => x.trim().replace(/^\.\//, '')).filter(Boolean))];
    const touched = clears ? [] : named.length ? named : undefined;
    // the asked-for change, empty strings clearing a field
    const change = Object.fromEntries(Object.entries({ status, branch, pr, start, due, repo, summary, touches: touched }).filter(([, v]) => v !== undefined));
    const asked = Object.keys(change);
    if (tasks && (id || asked.some((k) => k !== 'status'))) throw new BoardError('invalid_argument', 'tasks takes status and text only, and no task');
    const ids = tasks ? [...new Set(tasks)] : id ? [id] : null;
    if (!ids) {
      if (asked.length) throw new BoardError('invalid_argument', 'status, branch, pr, start, due, repo, summary and touches need a task');
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
    let posted = null;
    const line = await retrying(async () => {
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
        if (touched) {
          const all = touched.length ? [...new Set([...touchesOf(d), ...touched])] : [];
          if (all.length > TOUCHES) throw new BoardError('invalid_argument', `${key} would touch ${all.length} files and symbols; a task keeps at most ${TOUCHES}: name files rather than each symbol, or clear the list with touches ""`);
          patch.touches = all.length ? all : null;
        }
        if (touched?.length) posted = { ...touching({ id: t.id, data: { ...d, ...patch } }), repo: 'repo' in patch ? patch.repo : d.repo };
        // with no text, the thread still says what changed
        const said = `${text?.trim() || [
          status && `status ${status}`, branch !== undefined && `branch ${branch || 'none'}`, pr !== undefined && `pr ${pr || 'none'}`,
          start !== undefined && `start ${start || 'none'}${day(d.start) ? ` (was ${d.start})` : ''}`,
          due !== undefined && `due ${due || 'none'}${day(d.due) ? ` (was ${d.due})` : ''}`,
          repo !== undefined && `repo ${repo || 'none'}`, touched && `touches ${touched.join(', ') || 'none'}`, summary !== undefined && 'summary updated',
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
      if (writes.length > 100) throw new BoardError('invalid_argument', `${writes.length} writes is more than one call takes (100): pass fewer tasks`);
      const { more, unblocked } = status === 'done' ? await unblockDependents(project, keys, patches) : { more: [], unblocked: [] };
      // the dependents' waitingOn go in the same write while they fit; a task with more dependents than that still
      // finishes, and the rest follow best effort, as readiness repairs do: start and claim check readiness against the
      // deps themselves, so one that is lost heals there
      await apply(member, project, [...writes, ...more.splice(0, 100 - writes.length)]);
      for (let i = 0; i < more.length; i += 100) await apply(member, project, more.slice(i, i + 100)).catch(() => {});
      return [`ok ${keys.join(', ')}${status ? ` → ${status}` : ''}`, unblocked.length && `unblocked ${unblocked.sort(keyOrder).join(', ')}`].filter(Boolean).join(' · ');
    });
    if (!posted) return line;
    return [line, ...await meeting(project, [posted], mapsOf(project).then(({ maps, repos }) => mapsNamed(maps, posted.repo, repos))).catch(quiet)].join('\n');
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

  // board_map: one question to one repository's map, answered in lines; no question, the map's overview. repo picks
  // the map by label or owner/name when the project has several.
  async function map(project, { repo, explain, file, path: pair, query: words, impact, inside, limit } = {}) {
    const asked = Object.entries({ explain, file, path: pair, query: words, impact, inside }).filter(([, v]) => v !== undefined);
    if (asked.length > 1) throw new BoardError('invalid_argument', 'ask one of explain, file, path, query, impact and inside at a time');
    const { maps: all, repos } = await mapsOf(project), maps = mapsNamed(all, repo, repos), name = (m) => mapName(m, repos);
    if (!all.length) return `no code map on ${project}; one is built from a checkout with the artiboard skill's scripts/codemap.mjs`;
    if (!maps.length) throw new BoardError('not_found', `no code map for ${repo}; maps: ${all.map(name).join(', ')}`);
    if (maps.length > 1) {
      if (asked.length) throw new BoardError('invalid_argument', `${maps.length} code maps here (${maps.map(name).join(', ')}); pass repo`);
      return [...maps.map((m) => mapLine(m, repos)), 'pass repo for one map\'s overview'].join('\n');
    }
    const graph = await readMap(project, maps[0]);
    if (!graph) throw new BoardError('not_found', `the code map of ${name(maps[0])} was just dropped`);
    const [how, arg] = asked[0] || ['overview'], opts = limit ? { limit } : {};
    const answer = how === 'path' ? graph.path(arg[0], arg[1]) : how === 'overview' ? graph.overview(opts) : graph[how](arg, opts);
    const text = answer.lines.join('\n') || 'nothing found';
    // an answer nobody sized is cut, so one question never costs more than a screen; limit asks for more on purpose
    if (limit || text.length <= MAP_ANSWER) return text;
    const cut = text.lastIndexOf('\n', MAP_ANSWER);
    return `${text.slice(0, cut > 0 ? cut : MAP_ANSWER)}\n… cut at ${MAP_ANSWER} characters: ask a narrower name, or pass limit`;
  }

  // A repository's map as the build script made it: its chunks, the last build's chunks beyond the new count deleted,
  // then the index that says how many, in one write, so a reader sees one build whole. The key, the label, who built it
  // and when are the board's to say. A rebuild replaces the map; one racing another rereads and writes again. root,
  // where the map was built from, only names the folder when a map with no files is refused: a wrong --root must not
  // replace a good map with an empty one.
  async function setMap(member, project, { repo, index, chunks, root } = {}) {
    const [{ repo: name }] = cleanRepos([repo]);
    if (!isObject(index) || index.version !== 1) throw new BoardError('invalid_argument', 'index.version must be 1: build the map with this site\'s version of artiboard');
    if (!Array.isArray(chunks)) throw new BoardError('invalid_argument', 'chunks must be a list');
    if (chunks.length > MAP_CHUNKS) {
      throw new BoardError('invalid_argument', `a map holds at most ${MAP_CHUNKS} chunks (about 25,000 symbols), not ${chunks.length}: map the part that matters with --root <subdirectory>`);
    }
    chunks.forEach((c, i) => {
      if (Buffer.byteLength(JSON.stringify(c) ?? '') > MAP_CHUNK) throw new BoardError('invalid_argument', `chunk ${i} is over ${MAP_CHUNK} bytes of JSON; build smaller chunks`, i);
    });
    const problem = mapProblem(index, chunks);
    if (problem) throw new BoardError('invalid_argument', problem);
    if (!index.counts.files) throw new BoardError('invalid_argument', `the map of ${name} has no files: is ${root || 'the folder it was built from'} the repository's root?`);
    const key = repoKey(name);
    const write = async () => {
      const { maps, repos } = await mapsOf(project), old = maps.find((m) => m.id === key);
      const label = repos.find((r) => repoName(r.repo) === repoName(name))?.label || index.label;
      const writes = chunks.map((data, n) => ({ op: 'set', path: `map/${key}/chunks/${n}`, data }));
      for (let n = chunks.length; n < (old?.data.chunks || 0); n++) writes.push({ op: 'delete', path: `map/${key}/chunks/${n}` });
      writes.push({ op: 'set', path: `map/${key}`, ...(old ? { if_version: old.version } : { if_absent: true }),
        data: { ...index, repo: name, ...(label && { label }), builtAt: now(), by: member.person, chunks: chunks.length } });
      await apply(member, project, writes);
      return { repoKey: key, counts: index.counts, chunks: chunks.length };
    };
    try { return await write(); } catch (e) {
      if (!['version_conflict', 'already_exists'].includes(toBoardError(e).code)) throw e;
      return write();
    }
  }

  // one write, so a reader never finds an index without its chunks or chunks without their index
  async function dropMap(member, project, repo) {
    const { maps, repos } = await mapsOf(project), [m, ...more] = mapsNamed(maps, repo, repos);
    if (!m || more.length) throw new BoardError('not_found', `no single code map for ${repo}`);
    const chunks = Array.from({ length: m.data.chunks || 0 }, (_, n) => ({ op: 'delete', path: `map/${m.id}/chunks/${n}` }));
    await apply(member, project, [...chunks, { op: 'delete', path: `map/${m.id}`, if_version: m.version }]);
    return `dropped the code map of ${mapName(m, repos)}`;
  }

  return { start, task, claim, post, batch, projectFor, map, mapsMeta, setMap, dropMap };
}
