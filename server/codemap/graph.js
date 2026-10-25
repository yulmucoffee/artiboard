// Reading a code map: a node and its connections, a file's outline, the path between two names, a search, what
// depends on a change, where open tasks touch the same code, and the slice of the map a task needs. Imports nothing
// and uses no Node API: the board page carries a copy of this file, so the page and the tools answer alike.

// a file defining many functions, or a doc with many sections, is not thereby central
const GRAPH_STRUCTURE = { defines: 1, contains: 1 };
const GRAPH_GROUPS = [['defines', 'out', 'defines'], ['sections', 'out', 'contains'], ['imports', 'out', 'imports'],
  ['imported by', 'in', 'imports'], ['calls', 'out', 'calls'], ['called by', 'in', 'calls'], ['uses', 'out', 'uses'],
  ['used by', 'in', 'uses'], ['extends', 'out', 'extends'],
  ['extended by', 'in', 'extends'], ['mentions', 'out', 'mentions'], ['mentioned in', 'in', 'mentions']];
const GRAPH_DEPENDS = { imports: 1, calls: 1, uses: 1, extends: 1 };
const GRAPH_CODE = { imports: 1, calls: 1, uses: 1, extends: 1, defines: 1 };
const GRAPH_SEEDS = 6;
// a word matching more nodes than this, and this many times the nodes the question's rarest word matches, is common;
// docs show this many lines
const GRAPH_COMMON_MIN = 5, GRAPH_COMMON_RATIO = 4, GRAPH_DOC_LINES = 4;
const GRAPH_CONTEXT_CHARS = 20000;
const GRAPH_STOP = new Set(['the', 'and', 'for', 'with', 'that', 'this', 'from', 'into', 'when', 'what', 'where', 'which',
  'how', 'why', 'are', 'was', 'were', 'has', 'have', 'had', 'not', 'but', 'all', 'any', 'can', 'does', 'did', 'its', 'our',
  'out', 'use', 'using', 'used', 'should', 'would', 'could', 'will', 'then', 'than', 'them', 'they', 'there', 'their',
  'about', 'after', 'before', 'over', 'under', 'also', 'each', 'every', 'only', 'just', 'more', 'most', 'some', 'such',
  'very', 'been', 'being', 'both', 'same', 'other', 'make', 'need', 'needs', 'want', 'code', 'file', 'files', 'add', 'fix',
  'new', 'way', 'work', 'works', 'like', 'see', 'get', 'got', 'who', 'you', 'your']);

const graphCmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const graphPush = (map, key, v) => { const list = map.get(key); if (list) list.push(v); else map.set(key, [v]); };
const graphKind = (n) => (n.k === 'sym' || n.k === 'sec' ? n.t || n.k : n.k);
const graphWhere = (n) => (n.l ? `${n.f}:${n.l}` : n.f);
// list lines stay one screen wide, so a long declaration is shortened there
const graphSig = (n, max = 80) => (n.s ? ` · ${n.s.length > max ? `${n.s.slice(0, max - 1)}…` : n.s}` : '');
const graphDeg = (g, id) => g.degree.get(id) || 0;
const graphByDegree = (g) => (a, b) => graphDeg(g, b) - graphDeg(g, a) || graphCmp(a, b);
const graphByLine = (g) => (a, b) => (g.nodes.get(a).l || 0) - (g.nodes.get(b).l || 0) || graphCmp(a, b);
// a function declared inside another ('makeFlow.post') is a function by its own name ('post'); a method is not
const graphShort = (n) => (n.k === 'sym' && n.t === 'fn' && n.n.includes('.') ? n.n.slice(n.n.lastIndexOf('.') + 1) : n.n);

// edges per node, both directions, leaving out a file's own definitions and a doc's own sections
export function mapDegrees(edges) {
  const deg = new Map();
  for (const [from, to, type] of edges) {
    if (GRAPH_STRUCTURE[type]) continue;
    deg.set(from, (deg.get(from) || 0) + 1);
    deg.set(to, (deg.get(to) || 0) + 1);
  }
  return deg;
}

