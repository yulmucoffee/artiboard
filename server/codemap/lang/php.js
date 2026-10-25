// PHP: symbols, imports, references and inheritance. Comments and strings are blanked before the tokens are read,
// so a commented-out definition or a string that looks like code never becomes a symbol. A stack of scopes tells a
// method from a closure, and a top-level import from a trait use inside a class.

const PHP_SKIP = /\/\*[\s\S]*?(?:\*\/|$)|\/\/(?:(?!\?>)[^\n])*|#(?!\[)[^\n]*|'(?:[^'\\]|\\[\s\S])*'|"(?:[^"\\]|\\[\s\S])*"|<<<[ \t]*(["']?)([A-Za-z_]\w*)\1\r?\n(?:[\s\S]*?\n)?[ \t]*\2\b/g;
const PHP_TOKEN = /\\?[A-Za-z_\x80-￿][\w\x80-￿]*(?:\\[A-Za-z_\x80-￿][\w\x80-￿]*)*|\$[A-Za-z_\x80-￿][\w\x80-￿]*|\d[\w.]*|'[^']*'|"[^"]*"|::|\?->|->|\S/g;
const PHP_MODS = new Set(['public', 'private', 'protected', 'static', 'final', 'abstract', 'readonly', 'var']);
const PHP_KEYWORDS = new Set(['if', 'elseif', 'while', 'for', 'foreach', 'switch', 'catch', 'match', 'function', 'fn', 'array', 'list', 'isset', 'unset', 'empty', 'echo', 'print', 'return', 'exit', 'die', 'eval', 'declare', 'use', 'include', 'include_once', 'require', 'require_once', 'and', 'or', 'not']);
const PHP_NOT_CLASS = new Set(['class', 'self', 'parent', 'static']);
const PHP_DECL_KIND = new Map([['class', 'class'], ['trait', 'class'], ['interface', 'type'], ['enum', 'enum']]);
const PHP_INCLUDE = new Set(['include', 'include_once', 'require', 'require_once']);
const PHP_NONE = { v: '', p: -1, line: 0 };
const PHP_INDEX = new WeakMap();

function phpAt(toks, k) {
  return k >= 0 && k < toks.length ? toks[k] : PHP_NONE;
}

function phpBlank(s) {
  return s.replace(/[^\n]/g, ' ');
}

// A file without tags is plain code; a template's markup outside the tags is blanked so its words stay out of the map.
function phpCodeOnly(text) {
  if (!text.includes('<?')) return text;
  let out = '';
  let last = 0;
  let code = false;
  for (const m of text.matchAll(/<\?php\b|<\?=|\?>/g)) {
    const seg = text.slice(last, m.index);
    out += (code ? seg : phpBlank(seg)) + phpBlank(m[0]);
    code = m[0] !== '?>';
    last = m.index + m[0].length;
  }
  return out + (code ? text.slice(last) : phpBlank(text.slice(last)));
}

// Strings keep their quotes so the tokenizer still sees a literal; the text is read back from the original.
function phpStrip(text) {
  return phpCodeOnly(text).replace(PHP_SKIP, (m) => (m[0] === '"' || m[0] === "'" ? m[0] + phpBlank(m.slice(1, -1)) + m[0] : phpBlank(m)));
}

function phpTokens(code) {
  const toks = [];
  let line = 1;
  let at = 0;
  for (const m of code.matchAll(PHP_TOKEN)) {
    for (; at < m.index; at++) if (code.charCodeAt(at) === 10) line++;
    toks.push({ v: m[0], p: m.index, line });
  }
  return toks;
}

function phpIsWord(v) {
  return /^\\?[A-Za-z_\x80-￿]/.test(v);
}

function phpLast(name) {
  return name.slice(name.lastIndexOf('\\') + 1);
}

function phpHidden(mods) {
  return mods.includes('private') || mods.includes('protected');
}

// Reads a comma-separated list of names from j. Returns the index after the list.
function phpNameList(toks, j, onName) {
  while (phpIsWord(phpAt(toks, j).v)) {
    onName(phpAt(toks, j));
    j++;
    if (phpAt(toks, j).v === ',') j++;
    else break;
  }
  return j;
}

