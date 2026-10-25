// Rust: fns, types, traits, enums, consts, statics and modules; impl and trait members as Type.name;
// use and mod declarations as imports; call refs; and trait impls as extends. Comments (nested block
// comments included), strings, raw strings and char literals are blanked first, so a commented-out fn or
// a string such as "struct Fake" never becomes a symbol.

// Keywords and std constructors: a call to one of these never names a repo symbol.
const RS_SKIP = new Set([
  'Err', 'Ok', 'Self', 'Some', 'as', 'async', 'await', 'break', 'const', 'continue', 'crate', 'dyn', 'else',
  'enum', 'extern', 'false', 'fn', 'for', 'if', 'impl', 'in', 'let', 'loop', 'match', 'mod', 'move', 'mut',
  'pub', 'ref', 'return', 'self', 'static', 'struct', 'super', 'trait', 'true', 'type', 'unsafe', 'use', 'where',
  'while',
]);

// Built once per file list: resolve runs once per import over the same list.
const rsSetMemo = new WeakMap();

const RS_KIND = { fn: 'fn', struct: 'type', enum: 'enum', trait: 'type', type: 'type', const: 'const', static: 'var' };

const RS_CALL = /(?<!\w)((?:[A-Za-z_]\w*\s*::\s*)*)([A-Za-z_]\w*)\s*\(/g;
const RS_MACRO = /(?<!\w)([A-Za-z_]\w*)\s*!\s*[([{]/g;
const RS_DECL = /(\bfn\s+)([A-Za-z_]\w*)/;
const RS_HEAD = /^(pub(?:\s*\([^)]*\))?\s+)?(?:(?:const|async|unsafe|default|extern(?:\s*"")?)\s+)*(fn|struct|enum|trait|type|const|static|mod|impl)\b(.*)$/;
const RS_USE = /^(?:pub(?:\s*\([^)]*\))?\s+)?use\s+/;
const RS_RAW = /(?:b|c)?r(#*)"/y;
const RS_CHAR = /'(?:\\(?:u\{[0-9a-fA-F_]*\}|x[0-9a-fA-F]{2}|[^\n])|[\uD800-\uDBFF][\uDC00-\uDFFF]|[^'\\\n])'/y;

function rsBlank(s) {
  return s.replace(/[^\n]/g, ' ');
}

function rsBlockEnd(text, i) {
  let depth = 0;
  let j = i;
  while (j < text.length) {
    if (text[j] === '/' && text[j + 1] === '*') {
      depth++;
      j += 2;
    } else if (text[j] === '*' && text[j + 1] === '/') {
      depth--;
      j += 2;
      if (depth === 0) return j;
    } else {
      j++;
    }
  }
  return text.length;
}

// One lexical unit at i: the text to keep in the code view and where it ends. Anything that is not a
// comment, string or char literal is one character, so a lifetime such as 'a passes through.
function rsSpan(text, i) {
  const c = text[i];
  const next = text[i + 1];
  if (c === '/' && next === '/') {
    const eol = text.indexOf('\n', i);
    const end = eol < 0 ? text.length : eol;
    return { end, out: rsBlank(text.slice(i, end)) };
  }
  if (c === '/' && next === '*') {
    const end = rsBlockEnd(text, i);
    return { end, out: rsBlank(text.slice(i, end)) };
  }
  if (c === '"') {
    let j = i + 1;
    while (j < text.length && text[j] !== '"') j += text[j] === '\\' ? 2 : 1;
    const closed = j < text.length;
    const body = text.slice(i + 1, closed ? j : text.length);
    return { end: closed ? j + 1 : text.length, out: `"${rsBlank(body)}${closed ? '"' : ''}` };
  }
  if (c === 'r' || c === 'b' || c === 'c') {
    RS_RAW.lastIndex = i;
    const m = RS_RAW.exec(text);
    if (m && !/\w/.test(text[i - 1] ?? '')) {
      const bodyStart = i + m[0].length;
      const close = `"${m[1]}`;
      const at = text.indexOf(close, bodyStart);
      const bodyEnd = at < 0 ? text.length : at;
      return {
        end: at < 0 ? text.length : at + close.length,
        out: m[0] + rsBlank(text.slice(bodyStart, bodyEnd)) + (at < 0 ? '' : close),
      };
    }
  }
  if (c === "'") {
    RS_CHAR.lastIndex = i;
    const m = RS_CHAR.exec(text);
    if (m) return { end: i + m[0].length, out: `'${rsBlank(m[0].slice(1, -1))}'` };
  }
  return { end: i + 1, out: c };
}

function rsLex(text) {
  let code = '';
  for (let i = 0; i < text.length; ) {
    const span = rsSpan(text, i);
    code += span.out;
    i = span.end;
  }
  return code.split('\n');
}

function rsDepthDelta(line) {
  let d = 0;
  for (const ch of line) {
    if (ch === '{' || ch === '(' || ch === '[') d++;
    else if (ch === '}' || ch === ')' || ch === ']') d--;
  }
  return d;
}

function rsHead(line) {
  const m = RS_HEAD.exec(line.trim());
  return m ? { isPub: m[1] !== undefined, kw: m[2], rest: m[3] } : null;
}

function rsName(kw, rest) {
  const re = kw === 'static' ? /^\s+(?:mut\s+)?([A-Za-z_]\w*)/ : /^\s+([A-Za-z_]\w*)/;
  const m = re.exec(rest);
  return m ? m[1] : null;
}

// The text from the line at i up to the first line that matches stop, joined on one line, and that line's
// index. Headers and use lists can run over several lines; the cap keeps a file with no closing token from
// scanning on.
function rsGather(code, i, stop) {
  let text = '';
  let j = i;
  for (; j < code.length && j < i + 100; j++) {
    text += ` ${code[j]}`;
    if (stop.test(code[j])) break;
  }
  return { text, last: j };
}

function rsJoinPath(a, b) {
  return a && b ? `${a}::${b}` : a || b;
}

function rsLast(path) {
  const k = path.lastIndexOf('::');
  return k < 0 ? path : path.slice(k + 2);
}

function rsSplitTop(s) {
  const parts = [];
  let depth = 0;
  let cur = '';
  for (const ch of s) {
    if (ch === '{') depth++;
    else if (ch === '}') depth--;
    if (ch === ',' && depth === 0) {
      parts.push(cur);
      cur = '';
    } else {
      cur += ch;
    }
  }
  parts.push(cur);
  return parts;
}

// Brace lists expand one level per call; a leaf names its local binding (the alias when there is one).
// self names the prefix module itself, and a glob binds names the extractor cannot list.
function rsUseEntries(prefix, body, at, imports) {
  for (const part of rsSplitTop(body)) {
    const item = part.trim();
    const open = item.indexOf('{');
    if (open >= 0) {
      const head = item.slice(0, open).replace(/::\s*$/, '').trim();
      rsUseEntries(rsJoinPath(prefix, head), item.slice(open + 1, item.lastIndexOf('}')), at, imports);
    } else if (item) {
      const alias = /^(.+?)\s+as\s+(\w+)$/.exec(item);
      const path = alias ? alias[1] : item;
      if (path === '*' || path.endsWith('::*')) {
        imports.push({ spec: rsJoinPath(prefix, path.slice(0, Math.max(0, path.length - 3))), line: at });
        continue;
      }
      const spec = path === 'self' ? prefix : rsJoinPath(prefix, path);
      const name = alias ? alias[2] : rsLast(spec);
      const entry = { spec, line: at };
      if (name !== '_') entry.names = [name];
      imports.push(entry);
    }
  }
}

function rsUse(code, i, at, imports) {
  const full = rsGather(code, i, /;/).text.trimStart().replace(RS_USE, '');
  const semi = full.indexOf(';');
  rsUseEntries('', semi < 0 ? full : full.slice(0, semi), at, imports);
}

// Skips one balanced <...> group at the start of text.
function rsSkipAngles(text) {
  if (!text.startsWith('<')) return text;
  let depth = 0;
  for (let k = 0; k < text.length; k++) {
    if (text[k] === '<') depth++;
    else if (text[k] === '>' && --depth === 0) return text.slice(k + 1);
  }
  return '';
}

// The last identifier of a type path, with generic arguments and lifetimes dropped:
// fmt::Display, &'a mut Foo<T> and Vec<T> name Display, Foo and Vec.
function rsTypeName(text) {
  let flat = '';
  let depth = 0;
  for (const ch of text) {
    if (ch === '<') depth++;
    else if (ch === '>') depth = Math.max(0, depth - 1);
    else if (depth === 0) flat += ch;
  }
  const names = flat.replace(/'\w+/g, ' ').match(/[A-Za-z_]\w*/g);
  return names ? names[names.length - 1] : '';
}

// An impl header: 'Trait for Type' gives the trait as the base. Where clauses are not part of either.
function rsImplHeader(text) {
  const s = rsSkipAngles(text.trimStart());
  const cut = s.search(/\bwhere\b/);
  const head = cut < 0 ? s : s.slice(0, cut);
  const f = /\bfor\b/.exec(head);
  if (!f) return { type: rsTypeName(head), trait: '' };
  return { type: rsTypeName(head.slice(f.index + 3)), trait: rsTypeName(head.slice(0, f.index)) };
}

// Module-level items. An inline mod body and its items are left out: test modules would fill the map
// with helpers, and the API a repo exposes sits at the top of its files. An item that opens a body returns
// the body and the line its { sits on, since a header can run over several lines.
function rsItem(code, i, head, out) {
  const at = i + 1;
  const name = head.kw === 'impl' ? null : rsName(head.kw, head.rest);
  if (head.kw !== 'impl' && (!name || name === '_')) return null;
  const { text: full, last } = rsGather(code, i, /[{;]/);
  const stop = full.search(/[{;]/);
  const opens = stop >= 0 && full[stop] === '{';
  if (head.kw === 'impl') {
    if (!opens) return null;
    const { type, trait } = rsImplHeader(full.slice(full.search(/\bimpl\b/) + 4, stop));
    if (trait && type) out.extends.push({ name: type, base: trait, line: at });
    return { line: last, body: { kind: 'impl', name: type } };
  }
  if (head.kw === 'mod') {
    out.symbols.push({ name, kind: 'module', line: at, exported: head.isPub });
    if (stop >= 0 && full[stop] === ';') out.imports.push({ spec: name, line: at, names: [name] });
    return opens ? { line: last, body: { kind: 'mod' } } : null;
  }
  out.symbols.push({ name, kind: RS_KIND[head.kw], line: at, exported: head.isPub });
  return head.kw === 'trait' && opens ? { line: last, body: { kind: 'trait', name, exported: head.isPub } } : null;
}

// Direct lines of an impl or trait body: its fns are methods, its consts are Type.NAME consts.
function rsMember(at, top, head, out) {
  if (!top.name || (head.kw !== 'fn' && head.kw !== 'const')) return;
  const name = rsName(head.kw, head.rest);
  if (!name) return;
  const exported = top.kind === 'trait' ? top.exported : head.isPub;
  out.symbols.push({
    name: `${top.name}.${name}`,
    kind: head.kw === 'fn' ? 'method' : 'const',
    line: at,
    exported,
  });
}

// Calls, macro calls, and the owner of a path call (Name::new( gives new and Name). A declared fn name is
// not a call, so it is blanked first.
function rsCalls(line, at, refs) {
  const scan = line.replace(RS_DECL, (_, kw, name) => kw + ' '.repeat(name.length));
  const seen = new Set();
  const add = (name) => {
    if (!name || RS_SKIP.has(name) || seen.has(name)) return;
    seen.add(name);
    refs.push({ name, line: at });
  };
  for (const m of scan.matchAll(RS_CALL)) {
    add(m[2]);
    add(m[1].split('::').map((s) => s.trim()).filter(Boolean).pop());
  }
  for (const m of scan.matchAll(RS_MACRO)) add(m[1]);
}

function rsDirname(p) {
  const k = p.lastIndexOf('/');
  return k < 0 ? '' : p.slice(0, k);
}

function rsJoin(...parts) {
  return parts.filter(Boolean).join('/');
}

function rsFileSet(files) {
  let set = rsSetMemo.get(files);
  if (!set) {
    set = new Set(files);
    rsSetMemo.set(files, set);
  }
  return set;
}

// The src directory above fromPath: the nearest ancestor that holds a lib.rs or main.rs.
function rsCrateRoot(fromPath, set) {
  for (let dir = rsDirname(fromPath); ; dir = rsDirname(dir)) {
    if (set.has(rsJoin(dir, 'lib.rs')) || set.has(rsJoin(dir, 'main.rs'))) return dir;
    if (dir === '') break;
  }
  return 'src';
}

// The directory holding the modules declared inside fromPath: a file x.rs owns x/, a mod.rs or crate
// root owns its own directory.
function rsSelfDir(fromPath) {
  const file = fromPath.slice(fromPath.lastIndexOf('/') + 1);
  const dir = rsDirname(fromPath);
  if (file === 'mod.rs' || file === 'lib.rs' || file === 'main.rs') return dir;
  return rsJoin(dir, file.replace(/\.rs$/, ''));
}

// The file of a module at stem: stem.rs or stem/mod.rs. A crate root (reached by crate:: or super::
// with no more segments) is lib.rs or main.rs in stem.
function rsModuleAt(stem, isRoot, set) {
  const hits = stem ? [`${stem}.rs`, `${stem}/mod.rs`] : [];
  if (isRoot) hits.push(rsJoin(stem, 'lib.rs'), rsJoin(stem, 'main.rs'));
  return hits.find((f) => set.has(f)) ?? null;
}

export const rustLang = {
  id: 'rust',
  exts: ['.rs'],
  extract(text) {
    const code = rsLex(text);
    const out = { symbols: [], imports: [], refs: [], extends: [] };
    // stack holds the open impl, trait and mod bodies. A body opens one level deeper than the line its {
    // sits on, and its members sit at that level. opening maps a line index to a body that opens there.
    const stack = [];
    const opening = new Map();
    let depth = 0;
    for (let i = 0; i < code.length; i++) {
      const line = code[i];
      const at = i + 1;
      const d0 = depth;
      depth = Math.max(0, d0 + rsDepthDelta(line));
      if (opening.has(i)) {
        stack.push({ ...opening.get(i), depth: d0 + 1 });
        opening.delete(i);
      }
      const top = stack[stack.length - 1];
      if (!/^\s*#!?\[/.test(line)) rsCalls(line, at, out.refs);
      if (!top && d0 === 0) {
        if (RS_USE.test(line.trim())) rsUse(code, i, at, out.imports);
        else {
          const head = rsHead(line);
          const opened = head ? rsItem(code, i, head, out) : null;
          if (opened?.line === i) stack.push({ ...opened.body, depth: d0 + 1 });
          else if (opened) opening.set(opened.line, opened.body);
        }
      } else if (top && top.kind !== 'mod' && d0 === top.depth) {
        const head = rsHead(line);
        if (head) rsMember(at, top, head, out);
      }
      while (stack.length && depth < stack[stack.length - 1].depth) stack.pop();
    }
    return out;
  },
  // A use path or mod name resolves through crate::, self::, super:: or a bare name. A bare name is first
  // looked up beside fromPath, then at the crate root (edition 2015 paths). Anything else is an external crate.
  resolve(spec, fromPath, files) {
    const set = rsFileSet(files);
    const segs = spec.split('::').filter(Boolean);
    if (segs.length === 0) return null;
    const srcRoot = rsCrateRoot(fromPath, set);
    // Only crate:: and super:: may name the root file itself; a bare or self:: path must go through a module.
    const rootOk = segs[0] === 'crate' || segs[0] === 'super';
    let bases = [rsSelfDir(fromPath), srcRoot];
    let tail = segs;
    if (segs[0] === 'crate') {
      bases = [srcRoot];
      tail = segs.slice(1);
    } else if (segs[0] === 'self' || segs[0] === 'super') {
      let base = rsSelfDir(fromPath);
      while (tail[0] === 'self' || tail[0] === 'super') {
        if (tail[0] === 'super') {
          if (base === srcRoot) return null;
          base = rsDirname(base);
        }
        tail = tail.slice(1);
      }
      bases = [base];
    }
    // The longest module path wins: use a::b::Item finds a/b.rs before a.rs. A path that ends in an
    // item of the base module (k = 0) only counts after crate:: or super::.
    const lowest = rootOk ? 0 : 1;
    for (const base of bases) {
      for (let k = tail.length; k >= lowest; k--) {
        const found = rsModuleAt(rsJoin(base, tail.slice(0, k).join('/')), k === 0, set);
        if (found) return found;
      }
    }
    return null;
  },
};
