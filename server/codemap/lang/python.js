// Python symbols, imports, calls and base classes, read from one file's text with no parser. Comments and string
// literals are blanked first, so a commented-out def or a docstring that says "class Foo" never becomes a symbol.
// Blanking keeps every line and column, so the line numbers in the results are the file's own.

const PY_KEYWORDS = new Set([
  'False', 'None', 'True', 'and', 'as', 'assert', 'async', 'await', 'break', 'class', 'continue', 'def', 'del',
  'elif', 'else', 'except', 'finally', 'for', 'from', 'global', 'if', 'import', 'in', 'is', 'lambda', 'nonlocal',
  'not', 'or', 'pass', 'raise', 'return', 'try', 'while', 'with', 'yield',
]);

// A comment, or a string with an optional prefix. Triple quotes come first so that a single-quote pattern cannot
// end a triple-quoted string early.
const PY_LITERAL = /#[^\n]*|(?:(?<!\w)[rRbBuUfF]{1,2})?(?:'''[\s\S]*?'''|"""[\s\S]*?"""|'(?:\\.|[^'\\\n])*'|"(?:\\.|[^"\\\n])*")/g;
const PY_DEF = /^(?:async[ \t]+)?def[ \t]+([A-Za-z_]\w*)/;
const PY_CLASS = /^class[ \t]+([A-Za-z_]\w*)[ \t]*(?:\(([\s\S]*?)\))?[ \t]*:/;
const PY_ASSIGN = /^([A-Za-z_]\w*)[ \t]*(?::[^=\n]*)?=(?!=)/;
const PY_CONSTANT = /^_*[A-Z][A-Z0-9_]*$/;
const PY_DECORATOR = /^[ \t]*@[ \t]*([A-Za-z_][\w.]*)/;
const PY_CALL = /(?<!\w)(?<!\b(?:def|class)[ \t]+)([A-Za-z_]\w*)[ \t]*\(/g;
const PY_FROM = /^from[ \t]+(\.*[A-Za-z_][\w.]*|\.+)[ \t]+import\b([\s\S]*)$/;
const PY_IMPORT = /^import\b([\s\S]*)$/;
const PY_DOTTED = /^(?:[A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*)?$/;

// The resolver runs once per import with the same list, so the lookup tables are built once per list.
const pyIndexes = new WeakMap();

function pyBlank(text) {
  return text.replace(/\r\n?/g, '\n').replace(PY_LITERAL, (token) => token.replace(/[^\n]/g, ' '));
}

function pyBracketDelta(line) {
  let delta = 0;
  for (const char of line) {
    if ('([{'.includes(char)) delta += 1;
    else if (')]}'.includes(char)) delta -= 1;
  }
  return delta;
}

// A statement runs on past its first line while a bracket is open or the line ends in a backslash.
function pyStatement(lines, start) {
  let depth = 0;
  let end = start;
  for (;;) {
    depth += pyBracketDelta(lines[end]);
    const continues = depth > 0 || /\\[ \t]*$/.test(lines[end]);
    if (!continues || end + 1 >= lines.length) break;
    end += 1;
  }
  return { text: lines.slice(start, end + 1).join('\n'), end };
}

function pyNames(raw) {
  const names = raw
    .replace(/[()\\\n]/g, ' ')
    .split(',')
    .map((part) => part.trim().split(/\s+as\s+/)[0])
    .filter(Boolean);
  return names.includes('*') ? [] : names;
}

function pyBases(list) {
  let flat = list;
  while (/\[[^[\]]*\]/.test(flat)) flat = flat.replace(/\[[^[\]]*\]/g, '');
  return flat
    .split(',')
    .map((part) => part.trim())
    .filter((part) => /^[A-Za-z_][\w.]*$/.test(part))
    .map((part) => part.split('.').pop());
}

// A dunder like __init__ is the public constructor of its class, so it counts as exported.
function pyExported(name) {
  return !name.startsWith('_') || name === '__init__';
}

function pyDirOf(path) {
  const cut = path.lastIndexOf('/');
  return cut < 0 ? '' : path.slice(0, cut);
}

function pyIndex(files) {
  if (!files || typeof files !== 'object') return { paths: new Set(), srcPaths: new Map() };
  let index = pyIndexes.get(files);
  if (!index) {
    index = { paths: new Set(files), srcPaths: new Map() };
    for (const file of files) {
      // A src/ layout keeps the package one directory down, so the import names it without that directory.
      if (file.startsWith('src/') && !index.srcPaths.has(file.slice(4))) index.srcPaths.set(file.slice(4), file);
    }
    pyIndexes.set(files, index);
  }
  return index;
}

function pyModuleFile(lookup, base, dotted) {
  if (!dotted) return lookup([base, '__init__.py'].filter(Boolean).join('/'));
  const stem = [base, ...dotted.split('.')].filter(Boolean).join('/');
  return lookup(`${stem}.py`) ?? lookup(`${stem}/__init__.py`);
}

export const pythonLang = {
  id: 'python',
  exts: ['.py'],

  extract(text) {
    const lines = pyBlank(String(text ?? '')).split('\n');
    const symbols = [];
    const imports = [];
    const extendsList = [];
    const refs = [];
    let owner = null; // the module-level class whose body the current statement may sit in

    let i = 0;
    while (i < lines.length) {
      if (lines[i].trim() === '') {
        i += 1;
        continue;
      }
      const { text: statement, end } = pyStatement(lines, i);
      const line = i + 1;
      const indent = /^[ \t]*/.exec(lines[i])[0];
      i = end + 1;
      const head = statement.trimStart();

      if (indent === '') owner = null;
      else if (owner && owner.bodyIndent === null) owner.bodyIndent = indent;

      const fromImport = PY_FROM.exec(head);
      if (fromImport) {
        const names = pyNames(fromImport[2]);
        imports.push(names.length ? { spec: fromImport[1], line, names } : { spec: fromImport[1], line });
        continue;
      }
      const plainImport = PY_IMPORT.exec(head);
      if (plainImport) {
        for (const part of plainImport[1].split(',')) {
          const spec = /^\s*([A-Za-z_][\w.]*)/.exec(part);
          if (spec) imports.push({ spec: spec[1], line });
        }
        continue;
      }

      if (indent === '') {
        const classHead = PY_CLASS.exec(head);
        if (classHead) {
          const [, name, bases = ''] = classHead;
          owner = { name, bodyIndent: null };
          symbols.push({ name, kind: 'class', line, exported: pyExported(name) });
          for (const base of pyBases(bases)) extendsList.push({ name, base, line });
          continue;
        }
      }

      const def = PY_DEF.exec(head);
      if (def && indent === '') {
        symbols.push({ name: def[1], kind: 'fn', line, exported: pyExported(def[1]) });
      } else if (def && owner && indent === owner.bodyIndent) {
        symbols.push({ name: `${owner.name}.${def[1]}`, kind: 'method', line, exported: pyExported(def[1]) });
      } else if (indent === '') {
        const assign = PY_ASSIGN.exec(head);
        if (assign && !PY_KEYWORDS.has(assign[1])) {
          symbols.push({
            name: assign[1],
            kind: PY_CONSTANT.test(assign[1]) ? 'const' : 'var',
            line,
            exported: pyExported(assign[1]),
          });
        }
      }
    }

    lines.forEach((code, index) => {
      const seen = new Set();
      const add = (name) => {
        if (seen.has(name)) return;
        seen.add(name);
        refs.push({ name, line: index + 1 });
      };
      const decorator = PY_DECORATOR.exec(code);
      if (decorator) add(decorator[1].split('.').pop());
      for (const call of code.matchAll(PY_CALL)) {
        if (!PY_KEYWORDS.has(call[1])) add(call[1]);
      }
    });

    return { symbols, imports, refs, extends: extendsList };
  },

  resolve(spec, fromPath, files) {
    if (typeof spec !== 'string') return null;
    const dots = /^\.*/.exec(spec)[0].length;
    const dotted = spec.slice(dots);
    if (!PY_DOTTED.test(dotted) || (dots === 0 && dotted === '')) return null;
    const index = pyIndex(files);
    const exact = (path) => (index.paths.has(path) ? path : null);
    if (dots === 0) {
      return pyModuleFile(exact, '', dotted) ?? pyModuleFile((path) => index.srcPaths.get(path) ?? null, '', dotted);
    }
    let base = pyDirOf(String(fromPath ?? ''));
    for (let up = 1; up < dots; up += 1) {
      if (base === '') return null;
      base = pyDirOf(base);
    }
    return pyModuleFile(exact, base, dotted);
  },
};
