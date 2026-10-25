// Go: funcs, methods, types, vars and consts; import specs; call refs; and embedding, meaning a struct or
// interface line that is just a type name. Comments and string contents are blanked before any rule runs,
// so a commented-out func or a string such as "func fake" never becomes a symbol.

// Built once per file list: resolve runs once per import over the same list.
const goDirMemo = new WeakMap();

// Keywords and predeclared names: a call to one of these is never a repo symbol.
const GO_SKIP = new Set([
  'append', 'any', 'bool', 'break', 'byte', 'cap', 'case', 'chan', 'clear', 'close', 'complex', 'complex64',
  'complex128', 'const', 'continue', 'copy', 'default', 'defer', 'delete', 'else', 'error', 'fallthrough',
  'float32', 'float64', 'for', 'func', 'go', 'goto', 'if', 'imag', 'import', 'int', 'int8', 'int16', 'int32',
  'int64', 'interface', 'len', 'make', 'map', 'max', 'min', 'new', 'package', 'panic', 'print', 'println',
  'range', 'real', 'recover', 'return', 'rune', 'select', 'string', 'struct', 'switch', 'type', 'uint', 'uint8',
  'uint16', 'uint32', 'uint64', 'uintptr', 'var',
]);

const GO_CALL = /(?<!\w)([A-Za-z_]\w*)\s*\(/g;
const GO_LITERAL = /(?<!\w)([A-Z]\w*)\{/g;
const GO_FUNC_NAME = /^(\s*func\s*(?:\([^)]*\)\s*)?)([A-Za-z_]\w*)/;
const GO_FUNC = /^func\s+([A-Za-z_]\w*)\s*[([]/;
const GO_METHOD = /^func\s*\(\s*(?:[A-Za-z_]\w*\s+)?\*?\s*([A-Za-z_]\w*)\s*(?:\[[^\]]*\])?\s*\)\s*([A-Za-z_]\w*)\s*\(/;
const GO_TYPE_NAME = /^\s*([A-Za-z_]\w*)/;
const GO_TYPE_BODY = /^\s*[A-Za-z_]\w*(?:\s*\[[^\]]*\])?\s*=?\s*(?:struct|interface)\s*\{/;
const GO_SPEC_NAMES = /^\s*([A-Za-z_]\w*(?:\s*,\s*[A-Za-z_]\w*)*)/;
const GO_IMPORT = /^\s*(?:(\.|_|[A-Za-z_]\w*)\s+)?"([^"]*)"/;
const GO_EMBED = /^\s*\*?\s*(?:[A-Za-z_]\w*\.)?([A-Za-z_]\w*)\s*(?:\[[^\]]*\])?\s*(?:`[^`]*`)?\s*$/;

function goBlank(s) {
  return s.replace(/[^\n]/g, ' ');
}

// Where a quoted literal starting at start ends. An unterminated quote ends at its line, so bad input
// cannot blank the rest of the file. Raw (backquoted) strings run to the next backquote.
function goLiteralEnd(text, start) {
  const q = text[start];
  for (let j = start + 1; j < text.length; j++) {
    const ch = text[j];
    if (ch === q) return { end: j + 1, closed: true };
    if (q === '`') continue;
    if (ch === '\n') return { end: j, closed: false };
    if (ch === '\\' && text[j + 1] !== '\n') j++;
  }
  return { end: text.length, closed: false };
}

// Two views of the same lines: code has comments and string contents blanked (for structure and names),
// keep has only the comments blanked (for the path in an import spec).
function goLex(text) {
  let code = '';
  let keep = '';
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    const next = text[i + 1];
    let end = i + 1;
    if (c === '/' && next === '/') {
      end = text.indexOf('\n', i);
      if (end < 0) end = text.length;
      code += goBlank(text.slice(i, end));
      keep += goBlank(text.slice(i, end));
    } else if (c === '/' && next === '*') {
      const close = text.indexOf('*/', i + 2);
      end = close < 0 ? text.length : close + 2;
      code += goBlank(text.slice(i, end));
      keep += goBlank(text.slice(i, end));
    } else if (c === '"' || c === "'" || c === '`') {
      const lit = goLiteralEnd(text, i);
      end = lit.end;
      code += c + goBlank(text.slice(i + 1, lit.closed ? end - 1 : end)) + (lit.closed ? c : '');
      keep += text.slice(i, end);
    } else {
      code += c;
      keep += c;
    }
    i = end;
  }
  return { code: code.split('\n'), keep: keep.split('\n') };
}

// Brackets opened minus closed on one line. Lines inside a ( ) or { } block sit deeper than the block's head.
function goDepthDelta(line) {
  let d = 0;
  for (const ch of line) {
    if (ch === '{' || ch === '(' || ch === '[') d++;
    else if (ch === '}' || ch === ')' || ch === ']') d--;
  }
  return d;
}

function goExported(name) {
  return /^[A-Z]/.test(name);
}

function goSpecNames(text) {
  const m = GO_SPEC_NAMES.exec(text);
  return m ? m[1].split(',').map((n) => n.trim()) : [];
}

