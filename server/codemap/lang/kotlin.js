// Kotlin: comments (block comments nest) and string contents are blanked first, keeping line numbers. Declarations are
// read at paren depth 0 and at the member depth that braces give, so a parameter list or a body never reads as members.

const ktCallSkip = new Set(['if', 'when', 'while', 'for', 'catch', 'return', 'throw', 'super', 'this']);
const ktTypeRe = /^(\s*(?:@[\w.]+(?:\([^)]*\))?\s+)*)((?:(?:public|private|protected|internal|open|abstract|final|sealed|data|inner|annotation|value|enum|companion|const|fun|override)\s+)*)(class|interface|object)\b(?:\s+([A-Za-z_]\w*))?/;
const ktFunRe = /^(\s*(?:@[\w.]+(?:\([^)]*\))?\s+)*)((?:(?:public|private|protected|internal|open|override|abstract|final|suspend|inline|infix|operator|tailrec|external|actual|expect)\s+)*)fun\s+(?:<[^>]*>\s*)?(?:([\w$.<>?, ]+?)\.)?([A-Za-z_]\w*)\s*\(/;
const ktValRe = /^(\s*(?:@[\w.]+(?:\([^)]*\))?\s+)*)((?:(?:public|private|protected|internal|const|lateinit|override|open|final)\s+)*)(val|var)\s+([A-Za-z_]\w*)(?=\s*(?:[:=]|$|by\b))/;
const ktImportRe = /^\s*import\s+([\w$.]+(?:\.\*)?)(?:\s+as\s+[\w$]+)?\s*;?\s*$/;
// Explicit type arguments (mutableListOf<Line>()) are part of the call.
const ktCallRe = /(?<![@\w$])([A-Za-z_$][\w$]*)\s*(?:<[^()<>]*>\s*)?\(/g;
const ktAnnotationRe = /@((?:[A-Za-z_]\w*\.)*[A-Za-z_]\w*)(?!\s*:)/g;
const ktIndexes = new WeakMap();

function ktStrip(text) {
  const out = [];
  const n = text.length;
  const blankKeepLines = (s) => s.replace(/[^\n]/g, ' ');
  let i = 0;
  while (i < n) {
    const c = text[i];
    if (c === '/' && text[i + 1] === '/') {
      const end = text.indexOf('\n', i);
      const stop = end === -1 ? n : end;
      out.push(blankKeepLines(text.slice(i, stop)));
      i = stop;
    } else if (c === '/' && text[i + 1] === '*') {
      // Kotlin block comments nest: a '/*' inside a comment opens another level.
      let level = 1;
      let j = i + 2;
      while (j < n && level > 0) {
        if (text[j] === '/' && text[j + 1] === '*') {
          level += 1;
          j += 2;
        } else if (text[j] === '*' && text[j + 1] === '/') {
          level -= 1;
          j += 2;
        } else {
          j += 1;
        }
      }
      out.push(blankKeepLines(text.slice(i, j)));
      i = j;
    } else if (text.startsWith('"""', i)) {
      // A raw string has no escapes, so it ends at the next triple quote.
      const close = text.indexOf('"""', i + 3);
      const stop = close === -1 ? n : close + 3;
      out.push(`""${text.slice(i, stop).replace(/[^\n]/g, '')}`);
      i = stop;
    } else if (c === '"' || c === "'") {
      // A string or char literal ends at its quote or at the line end, so a bad literal cannot hide later lines.
      let j = i + 1;
      while (j < n && text[j] !== c && text[j] !== '\n') j += text[j] === '\\' && text[j + 1] !== '\n' ? 2 : 1;
      out.push(c + c);
      i = j < n && text[j] === c ? j + 1 : Math.min(j, n);
    } else {
      out.push(c);
      i += 1;
    }
  }
  return out.join('');
}

function ktBlankSpan(code, start, end) {
  return code.slice(0, start) + ' '.repeat(end - start) + code.slice(end);
}

function ktLast(qualified) {
  return qualified.slice(qualified.lastIndexOf('.') + 1).trim();
}

// The supertypes after the colon of a class header. Generic arguments and parenthesized parts go first: the primary
// constructor's parameters, and the arguments of a base call such as Base(x), hold colons and commas of their own.
function ktBases(header) {
  let h = header;
  while (/<[^<>]*>/.test(h)) h = h.replace(/<[^<>]*>/g, '');
  while (/\([^()]*\)/.test(h)) h = h.replace(/\([^()]*\)/g, '');
  const colon = h.indexOf(':');
  if (colon === -1) return [];
  const bases = [];
  for (const part of h.slice(colon + 1).split(',')) {
    const m = /^\s*([A-Za-z_][\w$.]*)/.exec(part);
    if (m) bases.push(ktLast(m[1]));
  }
  return bases;
}

function ktRefNames(code) {
  const names = [];
  for (const m of code.matchAll(ktCallRe)) if (!ktCallSkip.has(m[1])) names.push(m[1]);
  for (const m of code.matchAll(ktAnnotationRe)) names.push(ktLast(m[1]));
  return names;
}

// One sorted array per build: index it once per array.
function ktFileIndex(files) {
  let index = ktIndexes.get(files);
  if (!index) {
    index = { paths: new Set(files), byName: new Map() };
    for (const p of files) {
      const base = p.slice(p.lastIndexOf('/') + 1);
      const list = index.byName.get(base);
      if (list) list.push(p);
      else index.byName.set(base, [p]);
    }
    ktIndexes.set(files, index);
  }
  return index;
}

// Kotlin files may hold any declarations, so a class is looked up by its path. Java files in a mixed repo are
// found too: a Kotlin app imports the Java classes next to it.
function ktFindFile(qualified, index) {
  for (const ext of ['.kt', '.java']) {
    const rel = `${qualified.replace(/\./g, '/')}${ext}`;
    if (index.paths.has(rel)) return rel;
    for (const root of ['src/main/kotlin/', 'src/main/java/', 'src/']) {
      if (index.paths.has(root + rel)) return root + rel;
    }
    const tail = `/${rel}`;
    const candidates = index.byName.get(rel.slice(rel.lastIndexOf('/') + 1)) ?? [];
    const hit = candidates.find((p) => p.endsWith(tail));
    if (hit) return hit;
  }
  return null;
}

export const kotlinLang = {
  id: 'kotlin',
  exts: ['.kt', '.kts'],
  extract(text) {
    const lines = ktStrip(String(text ?? '')).split('\n');
    const symbols = [];
    const imports = [];
    const refs = [];
    const extended = [];
    const seenRefs = new Set();
    const types = []; // open type bodies, innermost last; a companion object reuses its owner's name
    let pending = null; // a type header whose body may not come
    let depth = 0;
    let parens = 0;

    const addRef = (name, line) => {
      const key = `${line} ${name}`;
      if (seenRefs.has(key)) return;
      seenRefs.add(key);
      refs.push({ name, line });
    };
    const headerDone = (open) => {
      if (open.skip) return;
      for (const base of ktBases(open.header)) {
        extended.push({ name: open.full, base, line: open.line });
        addRef(base, open.line);
      }
    };
    const openBody = (open) => {
      types.push({ full: open.full, bodyDepth: depth, skip: open.skip });
      headerDone(open);
    };

    lines.forEach((code, index) => {
      const line = index + 1;
      // A header with no body ends at its line unless the next line continues it: a ':' or '{' or 'where'.
      if (pending && pending.ready && code.trim() !== '' && !/^\s*(\{|:|where\b)/.test(code)) {
        headerDone(pending);
        pending = null;
      }
      const top = types.at(-1);
      const atMembers = parens === 0 && depth === (top ? top.bodyDepth : 0);
      let refText = code;
      let scanFrom = 0;

      const im = ktImportRe.exec(code);
      if (im) imports.push({ spec: im[1], line, names: im[1].endsWith('*') ? [] : [ktLast(im[1])] });

      if (!pending && atMembers) {
        const type = ktTypeRe.exec(code);
        const fun = type ? null : ktFunRe.exec(code);
        const val = type || fun ? null : ktValRe.exec(code);
        if (type) {
          const named = type[4] !== undefined;
          const companion = /\bcompanion\b/.test(type[2]);
          if (named || (companion && top)) {
            const full = named ? (top ? `${top.full}.${type[4]}` : type[4]) : top.full;
            const skip = named ? types.length >= 2 : top.skip;
            const kind = type[3] === 'interface' ? 'type' : /\benum\b/.test(type[2]) ? 'enum' : 'class';
            if (named && !skip) symbols.push({ name: full, kind, line, exported: !/\b(private|internal)\b/.test(type[2]) });
            pending = { full, skip, line, header: '', ready: false };
            refText = ktBlankSpan(code, type[1].length, type[0].length);
            scanFrom = type[0].length;
          }
        } else if (fun) {
          refText = ktBlankSpan(code, fun[1].length, fun[0].length);
          const receiver = fun[3] ? ktLast(fun[3].replace(/<[^>]*>/g, '')) : null;
          if (!top?.skip) {
            const name = receiver ? `${receiver}.${fun[4]}` : top ? `${top.full}.${fun[4]}` : fun[4];
            const kind = receiver || top ? 'method' : 'fn';
            symbols.push({ name, kind, line, exported: !/\b(private|internal)\b/.test(fun[2]) });
          }
        } else if (val) {
          const isConst = /\bconst\b/.test(val[2]);
          const exported = !/\b(private|internal)\b/.test(val[2]);
          if (!top) {
            symbols.push({ name: val[4], kind: val[3] === 'var' && !isConst ? 'var' : 'const', line, exported });
          } else if (isConst && !top.skip) {
            symbols.push({ name: `${top.full}.${val[4]}`, kind: 'const', line, exported });
          }
        }
      }

      for (const name of ktRefNames(refText)) addRef(name, line);

      for (let k = scanFrom; k < code.length; k += 1) {
        const ch = code[k];
        if (ch === '{') {
          depth += 1;
          if (pending) {
            openBody(pending);
            pending = null;
          }
          continue;
        }
        if (pending) pending.header += ch;
        if (ch === '}') {
          depth -= 1;
          while (types.length && types.at(-1).bodyDepth > depth) types.pop();
        } else if (ch === '(') {
          parens += 1;
        } else if (ch === ')') {
          parens = Math.max(0, parens - 1);
        }
      }
      if (pending) {
        pending.header += ' ';
        pending.ready = parens === 0 && !/[:,(]\s*$/.test(code);
      }
    });
    if (pending) headerDone(pending);
    // A supertype is found when its header closes, which can be after the lines that follow it.
    refs.sort((a, b) => a.line - b.line);

    return { symbols, imports, refs, extends: extended };
  },
  resolve(spec, fromPath, files) {
    if (spec.endsWith('*')) return null;
    const index = ktFileIndex(files);
    const found = ktFindFile(spec, index);
    if (found) return found;
    // A nested class or a top-level member names its file: a.b.C.Inner is found in a/b/C.kt.
    const dot = spec.lastIndexOf('.');
    return dot > 0 ? ktFindFile(spec.slice(0, dot), index) : null;
  },
};
