// Swift for the code map. Comments and string literals are blanked first. Swift ends a statement at a
// newline, not at `;`, so declarations are read line by line, and braces are counted across lines to
// know which scope each line is in.

const swTypeKinds = { class: 'class', struct: 'class', enum: 'enum', protocol: 'type', extension: 'type' };

// Words that start a statement or a declaration. None of them is a called name.
const swKeywords = new Set(['if', 'guard', 'while', 'for', 'switch', 'return', 'catch', 'throw', 'in', 'where',
  'else', 'repeat', 'init', 'self', 'super', 'try', 'await', 'as', 'is', 'subscript', 'case', 'func', 'defer']);

// Attributes, modifiers, the keyword, the name. `class func f()` is the modifier `class` on a func.
const swDecl = /^\s*((?:@\w+(?:\([^)]*\))?\s+)*)((?:(?:public|open|internal|private|fileprivate|final|static|class|override|mutating|nonmutating|convenience|required|lazy|dynamic|indirect|weak|unowned)(?:\(set\))?\s+)*)(class|struct|enum|protocol|extension|typealias|func|let|var)\s+([A-Za-z_]\w*)/;
const swImport = /^\s*(?:@\w+\s+)*import\s+(?:(?:class|struct|enum|protocol|typealias|var|let|func)\s+)?([A-Za-z_][\w.]*)\s*$/;
// A name followed by `(`, not after `func` (a declaration) or `case` (an enum case).
const swCall = /(?<!\w)(?<!\b(?:func|case)\s+)([A-Za-z_]\w*)(?:<[\w.,<>[\]?]*>)?\s*\(/g;
const swAttribute = /(?<!\w)@([A-Za-z_]\w*)/g;

function swExtract(text) {
  const code = swStrip(String(text ?? ''));
  const lines = code.split('\n');
  const starts = swLineStarts(code);
  const symbols = [];
  const imports = [];
  const extendsList = [];
  const stack = [];
  // A type whose `{` comes on the next line; the brace line starts with `{`.
  let pending = null;

  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    const lineNo = index + 1;
    const top = stack[stack.length - 1];
    const moduleScope = stack.length === 0;
    const classScope = top?.kind === 'type' && top.level === 1;

    if (moduleScope) {
      const imported = swImport.exec(line);
      if (imported) imports.push({ spec: imported[1], line: lineNo, names: [] });
    }

    // The entry the first `{` of this line pushes; a body when null. A type header can run over lines
    // (a where clause on its own line), so its entry waits for the first `{` after it.
    let opening = null;
    if (pending && line.includes('{')) {
      opening = pending;
      pending = null;
    }

    const decl = swDecl.exec(line);
    if (decl) {
      const [, , mods, keyword, name] = decl;
      const exported = !/\b(?:private|fileprivate)\b/.test(mods.replace(/\w+\(set\)/g, ''));
      const isFunc = keyword === 'func';
      // `func` needs its parameter list on the same line; without one it is not a declaration.
      const callable = !isFunc || /^\s*[(<]/.test(line.slice(decl[0].length));
      if (swTypeKinds[keyword]) {
        const level = moduleScope ? 1 : classScope ? 2 : 3;
        const qual = level === 1 ? name : level === 2 ? `${top.qual}.${name}` : null;
        if (level < 3) {
          symbols.push({ name: qual, kind: swTypeKinds[keyword], line: lineNo, exported });
          // An enum's colon names its raw type, not a base.
          if (keyword !== 'enum') {
            for (const base of swBases(line.slice(decl[0].length))) {
              extendsList.push({ name: qual, base, line: lineNo });
            }
          }
        }
        const entry = { kind: 'type', level, qual };
        if (line.includes('{')) opening = entry;
        else pending = entry;
      } else if (keyword === 'typealias') {
        if (moduleScope) symbols.push({ name, kind: 'type', line: lineNo, exported });
      } else if (isFunc && callable) {
        if (moduleScope) symbols.push({ name, kind: 'fn', line: lineNo, exported });
        else if (classScope) symbols.push({ name: `${top.qual}.${name}`, kind: 'method', line: lineNo, exported });
      } else if (moduleScope && (keyword === 'let' || keyword === 'var')) {
        symbols.push({ name, kind: keyword === 'let' ? 'const' : 'var', line: lineNo, exported });
      }
    }

    for (const ch of line) {
      if (ch === '{') {
        stack.push(opening ?? { kind: 'body' });
        opening = null;
      } else if (ch === '}') {
        stack.pop();
      }
    }
  }

  const found = [];
  for (const call of code.matchAll(swCall)) {
    if (!swKeywords.has(call[1])) found.push({ name: call[1], at: call.index });
  }
  for (const attr of code.matchAll(swAttribute)) found.push({ name: attr[1], at: attr.index });
  found.sort((a, b) => a.at - b.at);
  const seen = new Set();
  const refs = [];
  for (const { name, at } of found) {
    const line = swLineOf(starts, at);
    if (seen.has(`${line} ${name}`)) continue;
    seen.add(`${line} ${name}`);
    refs.push({ name, line });
  }

  return { symbols, imports, refs, extends: extendsList };
}

// Base types after the first colon of a declaration. Generic arguments go first, so a constraint's
// colon inside `<T: Equatable>` is not taken; a `where` clause is cut off before the colon is searched.
function swBases(tail) {
  let text = tail.split('{')[0].split(/\bwhere\b/)[0];
  while (/<[^<>]*>/.test(text)) text = text.replace(/<[^<>]*>/g, '');
  const colon = text.indexOf(':');
  if (colon < 0) return [];
  return text
    .slice(colon + 1)
    .split(',')
    .map((item) => /([A-Za-z_]\w*)\s*$/.exec(item.trim())?.[1])
    .filter(Boolean);
}

function swLineStarts(text) {
  const starts = [0];
  for (let i = text.indexOf('\n'); i >= 0; i = text.indexOf('\n', i + 1)) starts.push(i + 1);
  return starts;
}

function swLineOf(starts, pos) {
  let lo = 0;
  let hi = starts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (starts[mid] <= pos) lo = mid;
    else hi = mid - 1;
  }
  return lo + 1;
}