// Up to limit items as lines, then how many were left out; with more, also the limit that shows them all (rounded
// up to ten), since an agent that is not told does not ask.
function graphList(lines, items, limit, line, more) {
  for (const it of items.slice(0, limit)) lines.push(line(it));
  if (items.length > limit) lines.push(`  … ${items.length - limit} more${more ? ` (limit ${Math.ceil(items.length / 10) * 10})` : ''}`);
}

function graphCommunity(g, n) {
  const c = n && n.c != null && (g.index.communities || []).find((x) => x.c === n.c);
  return c ? c.name : '';
}

// The nodes a name may mean, most exact first: an id, a name as written (a nested function's own name too), a name in
// any case, a method by its last part, the end of a file path. A tie between code and doc sections goes to the code.
function graphFind(g, q) {
  const s = String(q == null ? '' : q).trim().replace(/^\.\//, '');
  if (!s) return [];
  if (g.nodes.has(s)) return [s];
  const lower = s.toLowerCase(), named = g.names.get(lower) || [], lasts = g.lasts.get(lower) || [];
  const tiers = [
    named.filter((id) => g.nodes.get(id).n === s || graphShort(g.nodes.get(id)) === s),
    named,
    lasts.filter((id) => g.nodes.get(id).n.endsWith(`.${s}`)),
    lasts,
    s.includes('/') ? graphEnding(g, s) : [],
  ];
  for (const t of tiers) {
    if (!t.length) continue;
    const code = t.filter((id) => g.nodes.get(id).k !== 'sec');
    return code.length ? code : t;
  }
  return [];
}

// File and doc ids whose path is p or ends in /p, looked up by p's last two parts (or its name): a path that is not in
// the map costs one lookup, not a pass over every node.
function graphEnding(g, p) {
  const parts = p.split('/');
  const pool = parts.length > 1 ? g.tails.get(parts.slice(-2).join('/')) : g.bases.get(p);
  return (pool || []).filter((id) => id === p || id.endsWith(`/${p}`));
}

// one node for a name, or the answer that says why not
function graphOne(g, q) {
  const ids = graphFind(g, q);
  if (ids.length === 1) return { id: ids[0] };
  if (!ids.length) return { lines: [`not in the map: ${q}`], missing: true };
  const lines = [`${q} names ${ids.length}; say which:`];
  graphList(lines, ids, 12, (id) => `  ${id} · ${graphKind(g.nodes.get(id))} · ${graphWhere(g.nodes.get(id))}`);
  return { lines, ambiguous: ids };
}

function graphHead(g, n) {
  const c = graphCommunity(g, n);
  return `${n.n} · ${graphKind(n)} · ${graphWhere(n)}${c ? ` · community ${c}` : ''} · degree ${graphDeg(g, n.i)}`;
}

function graphExplain(g, name, { limit = 30 } = {}) {
  const hit = graphOne(g, name);
  if (!hit.id) return hit;
  const n = g.nodes.get(hit.id), lines = [graphHead(g, n)];
  // what it takes and what it is for, so the answer needs no trip to the file
  if (n.s) lines.push(n.s);
  if (n.d) lines.push(`// ${n.d}`);
  for (const [label, dir, type] of GRAPH_GROUPS) {
    const other = (e) => (dir === 'out' ? e.to : e.from);
    const order = GRAPH_STRUCTURE[type] ? graphByLine(g) : graphByDegree(g);
    const es = (g[dir].get(n.i) || []).filter((e) => e.type === type).sort((a, b) => order(other(a), other(b)));
    if (!es.length) continue;
    lines.push(`${label}:`);
    graphList(lines, es, limit, (e) => `  ${other(e)} [${e.conf}]`, true);
  }
  return { lines, id: n.i };
}

// a file and its symbols are asked together, and an end reached twice is listed once, with its surest conf
function graphEnds(g, ids, dir, type) {
  const ends = new Map(), own = new Set(ids);
  for (const id of ids) {
    for (const e of g[dir].get(id) || []) {
      const end = dir === 'out' ? e.to : e.from;
      if (e.type !== type || own.has(end)) continue;
      if (!ends.has(end) || e.conf === 'x') ends.set(end, e.conf);
    }
  }
  return [...ends].sort((a, b) => graphCmp(a[0], b[0]));
}

function graphFile(g, path, { limit = 30 } = {}) {
  const files = [...new Set(graphFind(g, path).map((id) => g.nodes.get(id).f))].filter((f) => g.nodes.has(f));
  if (files.length !== 1) return files.length ? graphOne(g, path) : { lines: [`not in the map: ${path}`], missing: true };
  const f = g.nodes.get(files[0]), all = g.files.get(f.i) || [f.i];
  const inner = all.filter((id) => id !== f.i).sort(graphByLine(g));
  const importers = graphEnds(g, [f.i], 'in', 'imports'), c = graphCommunity(g, f);
  const what = f.k === 'doc' ? 'sections' : 'symbols';
  const lines = [`${f.i} · ${f.k}${c ? ` · community ${c}` : ''} · ${inner.length} ${what} · imported by ${importers.length}`];
  if (inner.length) {
    lines.push(`${what}:`);
    graphList(lines, inner, limit, (id) => { const n = g.nodes.get(id); return `  ${n.n} ${graphKind(n)} ${n.l}${graphSig(n)}`; }, true);
  }
  const groups = [['imports', graphEnds(g, [f.i], 'out', 'imports')], ['imported by', importers],
    ['mentions', graphEnds(g, all, 'out', 'mentions')], ['mentioned in', graphEnds(g, all, 'in', 'mentions')]];
  for (const [label, ends] of groups) {
    if (!ends.length) continue;
    lines.push(`${label}:`);
    graphList(lines, ends, limit, ([id, conf]) => `  ${id} [${conf}]`, true);
  }
  return { lines, id: f.i, symbols: inner };
}

// null when to is out of reach over these edges, so the caller can try again with more kinds of edge
function graphWalk(g, from, to, max, keep) {
  const prev = new Map([[from, null]]);
  let frontier = [from];
  for (let d = 0; d < max && frontier.length && !prev.has(to); d++) {
    const next = [];
    for (const id of frontier) {
      const steps = (g.out.get(id) || []).filter(keep).map((e) => [e.to, e])
        .concat((g.in.get(id) || []).filter(keep).map((e) => [e.from, e])).sort((x, y) => graphCmp(x[0], y[0]));
      for (const [n, e] of steps) if (!prev.has(n)) { prev.set(n, [id, e]); next.push(n); }
    }
    frontier = next;
  }
  return prev.has(to) ? prev : null;
}

// the shortest chain of edges between two names, whichever way each edge points; through code alone when there is
// one, since a doc that mentions both says little about how they connect
function graphPath(g, a, b, { max = 6 } = {}) {
  const A = graphOne(g, a);
  if (!A.id) return A;
  const B = graphOne(g, b);
  if (!B.id) return B;
  const prev = graphWalk(g, A.id, B.id, max, (e) => GRAPH_CODE[e.type]) || graphWalk(g, A.id, B.id, max, () => true);
  if (!prev) return { lines: [`no path from ${A.id} to ${B.id} within ${max} steps`], missing: true };
  const steps = [];
  for (let id = B.id; prev.get(id); id = prev.get(id)[0]) steps.unshift({ at: prev.get(id)[0], to: id, e: prev.get(id)[1] });
  const line = steps.reduce((s, { at, to, e }) => `${s}${e.from === at ? ` --${e.type}--> ` : ` <--${e.type}-- `}${to}`, A.id);
  const guessed = steps.filter((s) => s.e.conf === 'i').map((s) => `${s.e.from} → ${s.e.to}`);
  return { lines: guessed.length ? [line, `matched by name: ${guessed.join(', ')}`] : [line], path: [A.id, ...steps.map((s) => s.to)] };
}

// what a word can match on a node: its names (×3), the parts of its path or name (×2), and its text (×1)
function graphTerms(g) {
  if (g.terms) return g.terms;
  g.terms = new Map();
  for (const id of g.ids) {
    const n = g.nodes.get(id), name = String(n.n || '');
    let names, parts, hay;
    if (n.k === 'file' || n.k === 'doc') {
      names = [name.replace(/\.[^.]+$/, '').toLowerCase()];
      parts = id.toLowerCase().split(/[/._-]+/);
      hay = id.toLowerCase();
    } else if (n.k === 'sym') {
      const last = name.slice(name.lastIndexOf('.') + 1);
      names = [name.toLowerCase(), last.toLowerCase()];
      parts = last.replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase().split(/[\s_$]+/);
      hay = name.toLowerCase();
    } else {
      names = [name.toLowerCase()];
      parts = name.toLowerCase().split(/[^\p{L}\p{N}_]+/u);
      hay = names[0];
    }
    g.terms.set(id, { names, parts, hay });
  }
  return g.terms;
}

// how well a word matches a node: one of its names 3, a part of its path or name 2, somewhere in its text 1
const graphMatch = (t, w) => (t.names.includes(w) ? 3 : t.parts.includes(w) ? 2 : t.hay.includes(w) ? 1 : 0);

function graphQuery(g, text, { limit = 20 } = {}) {
  const words = [...new Set(String(text || '').toLowerCase().split(/[^\p{L}\p{N}_]+/u))].filter((w) => w.length >= 3 && !GRAPH_STOP.has(w));
  const terms = graphTerms(g), hits = words.map(() => []);
  for (const id of g.ids) words.forEach((w, k) => { const m = graphMatch(terms.get(id), w); if (m) hits[k].push([id, m]); });
  // A word counts less the more nodes it matches. A common word ('read' is in every reader and every README) cannot
  // carry a node alone when the question has a rarer word: such a node must match one of those.
  const rarest = Math.min(...hits.map((list) => list.length || Infinity));
  const common = hits.map((list) => list.length > GRAPH_COMMON_MIN && list.length >= GRAPH_COMMON_RATIO * rarest);
  const rare = hits.some((list, k) => list.length && !common[k]);
  const score = new Map(), carried = new Set();
  hits.forEach((list, k) => {
    for (const [id, m] of list) {
      score.set(id, (score.get(id) || 0) + m / Math.log(2 + list.length));
      if (!common[k]) carried.add(id);
    }
  });
  for (const id of [...score.keys()]) {
    if (rare && !carried.has(id)) score.delete(id);
    else score.set(id, score.get(id) * Math.log(2 + graphDeg(g, id)));
  }
  if (!score.size) return { lines: [`nothing in the map matches: ${text}`], missing: true };
  const byScore = (a, b) => score.get(b) - score.get(a) || graphCmp(a, b);
  // the best matches bring their neighbors: a matching function brings its file, its callers and what it calls
  for (const seed of [...score.keys()].sort(byScore).slice(0, GRAPH_SEEDS)) {
    const near = score.get(seed) / 4;
    for (const e of (g.out.get(seed) || []).concat(g.in.get(seed) || [])) {
      const other = e.from === seed ? e.to : e.from;
      if ((score.get(other) || 0) < near) score.set(other, near);
    }
  }
  // code first and tests after the code they test; docs apart, a few
  const isCode = (id) => g.nodes.get(id).k === 'file' || g.nodes.get(id).k === 'sym';
  const isTest = (id) => { const f = g.nodes.get(g.nodes.get(id).f); return f && f.q === 't' ? 1 : 0; };
  const code = [...score.keys()].filter(isCode).sort((a, b) => isTest(a) - isTest(b) || byScore(a, b)).slice(0, limit);
  const kinds = { files: code.filter((id) => g.nodes.get(id).k === 'file'), symbols: code.filter((id) => g.nodes.get(id).k === 'sym'),
    docs: [...score.keys()].filter((id) => !isCode(id)).sort(byScore).slice(0, GRAPH_DOC_LINES) };
  const symbolCount = (id) => (g.files.get(id) || []).filter((s) => g.nodes.get(s).k === 'sym').length;
  const show = {
    files: (id) => { const c = graphCommunity(g, g.nodes.get(id)); return `  ${id} · ${symbolCount(id)} symbols${c ? ` · ${c}` : ''}`; },
    symbols: (id) => { const n = g.nodes.get(id); return `  ${id} · ${graphKind(n)} · ${n.l}${graphSig(n)}`; },
    docs: (id) => { const n = g.nodes.get(id); return n.k === 'doc' ? `  ${id} · doc` : `  ${id} · ${graphKind(n)} · ${n.l}`; },
  };
  const lines = [];
  for (const k of ['files', 'symbols', 'docs']) {
    if (!kinds[k].length) continue;
    lines.push(`${k}:`);
    for (const id of kinds[k]) lines.push(show[k](id));
  }
  return { lines, ...kinds };
}

// who depends on a node: importers, callers, users and subclasses; for a file, also those of its symbols, from elsewhere
function graphDependents(g, id) {
  const n = g.nodes.get(id), found = [];
  const targets = n.k === 'file' ? g.files.get(id) || [id] : [id];
  for (const t of targets) for (const e of g.in.get(t) || []) if (GRAPH_DEPENDS[e.type]) found.push(e);
  return n.k === 'file' ? found.filter((e) => g.nodes.get(e.from).f !== id) : found;
}

// Breadth first from a node through the edges step gives, to depth; each node once, at its first depth, with the
// edge that reached it (end says which end of an edge is the node reached). A file's own symbols start with it, so
// they are not listed. Prints like impact and inside do, depth by depth.
function graphReach(g, nameOrPath, { depth = 2, limit = 30 } = {}, step, end, head, none) {
  const hit = graphOne(g, nameOrPath);
  if (!hit.id) return hit;
  const start = g.nodes.get(hit.id).k === 'file' ? g.files.get(hit.id) || [hit.id] : [hit.id];
  const seen = new Set(start), levels = [];
  let frontier = start;
  for (let d = 1; d <= depth && frontier.length; d++) {
    const level = [];
    for (const id of frontier) for (const e of step(id)) if (!seen.has(end(e))) { seen.add(end(e)); level.push(e); }
    level.sort((a, b) => graphCmp(end(a), end(b)));
    if (level.length) levels.push(level);
    frontier = level.map(end);
  }
  const total = levels.reduce((s, l) => s + l.length, 0);
  if (!total) return { lines: [none(hit.id)], levels: [] };
  const lines = [head(hit.id, total, depth)];
  levels.forEach((level, d) => {
    lines.push(`depth ${d + 1}:`);
    graphList(lines, level, limit, (e) => `  ${end(e)} [${e.conf}] ${e.type}`, true);
  });
  return { lines, levels: levels.map((l) => l.map(end)) };
}

// what breaks if it changes: who imports, calls, uses or extends it, and theirs
function graphImpact(g, nameOrPath, opts = {}) {
  return graphReach(g, nameOrPath, opts, (id) => graphDependents(g, id), (e) => e.from, (id, n, d) => `impact of ${id}: ${n} dependents within ${d} steps`, (id) => `nothing depends on ${id}`);
}

// what it is made of: what it calls, uses and extends, and theirs (a file: what its symbols do)
function graphInside(g, nameOrPath, opts = {}) {
  const step = (id) => (g.out.get(id) || []).filter((e) => e.type === 'calls' || e.type === 'uses' || e.type === 'extends');
  return graphReach(g, nameOrPath, opts, step, (e) => e.to, (id, n, d) => `inside ${id}: ${n} callees within ${d} steps`,
    (id) => `${id} calls and uses nothing in the map`);
}

// Which code a map describes, as the parts of a line: branch@commit (just @commit off a branch) and whether the
// checkout had changes no commit holds. A map built outside git says neither.
export function mapSource(ix) {
  return [ix.commit ? `${ix.branch || ''}@${String(ix.commit).slice(0, 7)}` : '', ix.dirty === true ? 'uncommitted changes' : ''].filter(Boolean);
}

function graphOverview(g, { limit = 10 } = {}) {
  const ix = g.index, c = ix.counts || {};
  const built = [ix.builtAt ? `built ${String(ix.builtAt).slice(5, 10)}` : '', ix.by ? `by ${ix.by}` : ''].filter(Boolean).join(' ');
  const lines = [[ix.repo || 'code map', `${c.files || 0} files`, `${c.symbols || 0} symbols`, `${c.edges || 0} edges`,
    `${c.docs || 0} docs`, built, ...mapSource(ix)].filter(Boolean).join(' · ')];
  const langs = Object.entries(ix.langs || {}).sort((a, b) => b[1] - a[1] || graphCmp(a[0], b[0]));
  if (langs.length) lines.push(`langs: ${langs.map(([l, n]) => `${l} ${n}`).join(' · ')}`);
  const communities = ix.communities || [], god = ix.god || [];
  if (communities.length) {
    lines.push('communities:');
    graphList(lines, communities, limit, (x) => `  ${x.name} · ${x.n} files · ${(x.top || []).slice(0, 3).join(', ')}`);
  }
  if (god.length) {
    lines.push('most connected:');
    graphList(lines, god, limit, (id) => {
      const n = g.nodes.get(id);
      return n ? `  ${id} · ${graphKind(n)} · degree ${graphDeg(g, id)}` : `  ${id}`;
    });
  }
  return { lines, communities, god };
}

// A touch as overlaps compares it: a leading ./ dropped, a symbol (`src/a.js#run`) read as its file. A bare name
// ('run') stays itself and so matches only the same name.
const graphTouchKey = (t) => (typeof t === 'string' ? t.trim().replace(/^\.\//, '').replace(/#.*$/, '') : '');

// Open tasks that touch the same code, in one place for the server and the page.
//   tasks: [{ key, holder?, touches: string[] }], every open task the caller cares about; it keeps the pairs it wants.
//   Two tasks overlap when they share a touch (as graphTouchKey reads it), or, with a map, when a file one touches
//   imports a file the other touches. A person's own tasks never overlap each other.
//   Returns { lines, pairs: [{ a, b, shared } | { a, b, imports: [[from, to]] }] }, pairs in task order.
// Each task's touches are read once, and pairs come from a touch → tasks index, so many tasks stay cheap.
function graphOverlaps(g, tasks) {
  const list = (Array.isArray(tasks) ? tasks : []).filter((t) => t && Array.isArray(t.touches) && t.touches.length);
  const keys = list.map((t) => [...new Set(t.touches.map(graphTouchKey).filter(Boolean))]);
  const tasksOf = new Map();
  keys.forEach((ks, i) => ks.forEach((k) => graphPush(tasksOf, k, i)));
  const apart = (i, j) => !!list[i].holder && list[i].holder === list[j].holder;
  const found = new Map();
  const meet = (i, j) => { if (i !== j && !apart(i, j)) found.set(Math.min(i, j) * list.length + Math.max(i, j), [Math.min(i, j), Math.max(i, j)]); };
  for (const ts of tasksOf.values()) for (let x = 0; x < ts.length; x++) for (let y = x + 1; y < ts.length; y++) meet(ts[x], ts[y]);
  const imports = new Set();
  for (const [k, ts] of tasksOf) {
    for (const e of g.out.get(k) || []) {
      if (e.type !== 'imports' || !tasksOf.has(e.to)) continue;
      imports.add(`${k}\n${e.to}`);
      for (const i of ts) for (const j of tasksOf.get(e.to)) meet(i, j);
    }
  }
  const who = (t) => (t.holder ? `${t.key} (${t.holder})` : `${t.key}`);
  const lines = [], pairs = [];
  for (const [i, j] of [...found.values()].sort((x, y) => x[0] - y[0] || x[1] - y[1])) {
    const shared = keys[i].filter((k) => keys[j].includes(k)), hops = [];
    if (!shared.length) {
      for (const x of keys[i]) for (const y of keys[j]) {
        if (imports.has(`${x}\n${y}`)) hops.push([x, y]);
        else if (imports.has(`${y}\n${x}`)) hops.push([y, x]);
      }
    }
    lines.push(`${who(list[i])} ↔ ${who(list[j])}: ${shared.length ? shared.join(', ') : hops.map(([x, y]) => `${x} → ${y}`).join(', ')}`);
    pairs.push({ a: list[i].key, b: list[j].key, ...(shared.length ? { shared } : { imports: hops }) });
  }
  return { lines, pairs };
}

// The part of the map a task needs when it is claimed: its touches, the repo paths its text names, and the symbols
// it names in backticks or CamelCase, each as its file with what that file is. The text is read word by word and
// only its first 20,000 characters: a spec may be a quarter megabyte, and this runs inside every claim.
function graphContext(g, task, { limit = 8 } = {}) {
  const t = task || {}, found = new Map();
  const add = (file, name) => {
    if (!g.nodes.has(file)) return;
    if (!found.has(file)) found.set(file, new Set());
    if (name) found.get(file).add(name);
  };
  for (const touch of Array.isArray(t.touches) ? t.touches : []) {
    const ids = graphFind(g, touch);
    if (ids.length === 1) { const n = g.nodes.get(ids[0]); add(n.f, n.k === 'sym' ? n.n : ''); }
  }
  const text = [t.title, t.spec, t.acceptance].filter((x) => typeof x === 'string').join('\n').slice(0, GRAPH_CONTEXT_CHARS);
  const quoted = [], camel = [];
  for (const word of text.split(/\s+/)) {
    const bare = word.replace(/^[("'`[<]+/, '').replace(/[)"'`\]>.,;:!?]+$/, '').replace(/^\.\//, '');
    if (!bare) continue;
    if (bare.includes('/') || /\.[A-Za-z0-9]+$/.test(bare)) {
      const n = g.nodes.get(bare);
      const ends = n ? [] : bare.includes('/') ? graphEnding(g, bare) : [];
      if (n && (n.k === 'file' || n.k === 'doc')) add(bare, '');
      else if (ends.length === 1) add(ends[0], '');
    }
    if (word.startsWith('`')) quoted.push(word.replace(/^`+/, '').replace(/[`(].*$/, ''));
    else if (/^[A-Za-z_$][\w$]*$/.test(bare) && /[a-z0-9][A-Z]/.test(bare)) camel.push(bare);
  }
  for (const name of new Set([...quoted, ...camel])) {
    const ids = (g.names.get(name.toLowerCase()) || []).filter((id) => g.nodes.get(id).k === 'sym' && g.nodes.get(id).n === name);
    // a name defined in many places says little about where the work is
    if (ids.length && ids.length <= 3) for (const id of ids) add(g.nodes.get(id).f, name);
  }
  const lines = [];
  for (const [file, syms] of [...found].slice(0, limit)) {
    const n = g.nodes.get(file), c = graphCommunity(g, n);
    const count = (g.files.get(file) || []).filter((id) => g.nodes.get(id).k === 'sym').length;
    const importers = graphEnds(g, [file], 'in', 'imports').length;
    lines.push([file, `${count} symbols`, `imported by ${importers}`, c, [...syms].join(', ')].filter(Boolean).join(' · '));
  }
  return { lines, files: [...found.keys()].slice(0, limit) };
}

// How communities connect: how many code edges (imports, calls, uses, extends, mentions) join files of one to files of
// another, as [a, b, n] with a < b, strongest first, at most GRAPH_LINKS. The builder writes them into the index so the
// page draws the groups from that one small document; a map built before they existed gets them from its chunks.
const GRAPH_LINKS = 200;
export function communityLinks(nodes, edges) {
  const com = new Map();
  for (const n of nodes) if (n && typeof n.i === 'string' && Number.isInteger(n.c)) com.set(n.i, n.c);
  const count = new Map();
  for (const e of edges) {
    if (!Array.isArray(e) || GRAPH_STRUCTURE[e[2]]) continue;
    const a = com.get(e[0]), b = com.get(e[1]);
    if (a === undefined || b === undefined || a === b) continue;
    const key = a < b ? `${a}\n${b}` : `${b}\n${a}`;
    count.set(key, (count.get(key) || 0) + 1);
  }
  return [...count].map(([k, n]) => [...k.split('\n').map(Number), n])
    .sort((x, y) => y[2] - x[2] || x[0] - y[0] || x[1] - y[1]).slice(0, GRAPH_LINKS);
}

// the file and doc ids of one community, by path, found once; files of no community (a map with more than 40
// communities leaves the smallest without one) are under -1
function graphFiles(g, c) {
  if (!g.byCommunity) {
    g.byCommunity = new Map();
    for (const id of g.ids) { const n = g.nodes.get(id); if (n.k === 'file' || n.k === 'doc') graphPush(g.byCommunity, Number.isInteger(n.c) ? n.c : -1, id); }
  }
  return g.byCommunity.get(c) || [];
}

// the names a search box offers as it is typed: the name itself first, then names that start with it, then names and
// paths that hold it; the most connected first within each, and doc sections after every code name
function graphSearch(g, q, limit = 10) {
  const s = String(q == null ? '' : q).trim().toLowerCase();
  if (!s) return [];
  const tiers = [[], [], [], []];
  for (const id of g.ids) {
    const n = g.nodes.get(id), name = String(n.n || '').toLowerCase(), short = graphShort(n).toLowerCase(), path = id.toLowerCase();
    const tier = name === s || short === s || path === s ? 0 : name.startsWith(s) || short.startsWith(s) ? 1
      : name.includes(s) || (n.k !== 'sym' && path.includes(s)) ? 2 : -1;
    if (tier >= 0) tiers[n.k === 'sec' ? 3 : tier].push(id);
  }
  const order = (a, b) => graphDeg(g, b) - graphDeg(g, a) || graphCmp(a, b);
  return tiers.flatMap((t) => t.sort(order)).slice(0, limit);
}

export function loadGraph(index, chunks) {
  const g = { index: index || {}, nodes: new Map(), out: new Map(), in: new Map(), names: new Map(), lasts: new Map(),
    files: new Map(), bases: new Map(), tails: new Map(), ids: [], degree: new Map(), terms: null, byCommunity: null, edges: [] };
  const edges = [];
  for (const ch of chunks || []) {
    for (const n of (ch && ch.nodes) || []) if (n && typeof n.i === 'string') g.nodes.set(n.i, n);
    for (const e of (ch && ch.edges) || []) if (Array.isArray(e)) edges.push(e);
  }
  const kept = edges.filter(([from, to]) => g.nodes.has(from) && g.nodes.has(to));
  g.edges = kept;
  for (const [from, to, type, conf] of kept) {
    const e = { from, to, type, conf };
    graphPush(g.out, from, e);
    graphPush(g.in, to, e);
  }
  g.degree = mapDegrees(kept);
  g.ids = [...g.nodes.keys()].sort(graphCmp);
  for (const id of g.ids) {
    const n = g.nodes.get(id), name = String(n.n || '');
    graphPush(g.names, name.toLowerCase(), id);
    if (graphShort(n) !== name) graphPush(g.names, graphShort(n).toLowerCase(), id);
    if (n.k === 'sym' && name.includes('.')) graphPush(g.lasts, name.slice(name.lastIndexOf('.') + 1).toLowerCase(), id);
    if (n.f) graphPush(g.files, n.f, id);
    if (n.k === 'file' || n.k === 'doc') {
      const parts = id.split('/');
      graphPush(g.bases, parts[parts.length - 1], id);
      if (parts.length > 1) graphPush(g.tails, parts.slice(-2).join('/'), id);
    }
  }
  return {
    index: g.index,
    explain: (name, opts) => graphExplain(g, name, opts || {}),
    file: (path, opts) => graphFile(g, path, opts || {}),
    path: (a, b, opts) => graphPath(g, a, b, opts || {}),
    query: (text, opts) => graphQuery(g, text, opts || {}),
    impact: (nameOrPath, opts) => graphImpact(g, nameOrPath, opts || {}),
    inside: (nameOrPath, opts) => graphInside(g, nameOrPath, opts || {}),
    overview: (opts) => graphOverview(g, opts || {}),
    overlaps: (tasks) => graphOverlaps(g, tasks),
    context: (task, opts) => graphContext(g, task, opts || {}),
    // what the page's graph view reads: the nodes a name may mean, one node, its edges, a file's symbols, a
    // community's files, and the communities with the links between them
    find: (q) => graphFind(g, q),
    search: (q, limit) => graphSearch(g, q, limit),
    node: (id) => g.nodes.get(id) || null,
    edges: (id) => ({ out: g.out.get(id) || [], in: g.in.get(id) || [] }),
    degree: (id) => graphDeg(g, id),
    inFile: (f) => (g.files.get(f) || []).filter((id) => id !== f).sort(graphByLine(g)),
    files: (c) => graphFiles(g, c),
    groups: () => ({ communities: Array.isArray(g.index.communities) ? g.index.communities : [],
      links: Array.isArray(g.index.links) ? g.index.links : communityLinks([...g.nodes.values()], g.edges) }),
  };
}