// `use A\B\C;`, `use A\B\C as D;`, `use A\B\{C, D as E};`, `use function A\f;`, `use A\B, C\D;`.
// Each imported class gets its full spec; names keep the original last segment, not the alias.
function phpUseImports(toks, i, out) {
  let j = i + 1;
  if (/^(function|const)$/i.test(phpAt(toks, j).v)) j++;
  while (phpIsWord(phpAt(toks, j).v)) {
    const head = phpAt(toks, j);
    const prefix = head.v.replace(/^\\/, '');
    j++;
    if (phpAt(toks, j).v === '\\' && phpAt(toks, j + 1).v === '{') {
      j += 2;
      while (phpAt(toks, j).v !== '' && phpAt(toks, j).v !== '}' && phpAt(toks, j).v !== ';') {
        const m = phpAt(toks, j);
        if (phpIsWord(m.v)) {
          out.push({ spec: `${prefix}\\${m.v}`, line: m.line, names: [phpLast(m.v)] });
          j++;
          if (/^as$/i.test(phpAt(toks, j).v)) j += 2;
        } else {
          j++;
        }
      }
      j++;
    } else {
      out.push({ spec: prefix, line: head.line, names: [phpLast(prefix)] });
      if (/^as$/i.test(phpAt(toks, j).v)) j += 2;
    }
    if (phpAt(toks, j).v !== ',') break;
    j++;
  }
  return j;
}

function phpParse(text) {
  const toks = phpTokens(phpStrip(text));
  const symbols = [];
  const imports = [];
  const refs = [];
  const extendsList = [];
  const scopes = [];
  let decl = null; // a class header, from its keyword to its brace
  let nsHeader = false; // `namespace X {` opens a namespace scope, `namespace X;` does not
  let mods = [];

  for (let i = 0; i < toks.length; i++) {
    const { v, line } = toks[i];
    const lower = v.toLowerCase();
    const prev = i > 0 ? toks[i - 1].v : '';
    const scope = scopes[scopes.length - 1];

    if (v === '{') {
      if (decl) {
        scopes.push({ kind: 'class', name: decl.name });
        for (const b of decl.bases) extendsList.push({ name: decl.name, base: b.name, line: b.line });
        decl = null;
      } else {
        scopes.push({ kind: nsHeader ? 'ns' : 'other' });
      }
      nsHeader = false;
      mods = [];
      continue;
    }
    if (v === '}') {
      scopes.pop();
      mods = [];
      continue;
    }
    if (v === ';') {
      nsHeader = false;
      mods = [];
      continue;
    }
    // An attribute's closing bracket ends the modifiers that came before it.
    if (v === ']') {
      mods = [];
      continue;
    }
    if (PHP_MODS.has(lower)) {
      mods.push(lower);
      continue;
    }
    if (lower === 'namespace') {
      nsHeader = true;
      continue;
    }

    const kind = PHP_DECL_KIND.get(lower);
    const nameTok = phpAt(toks, i + 1);
    // Foo::class, $x->class and `new class` are not declarations.
    if (kind && phpIsWord(nameTok.v) && !['extends', 'implements'].includes(nameTok.v.toLowerCase()) && !['::', '->', 'new'].includes(prev)) {
      decl = { name: nameTok.v, bases: [] };
      if (!scope || scope.kind === 'ns') symbols.push({ name: nameTok.v, kind, line: nameTok.line, exported: true });
      mods = [];
      i++;
      continue;
    }

    // Outside a declaration (an anonymous class) the bases are references only.
    if ((lower === 'extends' || lower === 'implements') && phpIsWord(phpAt(toks, i + 1).v)) {
      i = phpNameList(toks, i + 1, (t) => {
        const name = phpLast(t.v);
        refs.push({ name, line: t.line });
        if (decl) decl.bases.push({ name, line: t.line });
      }) - 1;
      continue;
    }

    if (lower === 'function') {
      const fnMods = mods;
      mods = [];
      let j = i + 1;
      if (phpAt(toks, j).v === '&') j++;
      const fnTok = phpAt(toks, j);
      if (phpIsWord(fnTok.v) && phpAt(toks, j + 1).v === '(') {
        if (!scope || scope.kind === 'ns') symbols.push({ name: fnTok.v, kind: 'fn', line: fnTok.line, exported: true });
        else if (scope.kind === 'class') symbols.push({ name: `${scope.name}.${fnTok.v}`, kind: 'method', line: fnTok.line, exported: !phpHidden(fnMods) });
        i = j;
      }
      continue;
    }

    if (lower === 'const') {
      const constMods = mods;
      mods = [];
      if (phpIsWord(nameTok.v) && phpAt(toks, i + 2).v === '=') {
        if (!scope || scope.kind === 'ns') symbols.push({ name: nameTok.v, kind: 'const', line: nameTok.line, exported: true });
        else if (scope.kind === 'class') symbols.push({ name: `${scope.name}.${nameTok.v}`, kind: 'const', line: nameTok.line, exported: !phpHidden(constMods) });
        i++;
      }
      continue;
    }

    if (lower === 'use') {
      if (scope && scope.kind === 'class') {
        i = phpNameList(toks, i + 1, (t) => {
          const base = phpLast(t.v);
          refs.push({ name: base, line: t.line });
          extendsList.push({ name: scope.name, base, line: t.line });
        }) - 1;
      } else if (!scope || scope.kind === 'ns') {
        i = phpUseImports(toks, i, imports) - 1;
      }
      continue;
    }

    // Include paths are literal only; a concatenated path such as __DIR__ . '/x.php' is not read.
    if (PHP_INCLUDE.has(lower)) {
      let j = i + 1;
      if (phpAt(toks, j).v === '(') j++;
      const s = phpAt(toks, j);
      if (s.v[0] === "'" || s.v[0] === '"') imports.push({ spec: text.slice(s.p + 1, s.p + s.v.length - 1), line: s.line, names: [] });
      continue;
    }

    if (lower === 'new') {
      const n = phpAt(toks, i + 1);
      if (phpIsWord(n.v) && !PHP_NOT_CLASS.has(n.v.toLowerCase())) refs.push({ name: phpLast(n.v), line: n.line });
      continue;
    }

    if (phpIsWord(v) && phpAt(toks, i + 1).v === '(' && prev !== 'new') {
      const member = prev === '->' || prev === '?->';
      const isStatic = prev === '::';
      if (isStatic) {
        const cls = phpAt(toks, i - 2);
        if (phpIsWord(cls.v) && !PHP_NOT_CLASS.has(cls.v.toLowerCase())) refs.push({ name: phpLast(cls.v), line: cls.line });
      }
      if (member || isStatic || !PHP_KEYWORDS.has(lower)) refs.push({ name: phpLast(v), line });
    }
  }
  return { symbols, imports, refs, extends: extendsList };
}

