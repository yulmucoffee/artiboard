// C and C++: symbols, includes, references and bases. Comments, strings and char literals are blanked first.
// Directives come from the original text, because an include's path sits in quotes that the code view blanks.
// Declarations are read from the tokens that end at a brace, so a function header may run over several lines.

const C_SKIP = /\/\*[\s\S]*?(?:\*\/|$)|\/\/[^\n]*|R"([^(\s\\]*)\([\s\S]*?\)\1"|"(?:[^"\\\n]|\\[\s\S])*"|(?<!\w)'(?:[^'\\\n]|\\[\s\S])*'/g;
const C_TOKEN = /[A-Za-z_]\w*|\d[\w.']*|"[^"\n]*"|'[^'\n]*'|::|->|\S/g;
const C_NOT_NAME = new Set(['if', 'else', 'while', 'for', 'do', 'switch', 'case', 'return', 'sizeof', 'catch', 'throw', 'new', 'delete', 'defined', 'typeof', 'alignof', 'decltype', 'static_assert', 'noexcept', '__attribute__', '__declspec', 'operator', 'template', 'typename', 'typedef', 'struct', 'union', 'enum', 'class', 'int', 'char', 'void', 'float', 'double', 'long', 'short', 'unsigned', 'signed', 'bool', 'auto', 'const', 'volatile', 'static', 'inline', 'extern', 'static_cast', 'dynamic_cast', 'reinterpret_cast', 'const_cast']);
const C_MODS = new Set(['static', 'inline', 'extern', 'virtual', 'explicit', 'constexpr', 'const', 'volatile', 'friend', '__inline', '__forceinline']);
const C_AFTER_PARAMS = new Set(['const', 'volatile', 'noexcept', 'override', 'final', 'throw', '->', ':', '__attribute__']);
const C_ACCESS = new Set(['public', 'private', 'protected', 'virtual']);
const C_INDEX = new WeakMap();

function cBlank(s) {
  return s.replace(/[^\n]/g, ' ');
}

function cIdent(v) {
  return typeof v === 'string' && /^[A-Za-z_]\w*$/.test(v);
}

function cHas(head, v) {
  return head.some((t) => t.v === v);
}

// Strings and char literals keep their quotes so a literal still reads as one token.
function cStrip(text) {
  const orig = text.replace(/\r\n?/g, '\n');
  const code = orig.replace(C_SKIP, (m) => (m[0] === '"' || m[0] === "'" ? m[0] + cBlank(m.slice(1, -1)) + m[0] : cBlank(m))).split('\n');
  const origLines = orig.split('\n');
  const directives = [];
  for (let k = 0; k < code.length; k++) {
    if (!/^\s*#/.test(code[k])) continue;
    let end = k;
    while (end + 1 < code.length && code[end].endsWith('\\')) end++;
    directives.push({ line: k + 1, text: origLines.slice(k, end + 1).join('\n') });
    for (let j = k; j <= end; j++) code[j] = cBlank(code[j]);
    k = end;
  }
  return { code: code.join('\n'), directives };
}

function cTokens(code) {
  const toks = [];
  let line = 1;
  let at = 0;
  for (const m of code.matchAll(C_TOKEN)) {
    for (; at < m.index; at++) if (code.charCodeAt(at) === 10) line++;
    toks.push({ v: m[0], line });
  }
  return toks;
}

// A function header: `ret name(params)` with an optional `Class::` qualifier, then the body's brace. A constructor
// may have no return type, but only inside its own class. A bare `name(...) {` elsewhere is a macro, not a function.
function cFunc(head, scope) {
  const p = head.findIndex((t) => t.v === '(');
  if (p < 1 || !cIdent(head[p - 1].v) || C_NOT_NAME.has(head[p - 1].v)) return null;
  const name = head[p - 1];
  const prefix = head.slice(0, p - 1);
  const last = prefix[prefix.length - 1];
  let qualifier = null;
  if (last && last.v === '::' && prefix.length >= 2 && cIdent(prefix[prefix.length - 2].v)) qualifier = prefix[prefix.length - 2].v;
  else if (!prefix.some((t) => cIdent(t.v) && !C_MODS.has(t.v)) && !(scope.kind === 'class' && name.v === scope.name)) return null;
  let depth = 0;
  let close = -1;
  for (let k = p; k < head.length && close < 0; k++) {
    if (head[k].v === '(') depth++;
    else if (head[k].v === ')' && --depth === 0) close = k;
  }
  if (close < 0) return null;
  const rest = head[close + 1];
  if (rest && !C_AFTER_PARAMS.has(rest.v)) return null;
  return { name: name.v, qualifier, line: name.line };
}

function cTypeKeyword(head) {
  let angle = 0;
  for (let k = 0; k < head.length; k++) {
    const v = head[k].v;
    if (v === '<') angle++;
    else if (v === '>') angle--;
    else if (angle === 0 && (v === 'struct' || v === 'class' || v === 'union' || v === 'enum')) return k;
  }
  return -1;
}

// struct, class, union and enum definitions. `template <class T> class Box` skips the template's own `class`.
function cType(head) {
  const k = cTypeKeyword(head);
  if (k < 0) return null;
  const word = head[k].v;
  let j = k + 1;
  if (word === 'enum' && (head[j]?.v === 'class' || head[j]?.v === 'struct')) j++;
  const nameTok = head[j];
  const kind = word === 'enum' ? 'enum' : word === 'class' ? 'class' : 'type';
  const body = word === 'struct' || word === 'class' ? 'class' : 'body';
  const bases = [];
  const colon = head.findIndex((t, idx) => idx > j && t.v === ':');
  if (body === 'class' && colon > 0) {
    let group = [];
    for (const t of [...head.slice(colon + 1), { v: ',', line: 0 }]) {
      if (t.v !== ',') {
        group.push(t);
        continue;
      }
      const upTo = group.findIndex((g) => g.v === '<');
      const names = (upTo < 0 ? group : group.slice(0, upTo)).filter((g) => cIdent(g.v) && !C_ACCESS.has(g.v));
      if (names.length) bases.push({ name: names[names.length - 1].v, line: names[names.length - 1].line });
      group = [];
    }
  }
  return { kind, body, name: cIdent(nameTok?.v) ? nameTok.v : null, line: nameTok ? nameTok.line : 0, bases };
}

// Decides what a `{` opens and whether the statement it came from continues after its `}`.
function cOpen(head, top, symbols, extendsList, refs) {
  if (top.kind === 'body') return { kind: 'body', keep: cHas(head, '=') };
  if (head[0] && (head[0].v === 'namespace' || (head[0].v === 'extern' && head[1] && head[1].v[0] === '"'))) return { kind: 'ns', keep: false };
  const fn = cFunc(head, top);
  if (fn) {
    const method = fn.qualifier !== null || top.kind === 'class';
    if (method) symbols.push({ name: `${fn.qualifier ?? top.name}.${fn.name}`, kind: 'method', line: fn.line, exported: true });
    else symbols.push({ name: fn.name, kind: 'fn', line: fn.line, exported: !cHas(head, 'static') });
    return { kind: 'body', keep: false };
  }
  const type = cType(head);
  if (!type) return { kind: 'body', keep: cHas(head, 'typedef') || cHas(head, '=') };
  if ((top.kind === 'file' || top.kind === 'ns') && type.name) {
    symbols.push({ name: type.name, kind: type.kind, line: type.line, exported: true });
    for (const b of type.bases) {
      extendsList.push({ name: type.name, base: b.name, line: b.line });
      refs.push({ name: b.name, line: b.line });
    }
    if (type.body === 'class') return { kind: 'class', name: type.name, keep: true };
  }
  return { kind: 'body', keep: true };
}

// `typedef T name;`, `typedef R (*name)(args);` and `typedef struct X {...} name;`. Braces are skipped so the
// body's members never name the typedef.
function cTypedef(toks, s, i, symbols) {
  const flat = [];
  let depth = 0;
  for (let k = s; k < i; k++) {
    const v = toks[k].v;
    if (v === '{') depth++;
    else if (v === '}') depth--;
    else if (depth === 0) flat.push(toks[k]);
  }
  if (!flat.length || flat[0].v !== 'typedef') return;
  const rest = flat.slice(1);
  const p = rest.findIndex((t) => t.v === '(');
  let name = null;
  if (p >= 0) {
    if (rest[p + 1]?.v === '*' && cIdent(rest[p + 2]?.v)) name = rest[p + 2];
    else if (p >= 1 && cIdent(rest[p - 1].v)) name = rest[p - 1];
  } else {
    for (let k = rest.length - 1; k >= 0 && !name; k--) if (cIdent(rest[k].v) && !C_NOT_NAME.has(rest[k].v)) name = rest[k];
  }
  if (name) symbols.push({ name: name.v, kind: 'type', line: name.line, exported: true });
}

// Calls and `new T` inside a body. A declaration like `Queue q(argc);` reads as a call; the grammar cannot tell.
function cRefs(toks, i, refs) {
  const t = toks[i];
  const next = toks[i + 1];
  const prev = i > 0 ? toks[i - 1].v : '';
  if (!cIdent(t.v)) return;
  if (t.v === 'new') {
    if (cIdent(next?.v) && !C_NOT_NAME.has(next.v)) refs.push({ name: next.v, line: next.line });
    return;
  }
  if (next?.v === '(' && !C_NOT_NAME.has(t.v) && prev !== 'new') refs.push({ name: t.v, line: t.line });
}

function cParse(text) {
  const src = cStrip(text);
  const toks = cTokens(src.code);
  const symbols = [];
  const imports = [];
  const refs = [];
  const extendsList = [];
  for (const d of src.directives) {
    const inc = /^\s*#\s*include\s*(?:"([^"]*)"|<([^>]*)>)/.exec(d.text);
    if (inc) imports.push({ spec: inc[1] ?? inc[2], line: d.line, names: [] });
    // Function-like macros are not constants; only `#define NAME` counts.
    const def = /^\s*#\s*define\s+([A-Za-z_]\w*)(\(?)/.exec(d.text);
    if (def && !def[2]) symbols.push({ name: def[1], kind: 'const', line: d.line, exported: true });
  }
  const stack = [{ kind: 'file', keep: false, outer: 0 }];
  let s = 0;
  for (let i = 0; i < toks.length; i++) {
    const top = stack[stack.length - 1];
    const v = toks[i].v;
    if (v === '{') {
      const entry = cOpen(toks.slice(s, i), top, symbols, extendsList, refs);
      entry.outer = s;
      stack.push(entry);
      s = i + 1;
    } else if (v === '}') {
      const closed = stack.length > 1 ? stack.pop() : null;
      s = closed && closed.keep ? closed.outer : i + 1;
    } else if (v === ';') {
      if (top.kind !== 'body') cTypedef(toks, s, i, symbols);
      s = i + 1;
    } else if (top.kind === 'body') {
      cRefs(toks, i, refs);
    }
  }
  symbols.sort((a, b) => a.line - b.line);
  return { symbols, imports, refs, extends: extendsList };
}

function cIndex(files) {
  let idx = C_INDEX.get(files);
  if (!idx) {
    const byBase = new Map();
    for (const f of files) {
      const base = f.slice(f.lastIndexOf('/') + 1);
      if (!byBase.has(base)) byBase.set(base, []);
      byBase.get(base).push(f);
    }
    idx = { set: new Set(files), byBase };
    C_INDEX.set(files, idx);
  }
  return idx;
}

function cNormalize(path) {
  const out = [];
  for (const seg of path.split('/')) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') out.pop();
    else out.push(seg);
  }
  return out.join('/');
}

// The spec does not say whether the include used quotes or brackets. Quoted includes are tried first from the
// including directory; either form then matches a repo file whose path ends with the spec.
function cResolve(spec, fromPath, files) {
  const idx = cIndex(files);
  const dir = fromPath.slice(0, fromPath.lastIndexOf('/') + 1);
  const rel = cNormalize(dir + spec);
  if (idx.set.has(rel)) return rel;
  const base = spec.slice(spec.lastIndexOf('/') + 1);
  return (idx.byBase.get(base) || []).find((f) => f === spec || f.endsWith(`/${spec}`)) ?? null;
}

export const cLang = {
  id: 'c',
  exts: ['.c', '.h', '.cc', '.cpp', '.cxx', '.hh', '.hpp', '.hxx'],
  extract(text) {
    return cParse(text);
  },
  resolve: cResolve,
};