// Adds one symbol per name for var and const, and one for a type. Returns the body of a struct or
// interface type, so the caller can read its fields.
function goSpec(kind, text, at, d0, out) {
  if (kind !== 'type') {
    for (const name of goSpecNames(text)) {
      if (name !== '_') out.symbols.push({ name, kind, line: at, exported: goExported(name) });
    }
    return null;
  }
  const m = GO_TYPE_NAME.exec(text);
  if (!m) return null;
  out.symbols.push({ name: m[1], kind: 'type', line: at, exported: goExported(m[1]) });
  return GO_TYPE_BODY.test(text) ? { name: m[1], depth: d0 + 1 } : null;
}

function goFunc(text, at, symbols) {
  const method = GO_METHOD.exec(text);
  if (method) {
    symbols.push({ name: `${method[1]}.${method[2]}`, kind: 'method', line: at, exported: goExported(method[2]) });
    return;
  }
  const fn = GO_FUNC.exec(text);
  if (fn) symbols.push({ name: fn[1], kind: 'fn', line: at, exported: goExported(fn[1]) });
}

// The text after the keyword is an import path, optionally with an alias. A blank or dot import binds no
// name the file can call, so it gets no names.
function goImport(text, at, imports) {
  const m = GO_IMPORT.exec(text);
  if (!m) return;
  const [, alias, spec] = m;
  const entry = { spec, line: at };
  if (alias !== '_' && alias !== '.') entry.names = [alias ?? spec.slice(spec.lastIndexOf('/') + 1)];
  imports.push(entry);
}

// Calls and composite literals of exported types. The name a func declares is not a call, so it is
// blanked first.
function goCalls(line, at, refs) {
  const scan = line.replace(GO_FUNC_NAME, (_, head, name) => head + ' '.repeat(name.length));
  const seen = new Set();
  const add = (name) => {
    if (GO_SKIP.has(name) || seen.has(name)) return;
    seen.add(name);
    refs.push({ name, line: at });
  };
  for (const m of scan.matchAll(GO_CALL)) add(m[1]);
  for (const m of scan.matchAll(GO_LITERAL)) add(m[1]);
}

export const goLang = {
  id: 'go',
  exts: ['.go'],
  extract(text) {
    const { code, keep } = goLex(text);
    const out = { symbols: [], imports: [], refs: [], extends: [] };
    // group is the keyword of an open top-level ( ) block. body is an open struct or interface type; its
    // direct lines are fields, methods or embedded types, so they are not calls.
    let depth = 0;
    let group = null;
    let body = null;
    for (let i = 0; i < code.length; i++) {
      const line = code[i];
      const at = i + 1;
      const d0 = depth;
      depth = Math.max(0, d0 + goDepthDelta(line));
      if (body && d0 === body.depth) {
        const m = GO_EMBED.exec(line);
        if (m) out.extends.push({ name: body.name, base: m[1], line: at });
      } else {
        goCalls(line, at, out.refs);
        if (!body && group && d0 === 1) {
          if (group === 'import') goImport(keep[i], at, out.imports);
          else body = goSpec(group, line.trim(), at, d0, out) ?? body;
        } else if (!body && !group && d0 === 0) {
          const t = line.trim();
          const open = /^(var|const|type|import)\s*\(/.exec(t);
          const decl = /^(var|const|type)\b(.*)$/.exec(t);
          if (open) group = open[1];
          else if (/^import\b/.test(t)) goImport(keep[i].replace(/^\s*import\b/, ''), at, out.imports);
          else if (/^func\b/.test(t)) goFunc(t, at, out.symbols);
          else if (decl) body = goSpec(decl[1], decl[2], at, d0, out) ?? body;
        }
      }
      if (body && depth < body.depth) body = null;
      if (group && depth < 1) group = null;
    }
    return out;
  },
  // An import names a package, which is a directory, so the edge lands on the directory's first non-test
  // .go file: a real file in that package. A standard-library path can match a repo directory with the
  // same tail, and nothing in the source tells the two apart, so that edge points at the wrong package.
  resolve(spec, fromPath, files) {
    if (spec.startsWith('.')) return null;
    let idx = goDirMemo.get(files);
    if (!idx) {
      const exact = new Map();
      // files is sorted (the contract), so the first file seen in a directory is its first by name.
      for (const f of files) {
        const cut = f.lastIndexOf('/');
        const dir = cut < 0 ? '' : f.slice(0, cut);
        if (!f.endsWith('.go') || f.endsWith('_test.go') || dir === '') continue;
        if (!exact.has(dir)) exact.set(dir, f);
      }
      const byLast = new Map();
      for (const dir of exact.keys()) {
        const last = dir.slice(dir.lastIndexOf('/') + 1);
        if (!byLast.has(last)) byLast.set(last, []);
        byLast.get(last).push(dir);
      }
      idx = { exact, byLast };
      goDirMemo.set(files, idx);
    }
    // Longest suffix of the import path first: the module prefix is not in the repo, so the package's
    // directory is the tail that matches.
    const segs = spec.split('/').filter(Boolean);
    for (let k = 0; k < segs.length; k++) {
      const suffix = segs.slice(k).join('/');
      if (idx.exact.has(suffix)) return idx.exact.get(suffix);
      const hit = (idx.byLast.get(segs[segs.length - 1]) ?? []).find((d) => d.endsWith(`/${suffix}`));
      if (hit !== undefined) return idx.exact.get(hit);
    }
    return null;
  },
};
