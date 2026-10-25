// Builds a code map from a checkout's files: nodes for files, symbols and doc sections, the edges between them, and
// communities of files that belong together. No model calls and no clock but builtAt: the same files give the same map.
import { mapDegrees } from './graph.js';
import { langFor } from './lang/index.js';
import { headCommit, listFiles, readFiles } from './scan.js';

const BUILD_CHUNK_BYTES = 200000;
const BUILD_COMMUNITIES = 40, BUILD_GOD = 20, BUILD_TOP = 5, BUILD_SMALL = 3;
// names every standard library has: matched by name alone, they are more often a coincidence than a call
const BUILD_COMMON = new Set(['get', 'set', 'has', 'add', 'delete', 'remove', 'clear', 'push', 'pop', 'shift', 'unshift',
  'map', 'filter', 'reduce', 'find', 'forEach', 'some', 'every', 'keys', 'values', 'entries', 'join', 'split', 'slice',
  'splice', 'replace', 'test', 'exec', 'then', 'catch', 'finally', 'log', 'error', 'warn', 'info', 'debug', 'write', 'read',
  'open', 'close', 'start', 'stop', 'run', 'call', 'apply', 'bind', 'toString', 'valueOf', 'sort', 'includes', 'indexOf',
  'concat', 'match', 'trim', 'parse', 'stringify', 'append', 'insert', 'emit', 'send', 'next', 'init', 'main', 'len',
  'print', 'format', 'length', 'size', 'count', 'equals', 'hashCode', 'copy', 'clone', 'reset']);

const buildBase = (p) => p.slice(p.lastIndexOf('/') + 1);
const buildDir = (p) => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '');
const buildTopDir = (p) => (p.includes('/') ? p.slice(0, p.indexOf('/')) : '');
// tests and their fixtures: they follow the code they test, in communities, and stay out of the most connected
const BUILD_TEST_DIRS = new Set(['test', 'tests', '__tests__', 'spec', 'fixtures']);
const buildIsTest = (p) => p.split('/').slice(0, -1).some((d) => BUILD_TEST_DIRS.has(d))
  || /\.(test|spec)\.[^.]+$|_test\.go$|Test\.java$|Tests\.cs$/.test(buildBase(p));
// a heading's id part: lowercase, spaces to '-', only letters, digits and '-' (in any script, so headings that are
// not in English keep their words)
const buildSlug = (s) => s.toLowerCase().replace(/\s+/g, '-').replace(/[^\p{L}\p{N}-]/gu, '');
const buildCmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const buildPush = (map, key, v) => { const list = map.get(key); if (list) list.push(v); else map.set(key, [v]); };

function buildNormalize(p) {
  const out = [];
  for (const part of p.split('/')) {
    if (part === '..') { if (!out.length) return null; out.pop(); }
    else if (part && part !== '.') out.push(part);
  }
  return out.join('/');
}

function buildEdge(b, from, to, type, conf) {
  if (from === to) return;
  const key = `${from}\n${to}\n${type}`, had = b.edges.get(key);
  if (!had || had[3] === 'i' && conf === 'x') b.edges.set(key, [from, to, type, conf]);
}

// the innermost symbol whose lines hold `line`; refs outside every symbol belong to the file
function buildEnclosing(syms, line) {
  let best = null;
  for (const s of syms) {
    if (s.end && s.line <= line && line <= s.end && (!best || s.line > best.line || s.line === best.line && s.end < best.end)) best = s;
  }
  return best;
}

function buildExtract(b, files) {
  for (const p of b.paths) {
    const lang = b.langFor(p);
    if (!lang) continue;
    const text = files.get(p) || '';
    let x;
    // one file a language cannot read costs that file's symbols, not the map
    try { x = lang.extract(text, p) || {}; } catch { x = {}; }
    const lines = text.split('\n');
    b.last.set(p, lines.length - (lines[lines.length - 1] === '' ? 1 : 0));
    b.lines.set(p, lines);
    const list = (v) => (Array.isArray(v) ? v.filter((o) => o && typeof o === 'object') : []);
    b.lang.set(p, lang);
    b.parsed.set(p, { symbols: list(x.symbols), imports: list(x.imports), refs: list(x.refs), extends: list(x.extends) });
    b.nodes.set(p, { i: p, k: lang.doc ? 'doc' : 'file', n: buildBase(p), f: p, l: 0 });
    buildPush(b.stems, lang.id, [p.replace(/\.[^./]+$/, ''), p]);
  }
}