// Files are indexed once per list: a build resolves thousands of imports against the same array.
function phpIndex(files) {
  let idx = PHP_INDEX.get(files);
  if (!idx) {
    const byBase = new Map();
    for (const f of files) {
      const base = f.slice(f.lastIndexOf('/') + 1);
      if (!byBase.has(base)) byBase.set(base, []);
      byBase.get(base).push(f);
    }
    idx = { set: new Set(files), byBase };
    PHP_INDEX.set(files, idx);
  }
  return idx;
}

function phpNormalize(path) {
  const out = [];
  for (const seg of path.split('/')) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') out.pop();
    else out.push(seg);
  }
  return out.join('/');
}

// Namespaces map to paths with PSR-4 guesses: the full path under src/ or the repo root, then a file whose path
// ends with the name, dropping at most the first segment (the vendor or root namespace that the tree does not repeat).
function phpResolve(spec, fromPath, files) {
  const idx = phpIndex(files);
  if (spec.includes('/') || /\.php$/i.test(spec)) {
    const dir = fromPath.slice(0, fromPath.lastIndexOf('/') + 1);
    const p = phpNormalize(spec.startsWith('/') ? spec : dir + spec);
    return idx.set.has(p) ? p : null;
  }
  const segs = spec.split('\\').filter(Boolean);
  for (let k = 0; k < Math.min(segs.length, 2); k++) {
    const sub = segs.slice(k).join('/') + '.php';
    for (const cand of [`src/${sub}`, sub]) if (idx.set.has(cand)) return cand;
    const hit = (idx.byBase.get(sub.slice(sub.lastIndexOf('/') + 1)) || []).find((f) => f.endsWith(`/${sub}`));
    if (hit) return hit;
  }
  return null;
}

export const phpLang = {
  id: 'php',
  exts: ['.php'],
  extract(text) {
    return phpParse(text);
  },
  resolve: phpResolve,
};
