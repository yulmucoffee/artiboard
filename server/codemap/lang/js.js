// JavaScript and TypeScript: definitions, imports and calls, read from the code alone. Comments, template text and
// regex bodies are blanked first (same length, same lines) and strings become single tokens, so a commented-out
// function or a string "class Foo" never becomes a symbol; an import's spec is the string's text.

const JS_EXTS = ['.js', '.mjs', '.cjs', '.jsx', '.ts', '.tsx', '.mts', '.cts'];
// what an extensionless relative import may mean, in the order a bundler or Node tries them
const JS_PROBE = ['.js', '.mjs', '.cjs', '.ts', '.tsx', '.jsx', '.mts', '.cts', '.json'];
// TypeScript projects import './x.js' for the file './x.ts'
const JS_SWAP = { '.js': ['.ts', '.tsx'], '.jsx': ['.tsx'], '.mjs': ['.mts'], '.cjs': ['.cts'] };

// words after which a '/' starts a regular expression rather than a division
const JS_REGEX_AFTER = new Set(['return', 'typeof', 'case', 'do', 'else', 'in', 'of', 'new', 'delete', 'void', 'throw',
  'instanceof', 'yield', 'await']);
// words that are followed by '(' without being a call
const JS_RESERVED = new Set(['break', 'case', 'catch', 'class', 'const', 'continue', 'debugger', 'default', 'delete', 'do',
  'else', 'export', 'extends', 'finally', 'for', 'function', 'if', 'import', 'in', 'instanceof', 'new', 'return', 'super',
  'switch', 'this', 'throw', 'try', 'typeof', 'var', 'void', 'while', 'with', 'yield', 'let', 'await', 'async', 'require']);
// the runtime's own objects: `JSON.parse(` calls the runtime, never a parse defined in the repo
const JS_GLOBALS = new Set(['console', 'Object', 'JSON', 'Math', 'Array', 'Promise', 'Number', 'String', 'Boolean', 'Date',
  'Reflect', 'Symbol', 'process', 'document', 'window', 'globalThis', 'Buffer', 'Intl', 'Error', 'BigInt', 'URL', 'crypto',
  'navigator', 'localStorage', 'sessionStorage', 'history', 'location', 'performance', 'Atomics', 'RegExp', 'Map', 'Set']);
const JS_MODIFIERS = new Set(['static', 'public', 'private', 'protected', 'readonly', 'abstract', 'override', 'declare',
  'async', 'accessor', 'get', 'set']);
// a line ending in one of these words goes on to the next line
const JS_OPEN_WORDS = new Set(['new', 'typeof', 'await', 'yield', 'extends', 'implements', 'in', 'of', 'instanceof',
  'export', 'default', 'import', 'from', 'as', 'async', 'function', 'class', 'const', 'let', 'var', 'type', 'interface',
  'enum', 'return', 'throw', 'case', 'delete', 'void', 'satisfies', 'keyof', 'declare', 'abstract', 'namespace']);
// a line starting with one of these continues the line before
const JS_CONT_NEXT = new Set(['.', '?.', ')', ']', '}', ',', ':', '?', '=>', '=', '(', '[', '+', '-', '*', '/', '%', '&',
  '|', '^', '&&', '||', '??', '<', '>', '<=', '>=', '==', '===', '!=', '!==']);
const JS_CONT_WORDS = new Set(['in', 'of', 'instanceof', 'as', 'satisfies', 'extends', 'implements']);
// punctuation a value can end on: after it a new line starts a new statement
const JS_VALUE_END = new Set([')', ']', '}', '\u0001']);
const JS_CLOSERS = { '(': ')', '[': ']', '{': '}' };
// the closing backtick of a template becomes this, so the next token never reads as a tagged template
const JS_TEMPLATE_END = '\u0001';
const JS_TOKEN = /[A-Za-z_$\u0080-\uffff][\w$\u0080-\uffff]*|#[A-Za-z_$][\w$]*|\d[\w.]*|\.\.\.|=>|\?\.(?!\d)|[=!]==?|[<>]=|&&|\|\||\?\?|\S/g;
const JS_NONE = { v: '', t: '', line: 0, d: -1 };