// Comments (nested `/* */` too) become spaces and string literals become `""`, keeping every newline.
function swStrip(text) {
  let out = '';
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    if (c === '/' && text[i + 1] === '/') {
      const end = text.indexOf('\n', i);
      const stop = end < 0 ? text.length : end;
      out += ' '.repeat(stop - i);
      i = stop;
    } else if (c === '/' && text[i + 1] === '*') {
      let depth = 0;
      let j = i;
      while (j < text.length) {
        if (text[j] === '/' && text[j + 1] === '*') {
          depth++;
          j += 2;
        } else if (text[j] === '*' && text[j + 1] === '/') {
          depth--;
          j += 2;
          if (depth === 0) break;
        } else {
          j++;
        }
      }
      out += text.slice(i, j).replace(/[^\n]/g, ' ');
      i = j;
    } else if (c === '"') {
      const end = swStringEnd(text, i);
      out += `""${text.slice(i, end).replace(/[^\n]/g, '')}`;
      i = end;
    } else {
      out += c;
      i++;
    }
  }
  return out;
}

// The index just past the string literal at `start`. An interpolation `\( ... )` is skipped whole,
// so a string inside it does not end the literal early. A single-line string stops at its line end.
function swStringEnd(text, start) {
  const multi = text.startsWith('"""', start);
  let j = start + (multi ? 3 : 1);
  while (j < text.length) {
    const c = text[j];
    if (c === '\\') {
      j = text[j + 1] === '(' ? swInterpolationEnd(text, j + 2) : j + 2;
      continue;
    }
    if (multi && text.startsWith('"""', j)) return j + 3;
    if (!multi && c === '"') return j + 1;
    if (!multi && c === '\n') return j;
    j++;
  }
  return text.length;
}

function swInterpolationEnd(text, j) {
  let depth = 1;
  while (j < text.length) {
    const c = text[j];
    if (c === '"') {
      j = swStringEnd(text, j);
      continue;
    }
    if (c === '(') depth++;
    else if (c === ')') {
      depth--;
      if (depth === 0) return j + 1;
    }
    j++;
  }
  return text.length;
}

// Swift imports name modules, not files. A module's sources live under a directory with its name
// (Sources/<Module>/), so the first Swift file with such a directory on its path is the one taken.
// For `import struct Mod.Name` the first segment names the module; fromPath is not used.
function swResolve(spec, fromPath, files) {
  const moduleName = spec.split('.')[0];
  if (!moduleName) return null;
  for (const file of files) {
    if (!file.endsWith('.swift')) continue;
    const directories = file.split('/').slice(0, -1);
    if (directories.includes(moduleName)) return file;
  }
  return null;
}

export const swiftLang = {
  id: 'swift',
  exts: ['.swift'],
  extract: swExtract,
  resolve: swResolve,
};