// symbol and section nodes; a name defined twice in one file gets its line appended to the second id
function buildSymbols(b) {
  for (const [p, x] of b.parsed) {
    const doc = !!b.lang.get(p).doc, list = [];
    for (const s of x.symbols) {
      if (typeof s.name !== 'string' || !s.name || !(s.line >= 1)) continue;
      let id = `${p}#${doc ? buildSlug(s.name) : s.name}`;
      if (b.nodes.has(id)) id = `${id}@${s.line}`;
      if (b.nodes.has(id)) continue;
      const node = { i: id, k: doc ? 'sec' : 'sym', n: s.name, f: p, l: s.line, t: s.kind };
      if (!doc && s.exported !== false) node.e = 1;
      if (!doc) {
        const sig = buildSig(b.lines.get(p), s.line, s.kind, b.lang.get(p)), about = buildDoc(b.lines.get(p), s.line);
        if (sig) node.s = sig;
        if (about) node.d = about;
      }
      b.nodes.set(id, node);
      buildEdge(b, p, id, doc ? 'contains' : 'defines', 'x');
      // a function nested in another ('makeFlow.post') is reached through its scope only: `xs.map(` is not makeFlow.map
      const method = !doc && (s.kind === 'method' || s.name.includes('.') && s.kind !== 'fn');
      const sym = { id, file: p, name: s.name, kind: s.kind, line: s.line, end: s.end >= s.line ? s.end : null, method,
        last: s.name.slice(s.name.lastIndexOf('.') + 1), exported: s.exported !== false };
      list.push(sym);
      if (doc) continue;
      buildPush(b.byName, s.name, sym);
      if (method) buildPush(b.byLast, sym.last, sym);
    }
    buildEnds(list, b.last.get(p));
    b.syms.set(p, list);
  }
}

const buildCut = (s, n) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
// kinds whose declaration is followed by a body, cut off from the signature
const BUILD_BODIES = new Set(['fn', 'class', 'method', 'module']);