// Comments, template text and regex bodies become spaces; offsets and line breaks stay. Strings are left in place and
// returned by their opening offset, so the tokenizer takes each whole.
function jsStrip(text) {
  const n = text.length, pieces = [], strings = new Map(), subs = [];
  let from = 0, i = 0, last = '', lastWord = '', lastAt = -1, braces = 0;
  const put = (a, b, end = '') => {
    pieces.push(text.slice(from, a), text.slice(a, b - end.length).replace(/[^\n]/g, ' '), end);
    from = b;
  };
  // from just inside a template to its end, or to the start of its next substitution
  const template = (p) => {
    let j = p;
    while (j < n && text[j] !== '`' && !(text[j] === '$' && text[j + 1] === '{')) j += text[j] === '\\' ? 2 : 1;
    if (j >= n) { put(p, n); return n; }
    last = ')';
    if (text[j] === '`') { put(p, j + 1, JS_TEMPLATE_END); return j + 1; }
    put(p, j + 2); subs.push(braces); last = '{';
    return j + 2;
  };
  const regexHere = () => {
    if (!last) return true;
    if (/[\w$]/.test(last)) return JS_REGEX_AFTER.has(lastWord);
    // '</' closes a JSX tag and '}/' or ')/' divides; after '=>' a regex may start
    if (last === '>') return text[lastAt - 1] === '=';
    return '(,=:[!&|?{};+-*%~^'.includes(last);
  };
  if (text.startsWith('#!')) { const j = text.indexOf('\n'); i = j < 0 ? n : j; put(0, i); }
  while (i < n) {
    const c = text[i];
    if (c === '/' && text[i + 1] === '/') { let j = text.indexOf('\n', i); if (j < 0) j = n; put(i, j); i = j; continue; }
    if (c === '/' && text[i + 1] === '*') { let j = text.indexOf('*/', i + 2); j = j < 0 ? n : j + 2; put(i, j); i = j; continue; }
    if (c === '"' || c === "'") {
      let j = i + 1;
      // a quote left open ends at the line's end, so JSX text like "don't" spoils one line at most
      while (j < n && text[j] !== c && text[j] !== '\n') j += text[j] === '\\' ? 2 : 1;
      j = Math.min(j, n);
      const end = j < n && text[j] === c ? j + 1 : j;
      strings.set(i, { value: text.slice(i + 1, j), end });
      i = end; last = c; lastAt = i - 1;
      continue;
    }
    if (c === '`') { i = template(i + 1); continue; }
    if (c === '/' && regexHere()) {
      let j = i + 1, cls = false;
      while (j < n && text[j] !== '\n' && (cls || text[j] !== '/')) {
        if (text[j] === '\\') j++;
        else if (text[j] === '[') cls = true;
        else if (text[j] === ']') cls = false;
        j++;
      }
      if (j < n && text[j] === '/') {
        put(i + 1, j); i = j + 1;
        while (i < n && /[a-z]/i.test(text[i])) i++;
        last = ')'; lastAt = i - 1;
        continue;
      }
    }
    if (/[\w$\u0080-\uffff]/.test(c)) {
      let j = i + 1;
      while (j < n && /[\w$\u0080-\uffff]/.test(text[j])) j++;
      lastWord = text.slice(i, j); last = text[j - 1]; lastAt = j - 1; i = j;
      continue;
    }
    if (c === '{') braces++;
    else if (c === '}') {
      if (subs.length && subs[subs.length - 1] === braces) { subs.pop(); put(i, i + 1); i = template(i + 1); continue; }
      braces--;
    }
    if (!/\s/.test(c)) { last = c; lastAt = i; }
    i++;
  }
  pieces.push(text.slice(from));
  return { code: pieces.join(''), strings };
}

// tokens with their line and bracket depth; an opener and its closer share the outer depth
function jsTokens(code, strings) {
  const toks = [];
  let depth = 0, line = 1, at = 0;
  const re = new RegExp(JS_TOKEN.source, 'g');
  for (let m; (m = re.exec(code));) {
    for (; at < m.index; at++) if (code.charCodeAt(at) === 10) line++;
    const v = m[0], str = (v === '"' || v === "'") && strings.get(m.index);
    if (str) { toks.push({ v: str.value, t: 'str', line, d: depth }); re.lastIndex = str.end; continue; }
    const t = /^(#[A-Za-z_$]|[A-Za-z_$\u0080-\uffff])/.test(v) ? 'id' : /^\d/.test(v) ? 'num' : 'p';
    if (t === 'p' && JS_CLOSERS[v]) { toks.push({ v, t, line, d: depth }); depth++; continue; }
    if (t === 'p' && (v === ')' || v === ']' || v === '}')) depth = Math.max(0, depth - 1);
    toks.push({ v, t, line, d: depth });
  }
  return toks;
}

const jsAt = (toks, j) => toks[j] || JS_NONE;
const jsIs = (tok, v) => tok.t === 'p' && tok.v === v;

// an opener never closed runs to the last token, so broken input still reads to its end
function jsMatch(toks, j) {
  const d = toks[j].d, close = JS_CLOSERS[toks[j].v];
  for (let k = j + 1; k < toks.length; k++) if (toks[k].d === d && jsIs(toks[k], close)) return k;
  return toks.length - 1;
}

// a TypeScript type argument list holds commas and braces that are not the code's (`Map<A, B>`, `<T extends {}>`)
function jsSkipAngles(toks, j) {
  let n = 0;
  for (let k = j; k < toks.length; k++) {
    if (jsIs(toks[k], '<')) n++;
    else if (jsIs(toks[k], '>')) { if (--n === 0) return k + 1; }
    else if (jsIs(toks[k], ';') || jsIs(toks[k], '{') && n === 0) return k;
  }
  return toks.length;
}

// The bodies (brace indexes) of `(function () { … })()`, `(() => { … })()` and `(function () { … }())` at the top
// level: a classic script's module wrapper, whose body is its real top level.
function jsWrappers(toks) {
  const out = [];
  for (let j = 0; j < toks.length; j++) {
    if (toks[j].d !== 0 || !jsIs(toks[j], '(')) continue;
    const end = jsMatch(toks, j);
    let k = j + 1;
    if (jsAt(toks, k).v === 'async') k++;
    const fn = jsAt(toks, k).v === 'function';
    if (fn) k += 1 + (jsIs(jsAt(toks, k + 1), '*') ? 1 : 0) + (jsAt(toks, k + 1).t === 'id' ? 1 : 0);
    if (jsIs(jsAt(toks, k), '(')) {
      k = jsMatch(toks, k) + 1;
      if (!fn && jsIs(jsAt(toks, k), '=>')) k++;
      if ((fn || jsIs(jsAt(toks, k - 1), '=>')) && jsIs(jsAt(toks, k), '{')) {
        const close = jsMatch(toks, k), after = jsAt(toks, close + 1);
        const called = jsIs(after, ')') && close + 1 === end && jsIs(jsAt(toks, end + 1), '(')
          || jsIs(after, '(') && jsMatch(toks, close + 1) + 1 === end;
        if (called) out.push([k, close]);
      }
    }
    j = end;
  }
  return out;
}

// a line break ends a statement unless the line runs on, as JavaScript reads code without semicolons
function jsStarts(toks, i) {
  if (i === 0) return true;
  const prev = toks[i - 1], cur = toks[i];
  if (cur.t === 'p' && JS_CONT_NEXT.has(cur.v) || cur.t === 'id' && JS_CONT_WORDS.has(cur.v)) return false;
  if (jsIs(prev, ';') || jsIs(prev, '}') && prev.d === cur.d) return true;
  if (prev.line === cur.line) return false;
  if (prev.t === 'p') return JS_VALUE_END.has(prev.v) || prev.v === '++' || prev.v === '--';
  if (prev.t === 'id') return !JS_OPEN_WORDS.has(prev.v);
  return true;
}

// `const f = () => {}` is a function: its calls are its own, and a query lists it as one
function jsInitKind(toks, j, ts) {
  let t = jsAt(toks, j);
  if (t.v === 'async' && t.t === 'id') t = jsAt(toks, ++j);
  if (t.v === 'function') return 'fn';
  if (t.v === 'class') return 'class';
  if (t.t === 'id' && jsIs(jsAt(toks, j + 1), '=>')) return 'fn';
  if (ts && jsIs(t, '<')) { j = jsSkipAngles(toks, j); t = jsAt(toks, j); }
  if (jsIs(t, '(')) {
    const after = jsAt(toks, jsMatch(toks, j) + 1);
    if (jsIs(after, '=>') || jsIs(after, ':')) return 'fn';
  }
  return null;
}

// `new a.b.C` and `extends ns.Base` name C and Base: the last part is what some file defines
function jsDotted(toks, j) {
  let last = null;
  while (toks[j] && toks[j].t === 'id') {
    last = toks[j];
    if (jsIs(jsAt(toks, j + 1), '.') && jsAt(toks, j + 2).t === 'id') j += 2;
    else { j++; break; }
  }
  return { last, next: j };
}

function jsExtract(text, path) {
  const out = { symbols: [], imports: [], refs: [], extends: [] };
  if (!text) return out;
  const { code, strings } = jsStrip(text);
  const toks = jsTokens(code, strings);
  const ts = /\.[mc]?tsx?$/i.test(path);
  const x = { toks, ts, out, defs: new Set(), types: [], exportNames: new Set(), seen: new Map(), aliases: new Map(),
    modules: new Set(), locals: new Set(), exportBraces: new Set() };
  // the top level, and the body of a top-level `(function () { … })()` that wraps a whole script
  for (const [open, close] of [[-1, toks.length], ...jsWrappers(toks)]) {
    const d = open < 0 ? 0 : toks[open].d + 1, starts = [];
    for (let i = open + 1; i < close; i++) if (toks[i].d === d && (i === open + 1 || jsStarts(toks, i))) starts.push(i);
    for (let s = 0; s < starts.length; s++) jsDeclaration(x, starts[s], s + 1 < starts.length ? starts[s + 1] : close);
  }
  for (const sym of out.symbols) if (!sym.exported && x.exportNames.has(sym.name)) sym.exported = true;
  jsImports(x);
  jsRefs(x, !/\.[mc]?ts$/i.test(path));
  return out;
}

// one symbol per name and kind: overloads and get/set pairs are one definition spanning all of them
function jsAdd(x, tok, kind, exported, end, name = tok.v) {
  const key = `${kind} ${name}`, had = x.seen.get(key);
  if (had) { had.end = Math.max(had.end, end); return; }
  const sym = { name, kind, line: tok.line, end: Math.max(end, tok.line), exported: !!exported };
  x.seen.set(key, sym);
  x.out.symbols.push(sym);
}

// only top-level declarations (and the factory's nested functions) are symbols: locals come and go too often to map
function jsDeclaration(x, s, stop) {
  const { toks } = x, at = (j) => (j < stop ? jsAt(toks, j) : JS_NONE), end = toks[stop - 1].line;
  let k = s, exported = false, isDefault = false;
  while (at(k).t === 'id' && ['export', 'default', 'declare', 'abstract'].includes(at(k).v)) {
    if (at(k).v === 'export') exported = true;
    if (at(k).v === 'default') isDefault = true;
    k++;
  }
  if (at(k).v === 'async' && at(k + 1).v === 'function') k++;
  if (at(k).v === 'const' && at(k + 1).v === 'enum') k++;
  const kw = at(k).t === 'id' ? at(k).v : '';
  if (kw === 'function') {
    const j = jsIs(at(k + 1), '*') ? k + 2 : k + 1;
    if (at(j).t === 'id') {
      jsAdd(x, at(j), 'fn', exported, end);
      x.defs.add(j);
      jsInner(x, at(j), j + 1, stop, exported);
    }
  } else if (kw === 'class') {
    jsClass(x, k, stop, exported);
  } else if (kw === 'interface' && at(k + 1).t === 'id') {
    jsAdd(x, at(k + 1), 'type', exported, end);
    let j = k + 2;
    if (jsIs(at(j), '<')) j = jsSkipAngles(toks, j);
    if (at(j).v === 'extends') jsBases(x, at(k + 1).v, j + 1, stop);
    x.types.push([s, stop]);
  } else if (kw === 'type' && at(k + 1).t === 'id' && (jsIs(at(k + 2), '=') || jsIs(at(k + 2), '<'))) {
    jsAdd(x, at(k + 1), 'type', exported, end);
    x.types.push([s, stop]);
  } else if (kw === 'enum' && at(k + 1).t === 'id') {
    jsAdd(x, at(k + 1), 'enum', exported, end);
    x.types.push([s, stop]);
  } else if ((kw === 'namespace' || kw === 'module') && at(k + 1).t === 'id' && (jsIs(at(k + 2), '{') || jsIs(at(k + 2), '.'))) {
    jsAdd(x, at(k + 1), 'module', exported, end);
  } else if (kw === 'const' || kw === 'let' || kw === 'var') {
    jsDeclarators(x, k, stop, kw, exported);
  } else if (exported && !isDefault && jsIs(at(k), '{')) {
    // export { a, b as c }: the local names are exported; with `from` it re-exports another file's names instead
    const close = jsMatch(toks, k);
    if (at(close + 1).v !== 'from') {
      for (let j = k + 1; j < close; j++) if (at(j).t === 'id' && (jsIs(at(j - 1), '{') || jsIs(at(j - 1), ','))) x.exportNames.add(at(j).v);
    }
  } else if (isDefault && at(k).t === 'id' && k + 1 >= stop - (jsIs(at(stop - 1), ';') ? 1 : 0)) {
    x.exportNames.add(at(k).v);
  } else if (kw === 'exports' || kw === 'module' && jsIs(at(k + 1), '.') && at(k + 2).v === 'exports') {
    jsCommonExport(x, kw === 'module' ? k + 2 : k, stop, end);
  }
}

// exports.name = …, module.exports.name = …, module.exports = { a, b: c } (k is at `exports`)
function jsCommonExport(x, k, stop, end) {
  const { toks } = x, at = (j) => (j < stop ? jsAt(toks, j) : JS_NONE);
  if (jsIs(at(k + 1), '.') && at(k + 2).t === 'id' && jsIs(at(k + 3), '=')) {
    jsAdd(x, at(k + 2), jsInitKind(toks, k + 4, x.ts) || 'const', true, end);
    x.defs.add(k + 2);
  } else if (jsIs(at(k + 1), '=') && jsIs(at(k + 2), '{')) {
    x.exportBraces.add(k + 2);
    const close = jsMatch(toks, k + 2);
    for (let j = k + 3; j < close; j++) {
      if (at(j).t !== 'id' || at(j).d !== at(k + 2).d + 1) continue;
      if (jsIs(at(j - 1), ':')) x.exportNames.add(at(j).v);
      else if ((jsIs(at(j - 1), '{') || jsIs(at(j - 1), ',')) && (jsIs(at(j + 1), ',') || jsIs(at(j + 1), '}'))) x.exportNames.add(at(j).v);
    }
  } else if (jsIs(at(k + 1), '=') && at(k + 2).t === 'id') {
    x.exportNames.add(at(k + 2).v);
  }
}

// const a = 1, b = () => {}: each declared name; destructuring names come from elsewhere and are skipped
function jsDeclarators(x, k, stop, kw, exported) {
  const { toks } = x;
  let j = k + 1;
  while (j < stop && toks[j].t === 'id') {
    const name = toks[j];
    let e = j + 1;
    if (jsIs(jsAt(toks, e), '!')) e++;
    if (jsIs(jsAt(toks, e), ':')) {
      for (e++; e < stop; e++) {
        const t = toks[e];
        if (jsIs(t, '<')) e = jsSkipAngles(toks, e) - 1;
        else if (t.d === name.d && (jsIs(t, '=') || jsIs(t, ',') || jsIs(t, ';'))) break;
      }
    }
    let kind = kw === 'const' ? 'const' : 'var';
    if (jsIs(jsAt(toks, e), '=')) {
      kind = jsInitKind(toks, e + 1, x.ts) || kind;
      if (x.ts && jsIs(jsAt(toks, e + 1), '<')) e = jsSkipAngles(toks, e + 1) - 1;
    }
    let last = e;
    while (last < stop && !(toks[last].d === name.d && jsIs(toks[last], ','))) last++;
    jsAdd(x, name, kind, exported, toks[Math.min(last, stop) - 1].line);
    if (kind === 'fn') jsInner(x, name, e + 1, last, exported);
    // another declarator only when it reads as one: `, name =`, `, name,` or `, name;`
    const next = jsAt(toks, last + 2);
    if (last >= stop || !(jsIs(next, '=') || jsIs(next, ',') || jsIs(next, ';') || jsIs(next, ':') || last + 2 >= stop)) break;
    j = last + 1;
  }
}

// `function name(` declarations directly in the body of the top-level function outer (the factory style, where one
// function holds start, claim, post…): symbols 'outer.name' of kind 'fn', each to the end of its own body, so the
// calls inside are theirs. The body is the first brace at outer's depth in [from, stop); deeper functions stay out.
function jsInner(x, outer, from, stop, exported) {
  const { toks } = x;
  let open = from;
  while (open < stop && !(jsIs(toks[open], '{') && toks[open].d === outer.d)) open++;
  if (open >= stop) return;
  const close = jsMatch(toks, open), bd = toks[open].d + 1;
  for (let j = open + 1; j < close; j++) {
    if (toks[j].d !== bd || !(j === open + 1 || jsStarts(toks, j))) continue;
    let k = toks[j].v === 'async' && jsAt(toks, j + 1).v === 'function' ? j + 1 : j;
    if (toks[k].v !== 'function' || toks[k].t !== 'id') continue;
    if (jsIs(jsAt(toks, k + 1), '*')) k++;
    const name = jsAt(toks, k + 1);
    if (name.t !== 'id') continue;
    let body = k + 2;
    while (body < close && !(jsIs(toks[body], '{') && toks[body].d === bd)) body++;
    const end = body < close ? jsMatch(toks, body) : k + 1;
    jsAdd(x, name, 'fn', exported, toks[end].line, `${outer.v}.${name.v}`);
    x.defs.add(k + 1);
    j = end;
  }
}

// `extends A, B.C<D>` or `implements A, B`: each base by its last name part, up to `{`
function jsBases(x, name, j, stop) {
  const { toks } = x;
  while (j < stop) {
    const { last, next } = jsDotted(toks, j);
    if (!last) break;
    j = next;
    if (jsIs(jsAt(toks, j), '(')) break; // a mixin call names no class
    x.out.extends.push({ name, base: last.v, line: last.line });
    x.out.refs.push({ name: last.v, line: last.line });
    if (jsIs(jsAt(toks, j), '<')) j = jsSkipAngles(toks, j);
    if (!jsIs(jsAt(toks, j), ',')) break;
    j++;
  }
  return j;
}

function jsClass(x, k, stop, exported) {
  const { toks } = x, name = jsAt(toks, k + 1);
  if (name.t !== 'id' || name.v === 'extends' || name.v === 'implements') return;
  jsAdd(x, name, 'class', exported, toks[stop - 1].line);
  let j = k + 2;
  if (jsIs(jsAt(toks, j), '<')) j = jsSkipAngles(toks, j);
  if (jsAt(toks, j).v === 'extends') j = jsBases(x, name.v, j + 1, stop);
  while (j < stop && !(jsIs(toks[j], '{') && toks[j].d === name.d)) {
    if (toks[j].v === 'implements') { j = jsBases(x, name.v, j + 1, stop); continue; }
    j++;
  }
  if (j < stop) jsMembers(x, name.v, j, jsMatch(toks, j), exported);
}

// a class's methods, `name = () =>` fields among them: they are methods in all but syntax
function jsMembers(x, cls, open, close, exported) {
  const { toks } = x, bd = toks[open].d + 1, found = [];
  for (let j = open + 1; j < close; j++) {
    if (toks[j].d !== bd || jsIs(toks[j], '{') || !(j === open + 1 || jsStarts(toks, j))) continue;
    const begin = j;
    while (jsIs(toks[j], '@')) { // decorators, read as refs later
      j = jsDotted(toks, j + 1).next;
      if (jsIs(jsAt(toks, j), '(')) j = jsMatch(toks, j) + 1;
    }
    let isPrivate = false;
    while (JS_MODIFIERS.has(jsAt(toks, j).v) && (jsAt(toks, j + 1).t === 'id' || jsIs(jsAt(toks, j + 1), '*'))) {
      if (toks[j].v === 'private' || toks[j].v === 'protected') isPrivate = true;
      j++;
    }
    if (jsIs(jsAt(toks, j), '*')) j++;
    const name = jsAt(toks, j);
    if (name.t !== 'id' || j >= close) { found.push({ begin }); continue; }
    let a = j + 1;
    if (jsIs(jsAt(toks, a), '?') || jsIs(jsAt(toks, a), '!')) a++;
    const method = jsIs(jsAt(toks, a), '(') || jsIs(jsAt(toks, a), '<')
      || jsIs(jsAt(toks, a), '=') && jsInitKind(toks, a + 1, x.ts) === 'fn';
    found.push({ begin, name: method && name.v !== 'constructor' ? name : null, isPrivate });
    if (method) x.defs.add(j);
    j = a - 1;
  }
  found.forEach((m, i) => {
    if (!m.name) return;
    const end = toks[(i + 1 < found.length ? found[i + 1].begin : close) - 1].line;
    jsAdd(x, m.name, 'method', exported && !m.isPrivate && !m.name.v.startsWith('#'), end, `${cls}.${m.name.v}`);
  });
}

// import … from 'x', import 'x', import('x'), export … from 'x', require('x')
function jsImports(x) {
  const { toks, out } = x;
  for (let j = 0; j < toks.length; j++) {
    const t = toks[j];
    if (t.t !== 'id' || jsIs(jsAt(toks, j - 1), '.') || jsIs(jsAt(toks, j - 1), '?.')) continue;
    const n1 = jsAt(toks, j + 1);
    if (t.v === 'import' || t.v === 'require') {
      if (jsIs(n1, '(') && jsAt(toks, j + 2).t === 'str' && jsIs(jsAt(toks, j + 3), ')')) {
        const imp = { spec: toks[j + 2].v, line: t.line };
        jsBinding(x, j, imp);
        out.imports.push(imp);
      } else if (t.v === 'import' && n1.t === 'str') {
        out.imports.push({ spec: n1.v, line: t.line });
      } else if (t.v === 'import' && n1.t && !jsIs(n1, '(') && !jsIs(n1, '.') && !jsIs(n1, '=')) {
        const c = jsClause(toks, j + 1, x);
        if (c) out.imports.push({ spec: c.spec, line: t.line, ...(c.names.length && { names: c.names }) });
      }
    } else if (t.v === 'export' && (jsIs(n1, '{') || jsIs(n1, '*') || n1.v === 'type' && jsIs(jsAt(toks, j + 2), '{'))) {
      const c = jsClause(toks, j + 1, null);
      if (c) out.imports.push({ spec: c.spec, line: t.line, ...(c.names.length && { names: c.names }) });
    }
  }
}

// The clause of an import or export up to `from 'spec'`: the names it takes from that module. For an import (x
// given), also the local names it binds: `b` in `{ a as b }`, and `ns` in `* as ns`.
function jsClause(toks, k, x) {
  const d = toks[k - 1].d, names = [];
  for (let j = k; j < toks.length && j < k + 500; j++) {
    const t = toks[j];
    if (t.d === d && t.v === 'from' && t.t === 'id' && jsAt(toks, j + 1).t === 'str') return { spec: toks[j + 1].v, names };
    // the clause ends with its statement: a later statement's `from` is not this one's
    if (t.d === d && (jsIs(t, ';') || t.t === 'str' || j > k && jsStarts(toks, j))) return null;
    if (x && jsIs(t, '*') && jsAt(toks, j + 1).v === 'as' && jsAt(toks, j + 2).t === 'id') x.modules.add(toks[j + 2].v);
    // `import name from` binds the module's default export to name
    if (x && j === k && t.t === 'id' && t.v !== 'type' && (jsIs(jsAt(toks, j + 1), ',') || jsAt(toks, j + 1).v === 'from')) x.locals.add(t.v);
    if (t.d !== d + 1 || t.t !== 'id' || !(jsIs(toks[j - 1], '{') || jsIs(toks[j - 1], ','))) continue;
    let name = t;
    if (t.v === 'type' && jsAt(toks, j + 1).t === 'id' && jsAt(toks, j + 1).v !== 'as') name = toks[++j];
    names.push(name.v);
    if (x) x.locals.add(jsAt(toks, j + 1).v === 'as' && jsAt(toks, j + 2).t === 'id' ? toks[j + 2].v : name.v);
    if (jsAt(toks, j + 1).v === 'as' && jsAt(toks, j + 2).t === 'id') {
      if (x) x.aliases.set(toks[j + 2].v, name.v);
      j += 2;
    }
  }
  return null;
}

// What `require('x')` or `import('x')` at j is assigned to: `const { a, b: c } =` takes names a and b (c goes by
// b), `const ns =` binds the whole module, so `ns.a(` calls a.
function jsBinding(x, j, imp) {
  const { toks } = x;
  const eq = jsAt(toks, j - 1).v === 'await' ? j - 2 : j - 1;
  if (!jsIs(jsAt(toks, eq), '=')) return;
  if (jsAt(toks, eq - 1).t === 'id' && ['const', 'let', 'var', 'import'].includes(jsAt(toks, eq - 2).v)) { x.modules.add(toks[eq - 1].v); return; }
  if (!jsIs(jsAt(toks, eq - 1), '}')) return;
  let open = eq - 2;
  while (open >= 0 && !(jsIs(toks[open], '{') && toks[open].d === toks[eq - 1].d)) open--;
  if (open < 0) return;
  const names = [];
  for (let k = open + 1; k < eq - 1; k++) {
    const t = toks[k];
    if (t.t !== 'id' || t.d !== toks[open].d + 1 || !(jsIs(toks[k - 1], '{') || jsIs(toks[k - 1], ','))) continue;
    names.push(t.v);
    const local = jsIs(jsAt(toks, k + 1), ':') && jsAt(toks, k + 2).t === 'id' ? toks[k + 2].v : t.v;
    x.locals.add(local);
    if (local !== t.v) x.aliases.set(local, t.v);
  }
  if (names.length) imp.names = names;
}

// a JSX tag can open where a value is expected
function jsJsxHere(prev) {
  if (!prev.t) return true;
  if (prev.t === 'p') return prev.v !== ')' && prev.v !== ']' && prev.v !== JS_TEMPLATE_END;
  return prev.t === 'id' && JS_OPEN_WORDS.has(prev.v);
}

// an argument and a pattern look alike token by token; what holds a name tells them apart
function jsEnclosing(toks) {
  const encl = new Array(toks.length), stack = [];
  toks.forEach((t, j) => {
    if (t.t === 'p' && (t.v === ')' || t.v === ']' || t.v === '}')) stack.pop();
    encl[j] = stack.length ? stack[stack.length - 1] : -1;
    if (t.t === 'p' && JS_CLOSERS[t.v]) stack.push(j);
  });
  return encl;
}

// a call's argument list: after a callee, and not a parameter list (`function f(a)`, `f(a) {`, `(a) =>`)
function jsCallParen(x, open) {
  const { toks } = x, p = jsAt(toks, open - 1), after = jsAt(toks, jsMatch(toks, open) + 1);
  if (jsIs(after, '{') || jsIs(after, '=>') || x.defs.has(open - 1)) return false;
  if (p.t === 'id') return !JS_RESERVED.has(p.v) || p.v === 'super';
  return jsIs(p, ')') || jsIs(p, ']') || jsIs(p, '?.') || p.v === JS_TEMPLATE_END;
}

// An array or object literal: not a pattern (`const { a } =`, `[a, b] = c`, a parameter list), not a block, not
// a TypeScript type, and not the `module.exports = { … }` that lists exports.
function jsLiteral(x, encl, open) {
  const { toks } = x, p = jsAt(toks, open - 1), outer = encl[open];
  if (jsIs(jsAt(toks, jsMatch(toks, open) + 1), '=') || x.exportBraces.has(open)) return false;
  if (outer >= 0 && jsIs(toks[outer], '(')) {
    const q = jsAt(toks, outer - 1), after = jsAt(toks, jsMatch(toks, outer) + 1);
    const control = q.t === 'id' && ['if', 'for', 'while', 'switch', 'with'].includes(q.v);
    if (!control && (jsIs(after, '{') || jsIs(after, '=>') || x.defs.has(outer - 1))) return false;
  }
  if (p.t === 'id') return p.v === 'return';
  if (p.t !== 'p') return false;
  if (toks[open].v === '[') return !JS_VALUE_END.has(p.v);
  if (x.ts && p.v === ':') return false;
  return ['=', '(', ',', '[', ':', '?', '&&', '||', '??'].includes(p.v);
}

// Whether the bare name at j is used as a value: passed as an argument, put in an array or an object literal,
// assigned, or returned. A key, a member name, a binding in a pattern or a parameter list is not a use.
function jsUseAt(x, encl, j) {
  const { toks } = x, prev = jsAt(toks, j - 1), next = jsAt(toks, j + 1);
  // `name =>` declares a parameter where an argument would sit
  if (jsIs(next, '.') || jsIs(next, '?.') || jsIs(next, '=') || jsIs(next, '=>')) return false;
  if (prev.t === 'id') return prev.v === 'return';
  if (jsIs(prev, '=')) return true;
  const open = encl[j], o = open >= 0 ? toks[open].v : '';
  if (o === '(') return (jsIs(prev, '(') || jsIs(prev, ',')) && jsCallParen(x, open);
  if (o === '[') return (jsIs(prev, '[') || jsIs(prev, ',')) && jsLiteral(x, encl, open);
  if (o === '{') return (jsIs(prev, ':') || (jsIs(prev, '{') || jsIs(prev, ',')) && (jsIs(next, ',') || jsIs(next, '}'))) && jsLiteral(x, encl, open);
  return false;
}

// The names a parameter list binds: plain and rest parameters, and what a pattern binds (`{ a: b }` binds b, `[c]`
// binds c); not a default's value, an object pattern's key, or a TypeScript type. Best effort, over its tokens.
function jsParams(toks, open, close) {
  const names = new Set(), base = toks[open].d + 1;
  let skip = -1;
  for (let k = open + 1; k < close; k++) {
    const t = toks[k];
    if (skip >= 0 && (t.d < skip || t.d === skip && jsIs(t, ','))) skip = -1;
    if (skip >= 0) continue;
    if (jsIs(t, '=')) { skip = t.d; continue; }
    if (t.t !== 'id' || JS_RESERVED.has(t.v) || t.v === 'this') continue;
    if (jsIs(toks[k - 1], ':') && t.d === base) { skip = base; continue; }
    if (jsIs(jsAt(toks, k + 1), ':') && t.d > base) continue;
    names.add(t.v);
  }
  return names;
}

// an arrow function's body from k: a block, or an expression up to a `,` or `;` at its depth, the end of what holds
// it, or the next statement
function jsArrowBody(toks, k, d) {
  if (jsIs(jsAt(toks, k), '{')) return [k, jsMatch(toks, k)];
  let end = k;
  while (end < toks.length && toks[end].d >= d && !(toks[end].d === d && (jsIs(toks[end], ',') || jsIs(toks[end], ';')
    || end > k && jsStarts(toks, end)))) end++;
  return end > k ? [k, end - 1] : null;
}

// Each function's parameters and the tokens of its body: inside, a name a parameter binds is that parameter, not a
// file-level name (`function send(res, body) { … body … }` uses its own body).
function jsScopes(x) {
  const { toks, defs } = x, scopes = [];
  const control = new Set(['if', 'for', 'while', 'switch', 'with']);
  for (let j = 0; j < toks.length; j++) {
    const t = toks[j];
    if (t.t === 'id' && jsIs(jsAt(toks, j + 1), '=>') && !jsIs(jsAt(toks, j - 1), '.')) {
      const body = jsArrowBody(toks, j + 2, t.d);
      if (body) scopes.push({ from: body[0], to: body[1], names: new Set([t.v]) });
      continue;
    }
    if (!jsIs(t, '(')) continue;
    const close = jsMatch(toks, j), after = jsAt(toks, close + 1), p = jsAt(toks, j - 1);
    let body = null;
    if (jsIs(after, '=>')) body = jsArrowBody(toks, close + 2, t.d);
    else if (p.v === 'function' || jsAt(toks, j - 2).v === 'function' || defs.has(j - 1)
      || jsIs(after, '{') && p.t === 'id' && !control.has(p.v)) {
      // a TypeScript return type may sit between the parameters and the body
      let open = close + 1;
      while (open < toks.length && toks[open].d >= t.d && !(toks[open].d === t.d && (jsIs(toks[open], '{') || jsIs(toks[open], ';')))) open++;
      if (jsIs(jsAt(toks, open), '{') && toks[open].d === t.d) body = [open, jsMatch(toks, open)];
    }
    if (body) scopes.push({ from: body[0], to: body[1], names: jsParams(toks, j, close) });
  }
  return scopes.sort((a, b) => a.from - b.from);
}

// names called, constructed, decorated, used as JSX components or used as values, outside type declarations
function jsRefs(x, jsx) {
  const { toks, out, defs, types, aliases } = x;
  const refs = [], encl = jsEnclosing(toks), scopes = jsScopes(x), active = [];
  let entered = 0;
  // whether a parameter of a function around token j binds name (asked with j rising)
  const shadowed = (j, name) => {
    while (entered < scopes.length && scopes[entered].from <= j) active.push(scopes[entered++]);
    for (let a = active.length - 1; a >= 0; a--) if (active[a].to < j) active.splice(a, 1);
    return active.some((s) => s.names.has(name));
  };
  // the names a use may mean: this file's own top-level names, its functions' nested functions, and what it imports
  const bound = new Set(x.locals);
  for (const s of out.symbols) {
    if (!s.name.includes('.')) bound.add(s.name);
    else if (s.kind === 'fn') bound.add(s.name.slice(s.name.indexOf('.') + 1));
  }
  let r = 0;
  for (let j = 0; j < toks.length; j++) {
    while (r < types.length && types[r][1] <= j) r++;
    if (r < types.length && types[r][0] <= j) { j = types[r][1] - 1; continue; }
    const t = toks[j], prev = jsAt(toks, j - 1), next = jsAt(toks, j + 1);
    if (jsx && jsIs(t, '<') && next.t === 'id' && /^[A-Z]/.test(next.v) && jsJsxHere(prev)) {
      const after = jsAt(toks, j + 2);
      if (!jsIs(after, '.') && !jsIs(after, ',') && after.v !== 'extends' && !shadowed(j, next.v)) refs.push({ name: next.v, line: next.line });
      continue;
    }
    if (t.t !== 'id') continue;
    if (jsIs(prev, '@')) { refs.push({ name: jsDotted(toks, j).last.v, line: t.line }); j = jsDotted(toks, j).next - 1; continue; }
    if (prev.v === 'new' && prev.t === 'id') {
      const { last, next: after } = jsDotted(toks, j);
      if (last !== t || !shadowed(j, t.v)) refs.push({ name: last.v, line: last.line });
      j = after - 1;
      continue;
    }
    if (defs.has(j)) continue;
    const member = jsIs(prev, '.') || jsIs(prev, '?.');
    const call = jsIs(next, '(') || jsIs(next, '`') || jsIs(next, '?.') && jsIs(jsAt(toks, j + 2), '(');
    if (!call) {
      if (!member && bound.has(t.v) && jsUseAt(x, encl, j) && !shadowed(j, t.v)) refs.push({ name: t.v, line: t.line, use: true });
      continue;
    }
    if (!member && (JS_RESERVED.has(t.v) || prev.v === 'function' || jsIs(prev, '*') && jsAt(toks, j - 2).v === 'function' || shadowed(j, t.v))) continue;
    const recv = member ? jsAt(toks, j - 2) : JS_NONE;
    if (member && recv.t === 'id' && JS_GLOBALS.has(recv.v) && !jsIs(jsAt(toks, j - 3), '.') && !x.modules.has(recv.v)) continue;
    // `name(args) {` in an object literal defines a method; it calls nothing
    if (jsIs(next, '(') && jsIs(jsAt(toks, jsMatch(toks, j + 1) + 1), '{')) continue;
    const ref = { name: t.v, line: t.line };
    const bare = !jsIs(jsAt(toks, j - 3), '.') && !jsIs(jsAt(toks, j - 3), '?.');
    // `ns.a(` on a whole imported module calls that module's a, not a method
    if (member && !(bare && recv.t === 'id' && x.modules.has(recv.v))) ref.member = true;
    if (member && bare && recv.v === 'this') ref.self = true;
    refs.push(ref);
  }
  // a name imported under another name is called or used by the name its own file defines
  for (const ref of refs) if (!ref.member && aliases.has(ref.name)) ref.name = aliases.get(ref.name);
  out.refs.push(...refs);
}

// an import that climbs out of the repository names no repo file
function jsNormalize(p) {
  const out = [];
  for (const part of p.split('/')) {
    if (part === '..') { if (!out.length) return null; out.pop(); }
    else if (part && part !== '.') out.push(part);
  }
  return out.join('/');
}

function jsHas(files, p) {
  let lo = 0, hi = files.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (files[mid] === p) return true;
    if (files[mid] < p) lo = mid + 1; else hi = mid - 1;
  }
  return false;
}

// a relative or root-relative spec to the repo file it names; a package (a bare spec) is not in the repo
function jsResolve(spec, fromPath, files) {
  if (typeof spec !== 'string' || !(spec.startsWith('.') || spec.startsWith('/'))) return null;
  const dir = fromPath.includes('/') ? fromPath.slice(0, fromPath.lastIndexOf('/')) : '';
  const clean = spec.replace(/[?#].*$/, '');
  const base = jsNormalize(clean.startsWith('/') ? clean : `${dir}/${clean}`);
  if (base === null) return null;
  const ext = /\.[^./]+$/.exec(base), tries = [];
  if (base) tries.push(base, ...JS_PROBE.map((e) => base + e));
  if (ext && JS_SWAP[ext[0]]) tries.splice(1, 0, ...JS_SWAP[ext[0]].map((e) => base.slice(0, -ext[0].length) + e));
  tries.push(...JS_PROBE.map((e) => `${base ? `${base}/` : ''}index${e}`));
  return tries.find((p) => jsHas(files, p)) || null;
}

export const jsLang = {
  id: 'js',
  exts: JS_EXTS,
  // a name reaches another file only through an import, so a call is never matched to another file by name alone
  moduleScope: true,
  extract: jsExtract,
  resolve: jsResolve,
};