// The declaration as written, on one line of at most 120 characters: for a function, class or method its line (and
// the next ones while its brackets are open) up to the body (`{`, `=>`, Python's `:`); for the rest the line itself
// less a trailing `{`, `(`, `[`, `=` or `;`. Strings are kept whole; a line comment ends it.
function buildSig(lines, line, kind, lang) {
  const body = BUILD_BODIES.has(kind), py = lang.id === 'python';
  const hash = py || lang.id === 'ruby', dashes = lang.id === 'sql';
  let out = '', depth = 0, quote = '';
  const done = () => buildCut(out.replace(/\s+/g, ' ').trim().replace(/[\s{([=;,]+$/, ''), 120);
  for (let k = line - 1; k < Math.min(lines.length, line + 7); k++) {
    const raw = lines[k];
    for (let i = 0; i < raw.length; i++) {
      const c = raw[i], spaced = i === 0 || /\s/.test(raw[i - 1]);
      if (quote) {
        out += c;
        if (c === '\\') out += raw[++i] || '';
        else if (c === quote) quote = '';
        continue;
      }
      if (c === '"' || c === "'" || c === '`') { quote = c; out += c; continue; }
      if (spaced && (c === '/' && raw[i + 1] === '/' || hash && c === '#' || dashes && c === '-' && raw[i + 1] === '-')) return done();
      if (c === '(' || c === '[' || c === '{') {
        if (c === '{' && body && !depth) return done();
        depth++;
      } else if (c === ')' || c === ']' || c === '}') depth = Math.max(0, depth - 1);
      else if (body && !depth && (c === '=' && raw[i + 1] === '>' || py && c === ':')) return done();
      out += c;
    }
    if (!body || !depth) break;
    out += ' ';
  }
  return done();
}

// The comment just above a symbol, one line of at most 160 characters: `//`, `#`, `--`, `/* … */` and `/** … */`
// lines (decorators between them and the symbol skipped), markers and leading `*` dropped; else a Python docstring's
// first line below it. None when the line above is blank or code.
function buildDoc(lines, line) {
  const parts = [];
  let k = line - 2;
  while (k >= 0 && /^\s*(@|#\[)/.test(lines[k])) k--;
  for (;;) {
    if (k >= 0 && /\*\/\s*$/.test(lines[k])) {
      let top = k;
      while (top > 0 && !lines[top].includes('/*')) top--;
      if (!/^\s*\/\*/.test(lines[top])) break;
      parts.unshift(...lines.slice(top, k + 1).map((l) => l.replace(/^\s*\/\*+|\*+\/\s*$/g, '').replace(/^\s*\*(?!\/)\s?/, '')));
      k = top - 1;
    } else if (k >= 0 && /^\s*(\/\/|#(\s|#|$)|--(\s|-|$))/.test(lines[k])) {
      parts.unshift(lines[k].replace(/^\s*(\/\/+|#+|--+)/, ''));
      k--;
    } else break;
  }
  let text = parts.join(' ').replace(/\s+/g, ' ').trim();
  if (!text) {
    const m = /^[rRuUbB]?("""|''')(.*)$/.exec((lines[line] || '').trim());
    if (m) text = (m[2] || (lines[line + 1] || '')).replace(/("""|''').*$/, '').trim();
  }
  return buildCut(text, 160);
}

// A language that gives no end: a symbol runs to the line before the next symbol, or to the file's last line. Ending
// a class at its first method instead of its last loses nothing: a line goes to the innermost symbol that holds it.
function buildEnds(list, last) {
  const starts = list.map((s) => s.line).sort((x, y) => x - y);
  for (const s of list) {
    if (s.end) continue;
    const next = starts.find((l) => l > s.line);
    s.end = next ? next - 1 : Math.max(last, s.line);
  }
}

// A module name the language could not place, matched by the end of its path: '@/ui/Button' or 'app.models.user'
// name ui/Button.tsx or app/models/user.py when exactly one file of that language ends so. A one-word bare name
// ('react', 'os') is a package far more often than a repo file, so it is left out.
function buildGuess(b, spec, lang) {
  if (spec.startsWith('.') || /^[a-z][\w+.-]*:/i.test(spec) || /^@(?!\/)/.test(spec)) return null;
  const alias = /^[~#@]\//.test(spec);
  const parts = (spec.includes('/') ? spec.split('/') : spec.split('.')).filter((s) => /^[\w-]+$/.test(s));
  if (parts.length < (alias ? 1 : 2)) return null;
  const tail = parts.join('/');
  const hits = (b.stems.get(lang.id) || []).filter(([stem]) => stem === tail || stem.endsWith(`/${tail}`)
    || stem === `${tail}/index` || stem.endsWith(`/${tail}/index`));
  return hits.length === 1 ? hits[0][1] : null;
}

function buildImports(b) {
  for (const [p, x] of b.parsed) {
    const lang = b.lang.get(p), targets = new Map(), outside = new Set();
    for (const imp of x.imports) {
      if (typeof imp.spec !== 'string' || !imp.spec) continue;
      const names = Array.isArray(imp.names) ? imp.names.filter((n) => typeof n === 'string') : [];
      let to = null, conf = 'x';
      try { to = lang.resolve(imp.spec, p, b.paths); } catch { to = null; }
      if (!to || !b.has.has(to)) { to = buildGuess(b, imp.spec, lang); conf = 'i'; }
      if (!to) { names.forEach((n) => outside.add(n)); continue; }
      if (to === p) continue;
      buildEdge(b, p, to, 'imports', conf);
      if (!targets.has(to)) targets.set(to, { names: new Set(), sure: false });
      const t = targets.get(to);
      t.sure = t.sure || conf === 'x';
      names.forEach((n) => t.names.add(n));
    }
    b.imports.set(p, targets);
    b.outside.set(p, outside);
  }
}

// Each step below says which symbol a name used in file p means: [id, 'x' | 'i'], null when the name is ambiguous
// there (it is dropped), or undefined when the step knows nothing of it and the next one asks.

// 1. this file's own names
function buildInFile(b, p, lang, ref, from) {
  const { name } = ref, own = b.syms.get(p) || [];
  const cls = from && from.method ? from.name.slice(0, from.name.lastIndexOf('.')) : null;
  const mine = cls && own.find((s) => s.name === `${cls}.${name}`);
  if (ref.self && mine) return [mine.id, 'x'];
  if (ref.member) {
    const here = own.filter((s) => s.method && s.last === name);
    return here.length ? (here.length === 1 ? [here[0].id, 'i'] : null) : undefined;
  }
  // a function declared in the function the call is in, or beside it there, is the one the language's scope finds
  const outer = from && from.kind === 'fn' ? from.name.split('.')[0] : null;
  const nested = outer && own.find((s) => s.kind === 'fn' && s.name === `${outer}.${name}`);
  if (nested) return [nested.id, 'x'];
  const here = own.filter((s) => !s.method && s.name === name);
  if (here.length) return [here[0].id, 'x'];
  // a bare call inside a class may be to the class's own method, in languages where `self` goes unwritten
  if (mine && !ref.base && !lang.moduleScope) return [mine.id, 'i'];
  return undefined;
}

// 2. the files p imports: a method for `obj.name(`, a top-level name otherwise, and where files see only each
// other's exports, an exported one. Explicit ('x') when imported by name through imports that were resolved, not
// guessed; `export { x } from './y'` is followed for a name imported by name.
function buildThroughImports(b, p, lang, ref) {
  const { name } = ref, imports = b.imports.get(p) || new Map(), cands = new Map();
  const fits = (s) => (ref.member ? s.method && s.last === name : !s.method && s.name === name) && (s.exported || !lang.moduleScope);
  for (const [file, t] of imports) {
    for (const s of b.syms.get(file) || []) if (fits(s)) cands.set(s.id, cands.get(s.id) || (t.sure && t.names.has(name)));
  }
  let frontier = [...imports].filter(([, t]) => t.names.has(name)).map(([f, t]) => [f, t.sure]);
  const seen = new Set(frontier.map(([f]) => f));
  for (let hop = 0; hop < 3 && !cands.size && frontier.length; hop++) {
    const next = [];
    for (const [f, sure] of frontier) {
      for (const [g, t] of b.imports.get(f) || []) if (t.names.has(name) && !seen.has(g)) { seen.add(g); next.push([g, sure && t.sure]); }
    }
    for (const [g, sure] of next) for (const s of b.syms.get(g) || []) if (fits(s)) cands.set(s.id, sure);
    frontier = next;
  }
  const all = [...cands], sure = all.filter(([, x]) => x);
  if (all.length === 1) return [all[0][0], all[0][1] ? 'x' : 'i'];
  if (sure.length === 1) return [sure[0][0], 'x'];
  return all.length ? null : undefined;
}

// 3. the one symbol of that name in the repo, in the same language, for languages whose files see each other's
// names without an import; never a name p imported from a package, or one every library has
function buildByName(b, p, lang, ref) {
  const { name } = ref;
  if (lang.moduleScope || b.outside.get(p).has(name) || BUILD_COMMON.has(name) || name.length < 3) return null;
  const sameLang = (s) => s.file !== p && b.lang.get(s.file) === lang;
  let pool = ref.member ? [] : (b.byName.get(name) || []).filter((s) => !s.method && sameLang(s));
  if (!pool.length && !ref.base) pool = (b.byLast.get(name) || []).filter(sameLang);
  return pool.length === 1 ? [pool[0].id, 'i'] : null;
}

// a name used as a value (passed, stored, returned): only where it is certain, bound in this file or imported by
// name; a guess would be noise
function buildUse(b, p, lang, ref, from) {
  const hit = buildInFile(b, p, lang, { name: ref.name }, from) ?? buildThroughImports(b, p, lang, { name: ref.name });
  return hit && hit[1] === 'x' ? hit : null;
}

function buildResolve(b, p, lang, ref, from) {
  for (const step of [() => buildInFile(b, p, lang, ref, from), () => buildThroughImports(b, p, lang, ref)]) {
    const hit = step();
    if (hit !== undefined) return hit;
  }
  return buildByName(b, p, lang, ref);
}

// calls, uses and extends; a base named in `extends` is not also a call
function buildRefs(b) {
  for (const [p, x] of b.parsed) {
    const lang = b.lang.get(p);
    if (lang.doc) continue;
    const syms = b.syms.get(p), bases = new Set(x.extends.map((e) => `${e.line} ${e.base}`));
    for (const ref of x.refs) {
      if (typeof ref.name !== 'string' || !ref.name || bases.has(`${ref.line} ${ref.name}`)) continue;
      const from = buildEnclosing(syms, ref.line);
      const hit = ref.use ? buildUse(b, p, lang, ref, from) : buildResolve(b, p, lang, ref, from);
      if (hit) buildEdge(b, from ? from.id : p, hit[0], ref.use ? 'uses' : 'calls', hit[1]);
    }
    for (const e of x.extends) {
      if (typeof e.base !== 'string' || !e.base) continue;
      const own = syms.find((s) => s.name === e.name && !s.method) || null;
      const hit = buildResolve(b, p, lang, { name: e.base, base: true }, own);
      if (hit) buildEdge(b, own ? own.id : p, hit[0], 'extends', hit[1]);
    }
  }
}

// a path written in a doc: from the doc's folder, as its links are, then from the repo root ('x'); else the one file
// whose path ends so ('i')
function buildPathMention(b, doc, written) {
  const p = written.replace(/[#?:].*$/, '').replace(/^\.\//, '');
  const rel = buildNormalize(`${buildDir(doc)}/${p}`);
  if (rel && b.has.has(rel)) return [rel, 'x'];
  if (b.has.has(p)) return [p, 'x'];
  const tail = `/${p.replace(/^(\.\.?\/)+/, '')}`;
  const hits = (b.bases.get(buildBase(p)) || []).filter((f) => `/${f}`.endsWith(tail));
  return hits.length === 1 ? [hits[0], 'i'] : null;
}

// a backticked name in a doc: an id as written ('x'), or the one symbol of that name ('i')
function buildNameMention(b, name) {
  if (name.includes('#')) return b.nodes.get(name)?.k === 'sym' ? [name, 'x'] : null;
  if (BUILD_COMMON.has(name) || name.length < 3) return null;
  const hits = b.byName.get(name) || [];
  return hits.length === 1 ? [hits[0].id, 'i'] : null;
}

function buildMentions(b) {
  for (const [p, x] of b.parsed) {
    if (!b.lang.get(p).doc) continue;
    const secs = b.syms.get(p);
    for (const ref of x.refs) {
      if (typeof ref.name !== 'string' || !ref.name) continue;
      const hit = ref.path ? buildPathMention(b, p, ref.name) : buildNameMention(b, ref.name);
      if (!hit || hit[0] === p) continue;
      const from = buildEnclosing(secs, ref.line);
      buildEdge(b, from ? from.id : p, hit[0], 'mentions', hit[1]);
    }
  }
}

// Label propagation among the files `take` marks, over the links between them only, in sorted order: each takes the
// label its links weigh most for (ties keep the current label, else take the lowest). A link counts less the more
// links its two files have, or a README that names everything would pull the whole repo into one community.
function buildPropagate(adj, label, take) {
  const links = adj.map((m, i) => (take[i] ? [...m].reduce((s, [j, w]) => s + (take[j] ? w : 0), 0) : 0));
  const tie = (x, y) => Math.abs(x - y) < 1e-9;
  take.forEach((t, i) => { if (t) label[i] = i; });
  for (let round = 0; round < 50; round++) {
    let changed = false;
    for (let i = 0; i < adj.length; i++) {
      if (!take[i]) continue;
      const tally = new Map();
      for (const [j, w] of adj[i]) if (take[j]) tally.set(label[j], (tally.get(label[j]) || 0) + w / Math.sqrt(links[i] * links[j]));
      if (!tally.size) continue;
      const max = Math.max(...tally.values());
      const pick = tie(tally.get(label[i]) || 0, max) ? label[i] : Math.min(...[...tally].filter(([, w]) => tie(w, max)).map(([l]) => l));
      if (pick !== label[i]) { label[i] = pick; changed = true; }
    }
    if (!changed) break;
  }
}

// A group's name: the deepest folder at least 60% of its files are in, else the folder most are in when 40% are,
// else its busiest code file. Tests and docs (followers) do not name a group that has other files.
function buildName(members, lead, follows) {
  const own = members.filter((f) => !follows(f));
  const named = own.length ? own : members, held = new Map();
  for (const f of named) {
    const parts = buildDir(f).split('/').filter(Boolean);
    for (let k = 1; k <= parts.length; k++) held.set(parts.slice(0, k).join('/'), (held.get(parts.slice(0, k).join('/')) || 0) + 1);
  }
  const deeper = ([p, n], [q, m]) => m - n || q.split('/').length - p.split('/').length || buildCmp(p, q);
  const most = [...held].sort(deeper)[0];
  const deep = [...held].filter(([, n]) => n * 10 >= named.length * 6).sort(([p], [q]) => q.split('/').length - p.split('/').length)[0];
  if (deep) return deep[0];
  return most && most[1] * 10 >= named.length * 4 ? most[0] : buildBase(lead);
}

// Communities of files over imports and mentions. Code votes among itself; then each test, doc or file of no language
// joins the group whose code it imports or mentions most (a test that imports half the repo, or a README that names
// every folder, would otherwise glue them together), and those that reach no code (a fixture tree) vote among
// themselves. Groups under 3 files join the group they have most links to (code by code links), or a group mostly in
// their top folder. Returns the communities, largest first.
function buildCommunities(b, degree) {
  const files = [...b.nodes.values()].filter((n) => n.k === 'file' || n.k === 'doc').map((n) => n.i).sort(buildCmp);
  const at = new Map(files.map((f, i) => [f, i]));
  const adj = files.map(() => new Map()), outs = files.map(() => new Map());
  for (const [from, to, type] of b.edges.values()) {
    if (type !== 'imports' && type !== 'mentions') continue;
    const x = at.get(b.nodes.get(from).f), y = at.get(b.nodes.get(to).f);
    if (x === y) continue;
    adj[x].set(y, (adj[x].get(y) || 0) + 1);
    adj[y].set(x, (adj[y].get(x) || 0) + 1);
    outs[x].set(y, (outs[x].get(y) || 0) + 1);
  }
  // only code votes: tests, docs and files of no language (package.json, an image) follow what reaches them
  const follows = (f) => buildIsTest(f) || b.nodes.get(f).k === 'doc' || !b.lang.has(f);
  const follower = files.map(follows), label = files.map(() => null);
  buildPropagate(adj, label, follower.map((t) => !t));
  const sizes = new Map();
  label.forEach((l) => { if (l !== null) sizes.set(l, (sizes.get(l) || 0) + 1); });
  follower.forEach((t, i) => {
    if (!t) return;
    const tally = new Map();
    for (const [j, w] of outs[i]) if (!follower[j]) tally.set(label[j], (tally.get(label[j]) || 0) + w);
    let pick = null;
    for (const [l, w] of tally) if (pick === null || w > tally.get(pick) || w === tally.get(pick) && (sizes.get(l) > sizes.get(pick) || sizes.get(l) === sizes.get(pick) && l < pick)) pick = l;
    label[i] = pick;
  });
  buildPropagate(adj, label, label.map((l) => l === null));
  const groups = new Map();
  label.forEach((l, i) => buildPush(groups, l, i));
  const merge = (from, into) => {
    for (const i of groups.get(from)) label[i] = into;
    groups.get(into).push(...groups.get(from));
    groups.delete(from);
  };
  const larger = (t, than) => groups.get(t).length > groups.get(than).length || groups.get(t).length === groups.get(than).length && t < than;
  for (let again = true; again;) {
    again = false;
    for (const l of [...groups.keys()].sort((x, y) => x - y)) {
      const g = groups.get(l);
      if (!g || g.length >= BUILD_SMALL) continue;
      // a group with code in it goes where its code links, not where a doc that names it went
      const code = g.some((i) => !follower[i]), touch = new Map();
      for (const i of g) for (const [j, w] of adj[i]) if (label[j] !== l && (!code || !follower[j])) touch.set(label[j], (touch.get(label[j]) || 0) + w);
      let into = null;
      for (const [t, w] of touch) if (into === null || w > touch.get(into) || w === touch.get(into) && larger(t, into)) into = t;
      if (into !== null) { merge(l, into); again = true; }
    }
  }
  for (const l of [...groups.keys()].sort((x, y) => x - y)) {
    const g = groups.get(l);
    if (!g || g.length >= BUILD_SMALL) continue;
    // a group mostly in that folder, or another small one there: a lone script does not join a group that merely
    // holds one script
    const dir = buildTopDir(files[Math.min(...g)]);
    let into = null, most = 0;
    for (const [t, members] of groups) {
      if (t === l) continue;
      const n = members.filter((i) => buildTopDir(files[i]) === dir).length;
      if (n * 2 < members.length && members.length >= BUILD_SMALL) continue;
      if (n > most || n && n === most && larger(t, into)) { into = t; most = n; }
    }
    if (into !== null) merge(l, into);
  }
  // still alone (code no code reaches, in a folder of its own): where any link goes
  for (const l of [...groups.keys()].sort((x, y) => x - y)) {
    const g = groups.get(l);
    if (!g || g.length >= BUILD_SMALL) continue;
    const touch = new Map();
    for (const i of g) for (const [j, w] of adj[i]) if (label[j] !== l) touch.set(label[j], (touch.get(label[j]) || 0) + w);
    let into = null;
    for (const [t, w] of touch) if (into === null || w > touch.get(into) || w === touch.get(into) && larger(t, into)) into = t;
    if (into !== null) merge(l, into);
  }
  const deg = (id) => degree.get(id) || 0;
  const byDegree = (x, y) => deg(y) - deg(x) || buildCmp(x, y);
  const list = [...groups.values()].map((g) => {
    const members = g.map((i) => files[i]).sort(buildCmp);
    const ids = members.concat(...members.map((f) => (b.syms.get(f) || []).filter((s) => b.nodes.get(s.id).k === 'sym').map((s) => s.id)));
    // the file that names a group, and its top nodes, are code first: a README links to everything, a test imports it
    const lead = members.slice().sort((x, y) => follows(x) - follows(y) || byDegree(x, y))[0];
    const top = ids.sort((x, y) => follows(b.nodes.get(x).f) - follows(b.nodes.get(y).f) || byDegree(x, y)).slice(0, BUILD_TOP);
    return { members, lead, name: buildName(members, lead, follows), n: members.length, top };
  });
  list.sort((x, y) => y.n - x.n || buildCmp(x.name, y.name) || buildCmp(x.members[0], y.members[0]));
  // two communities in one folder: each also says its most connected file, then a number if that is not enough
  const count = (key) => list.filter((c) => c.name === key).length;
  for (const c of list.filter((c) => count(c.name) > 1)) c.name = `${c.name} (${buildBase(c.lead)})`;
  const used = new Map();
  for (const c of list) {
    const k = (used.get(c.name) || 0) + 1;
    used.set(c.name, k);
    if (k > 1) c.name = `${c.name} ${k}`;
  }
  return list;
}

function buildChunks(nodes, edges, limit) {
  if (!nodes.length) return [];
  const size = (v) => Buffer.byteLength(JSON.stringify(v));
  const byFrom = new Map();
  for (const e of edges) buildPush(byFrom, e[0], e);
  const chunks = [];
  let cur, used;
  const fresh = () => { cur = { nodes: [], edges: [] }; chunks.push(cur); used = size(cur); };
  fresh();
  for (const node of nodes) {
    const own = byFrom.get(node.i) || [], sizes = own.map((e) => size(e) + 1), nodeSize = size(node) + 1;
    // a node goes with its edges; only a node whose edges overflow a whole chunk spills them into the next
    if (used + nodeSize + sizes.reduce((a, s) => a + s, 0) > limit && (cur.nodes.length || cur.edges.length)) fresh();
    cur.nodes.push(node);
    used += nodeSize;
    own.forEach((e, k) => {
      if (used + sizes[k] > limit) fresh();
      cur.edges.push(e);
      used += sizes[k];
    });
  }
  return chunks;
}

// files: Map of repo-relative path to text (a file with no language may map to ''); opts: { repo, by, commit?,
// root?, label?, chunkBytes?, langFor? } (langFor picks a file's language; tests hand it a made-up one)
export function buildGraph(files, opts = {}) {
  const paths = [...files.keys()].sort(buildCmp);
  const b = {
    paths, has: new Set(paths), bases: new Map(), lang: new Map(), parsed: new Map(), nodes: new Map(), edges: new Map(),
    syms: new Map(), byName: new Map(), byLast: new Map(), imports: new Map(), outside: new Map(), stems: new Map(),
    last: new Map(), lines: new Map(), langFor: opts.langFor || langFor,
  };
  for (const p of paths) buildPush(b.bases, buildBase(p), p);
  buildExtract(b, files);
  buildSymbols(b);
  buildImports(b);
  buildRefs(b);
  buildMentions(b);
  // a file with no language is on the map only when something imports or mentions it
  for (const [, to] of b.edges.values()) if (!b.nodes.has(to) && b.has.has(to)) b.nodes.set(to, { i: to, k: 'file', n: buildBase(to), f: to, l: 0 });
  const edges = [...b.edges.values()].filter(([from, to]) => b.nodes.has(from) && b.nodes.has(to))
    .sort((x, y) => buildCmp(x[0], y[0]) || buildCmp(x[1], y[1]) || buildCmp(x[2], y[2]));
  const degree = mapDegrees(edges);
  const communities = buildCommunities(b, degree);
  communities.slice(0, BUILD_COMMUNITIES).forEach((c, k) => {
    c.c = k;
    for (const f of c.members) for (const id of [f, ...(b.syms.get(f) || []).map((s) => s.id)]) b.nodes.get(id).c = k;
  });
  const nodes = [...b.nodes.values()].sort((x, y) => buildCmp(x.i, y.i));
  for (const n of nodes) if ((n.k === 'file' || n.k === 'doc') && buildIsTest(n.i)) n.q = 't';
  const god = nodes.filter((n) => n.k !== 'sec' && !buildIsTest(n.f) && degree.get(n.i))
    .sort((x, y) => degree.get(y.i) - degree.get(x.i) || buildCmp(x.i, y.i)).slice(0, BUILD_GOD).map((n) => n.i);
  const chunks = buildChunks(nodes, edges, opts.chunkBytes || BUILD_CHUNK_BYTES);
  const langs = {};
  for (const lang of [...b.lang.values()].map((l) => l.id).sort(buildCmp)) langs[lang] = (langs[lang] || 0) + 1;
  const kinds = (k) => nodes.filter((n) => n.k === k).length;
  const index = {
    repo: opts.repo,
    ...(opts.label ? { label: opts.label } : {}),
    ...(opts.commit ? { commit: opts.commit } : {}),
    builtAt: new Date().toISOString(),
    by: opts.by,
    ...(opts.root != null ? { root: opts.root } : {}),
    counts: { files: kinds('file'), symbols: kinds('sym'), edges: edges.length, docs: kinds('doc') },
    chunks: chunks.length,
    communities: communities.slice(0, BUILD_COMMUNITIES).map(({ c, name, n, top }) => ({ c, name, n, top })),
    god,
    langs,
    version: 1,
  };
  return { index, chunks };
}

// scan a checkout and build its map; the commit is the checked-out one unless opts says otherwise
export async function mapRepo(root, opts = {}) {
  const paths = await listFiles(root);
  const texts = await readFiles(root, paths.filter((p) => langFor(p)));
  const files = new Map(paths.map((p) => [p, texts.get(p) || '']));
  const commit = opts.commit || await headCommit(root);
  return buildGraph(files, { ...opts, ...(commit ? { commit } : {}) });
}
