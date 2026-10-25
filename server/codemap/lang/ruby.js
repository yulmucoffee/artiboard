// Ruby symbols, requires, includes and superclasses, read from one file's text with no parser. Comments, =begin
// blocks, heredoc bodies and string literals are blanked first, so a def inside a heredoc never becomes a symbol.
// Blanking keeps every column and line, so the line numbers in the results are the file's own.

const RB_KEYWORDS = new Set([
  'BEGIN', 'END', 'alias', 'and', 'begin', 'break', 'case', 'class', 'def', 'defined?', 'do', 'else', 'elsif', 'end',
  'ensure', 'false', 'for', 'if', 'in', 'module', 'next', 'nil', 'not', 'or', 'redo', 'rescue', 'retry', 'return',
  'self', 'super', 'then', 'true', 'undef', 'unless', 'until', 'when', 'while', 'yield',
]);

// A comment, a string, a %-literal, a regex, or the start of a heredoc. Each one stays on its line; the body of a
// heredoc spans lines and is blanked by rbStrip.
const RB_LITERAL = /#.*$|'(?:\\.|[^'\\])*'?|"(?:\\.|[^"\\])*"?|`(?:\\.|[^`\\])*`?|%[qQwWiIsr]?(?:\((?:\\.|[^)\\])*\)|\[(?:\\.|[^\]\\])*\]|\{(?:\\.|[^}\\])*\}|<(?:\\.|[^>\\])*>|\|(?:\\.|[^|\\])*\||!(?:\\.|[^!\\])*!)|(?<![\w)\]])\/(?![\s=])(?:\\.|[^\/\\])*\/[a-z]*|<<[~-]?(?:(["'`])[A-Za-z_]\w*\1|[A-Z_]\w*)/g;
const RB_WORD = /[A-Za-z_]\w*[?!]?/g;
const RB_CLASS = /^class\s+((?:::)?[A-Z]\w*(?:::[A-Z]\w*)*)(?:\s*<\s*((?:::)?[A-Z]\w*(?:::[A-Z]\w*)*))?/;
const RB_MODULE = /^module\s+((?:::)?[A-Z]\w*(?:::[A-Z]\w*)*)/;
const RB_DEF = /^def\s+(?:self\.|[A-Z]\w*\.)?([A-Za-z_]\w*[?!=]?)/;
// An endless method, `def name(args) = expr`, has no end keyword; a setter `def name=(v)` is not one.
const RB_ENDLESS = /^def\s+(?:self\.|[A-Z]\w*\.)?[^\s(]+(?:\s*\([^)]*\))?\s+=(?![=~>])/;
const RB_BLOCK_WORDS = new Set(['if', 'unless', 'while', 'until', 'case', 'begin', 'for']);
const RB_REQUIRE_WORDS = new Set(['require', 'require_relative', 'load']);
// `Name.new` names the constant; `name(` names the call. The second alternative skips a def's own name.
const RB_REF = /(?<![\w@$])((?:[A-Z]\w*::)*[A-Z]\w*)\.new\b|(?<![\w@$])(?<!\bdef\s+(?:self\.|[A-Z]\w*\.)?)([A-Za-z_]\w*[?!]?)\(/g;
const RB_INCLUDE = /^\s*((?:::)?[A-Z]\w*(?:::[A-Z]\w*)*)\s*$/;

// The resolver runs once per require with the same list, so the set is built once per list.
const rbFileSets = new WeakMap();

// Keeps the length of a token so that columns in the stripped line still match the raw line. A string keeps its
// quotes, so `"x" if y` still reads as a modifier after the string.
function rbMask(token) {
  if (token.length < 2) return token;
  const last = token[token.length - 1];
  return token[0] + ' '.repeat(token.length - 2) + (/\w/.test(last) ? ' ' : last);
}

function rbStripLine(line, heredocs) {
  return line.replace(RB_LITERAL, (token) => {
    if (token.startsWith('<<')) {
      heredocs.push(token.replace(/^<<[~-]?|["'`]/g, ''));
      return ' '.repeat(token.length);
    }
    if (token.startsWith('#')) return ' '.repeat(token.length);
    return rbMask(token);
  });
}

// A heredoc is taken only when its terminator line exists; a stray `<<CONST` must not blank the rest of the file.
function rbStrip(lines) {
  const pending = []; // terminators of heredocs whose bodies have started, in order
  let inComment = false;
  let ended = false;
  return lines.map((raw, index) => {
    const blank = ' '.repeat(raw.length);
    if (ended) return blank;
    if (pending.length > 0) {
      if (raw.trim() === pending[0]) pending.shift();
      return blank;
    }
    if (inComment) {
      if (/^=end\b/.test(raw)) inComment = false;
      return blank;
    }
    if (/^=begin\b/.test(raw)) {
      inComment = true;
      return blank;
    }
    if (/^__END__\s*$/.test(raw)) {
      ended = true;
      return blank;
    }
    const heredocs = [];
    const code = rbStripLine(raw, heredocs);
    for (const id of heredocs) {
      if (lines.slice(index + 1).some((later) => later.trim() === id)) pending.push(id);
    }
    return code;
  });
}

// Identifiers that are not keywords here: after a dot (a method), after a colon (a symbol), or as a hash label.
function rbWords(line) {
  const words = [];
  for (const match of line.matchAll(RB_WORD)) {
    const word = match[0];
    const at = match.index;
    const before = line[at - 1];
    if (before === '.' || before === ':' || before === '@' || before === '$') continue;
    if (line[at + word.length] === ':' && line[at + word.length + 1] !== ':') continue;
    words.push({ word, at });
  }
  return words;
}

// A keyword that opens a block only starts a statement; after a value it is a modifier (`x if y`).
function rbStartsStatement(line, at) {
  const before = line.slice(0, at).trimEnd();
  return before === '' || /(?:[=(\[{,;&|!<>+\-*\/%?]|\b(?:then|else|do))$/.test(before);
}

function rbLast(name) {
  return name.split('::').pop();
}

// A def is a symbol only when every open block around it is a class, module or singleton class.
function rbScopeOnly(stack) {
  return stack.every((block) => block.type === 'class' || block.type === 'module' || block.type === 'sclass');
}

// The class or module a method belongs to. A singleton class is transparent: `class << self` defines the
// class's own methods.
function rbOwner(stack) {
  for (let k = stack.length - 1; k >= 0; k -= 1) {
    if (stack[k].type === 'sclass') continue;
    return stack[k].type === 'class' || stack[k].type === 'module' ? stack[k] : null;
  }
  return null;
}

function rbScan(raw, code) {
  const symbols = [];
  const imports = [];
  const refs = [];
  const extendsList = [];
  const stack = [];

  code.forEach((line, index) => {
    const number = index + 1;
    const constant = /^\s*([A-Z]\w*)\s*=(?![=~>])/.exec(line);
    if (constant && rbScopeOnly(stack)) {
      const owner = rbOwner(stack);
      const name = owner ? `${owner.name}.${constant[1]}` : constant[1];
      symbols.push({ name, kind: 'const', line: number, exported: true });
    }

    for (const { word, at } of rbWords(line)) {
      const rest = line.slice(at);
      if (word === 'end') {
        stack.pop();
      } else if (word === 'class') {
        if (/^class\s*<</.test(rest)) {
          stack.push({ type: 'sclass', name: '' });
        } else {
          const head = RB_CLASS.exec(rest);
          const name = head ? rbLast(head[1]) : '';
          if (head && rbScopeOnly(stack)) symbols.push({ name, kind: 'class', line: number, exported: true });
          if (head && head[2]) extendsList.push({ name, base: rbLast(head[2]), line: number });
          stack.push({ type: 'class', name });
        }
      } else if (word === 'module') {
        const head = RB_MODULE.exec(rest);
        const name = head ? rbLast(head[1]) : '';
        if (head && rbScopeOnly(stack)) symbols.push({ name, kind: 'module', line: number, exported: true });
        stack.push({ type: 'module', name });
      } else if (word === 'def') {
        const head = RB_DEF.exec(rest);
        if (head && rbScopeOnly(stack)) {
          const owner = rbOwner(stack);
          const symbol = owner
            ? { name: `${owner.name}.${head[1]}`, kind: 'method' }
            : { name: head[1], kind: 'fn' };
          symbols.push({ ...symbol, line: number, exported: true });
        }
        if (!RB_ENDLESS.test(rest)) stack.push({ type: 'def', name: '' });
      } else if (word === 'do') {
        // `while x do` and `for x in y do` share one end with the loop keyword.
        if (!/\b(?:while|until|for)\b/.test(line.slice(0, at))) stack.push({ type: 'block', name: '' });
      } else if (RB_BLOCK_WORDS.has(word) && rbStartsStatement(line, at)) {
        stack.push({ type: 'block', name: '' });
      } else if (RB_REQUIRE_WORDS.has(word) && rbStartsStatement(line, at)) {
        // The spec is a string literal, which the stripped line has blanked; the raw line keeps it at the same columns.
        const arg = /^\s*\(?\s*(['"])([^'"]+)\1/.exec(raw[index].slice(at + word.length));
        if (arg) imports.push({ spec: arg[2], line: number });
      } else if ((word === 'include' || word === 'extend') && rbStartsStatement(line, at)) {
        const owner = rbOwner(stack);
        if (owner && owner.name) {
          for (const part of line.slice(at + word.length).split(',')) {
            const mod = RB_INCLUDE.exec(part);
            if (mod) extendsList.push({ name: owner.name, base: rbLast(mod[1]), line: number });
          }
        }
      }
    }

    const seen = new Set();
    const add = (name) => {
      if (seen.has(name)) return;
      seen.add(name);
      refs.push({ name, line: number });
    };
    for (const match of line.matchAll(RB_REF)) {
      if (match[1]) {
        add(rbLast(match[1]));
      } else if (match[2] !== 'new' && (line[match.index - 1] === '.' || !RB_KEYWORDS.has(match[2]))) {
        add(match[2]);
      }
    }
  });

  return { symbols, imports, refs, extends: extendsList };
}

function rbFileSet(files) {
  if (!files || typeof files !== 'object') return new Set();
  let set = rbFileSets.get(files);
  if (!set) {
    set = new Set(files);
    rbFileSets.set(files, set);
  }
  return set;
}

function rbDirOf(path) {
  const cut = path.lastIndexOf('/');
  return cut < 0 ? '' : path.slice(0, cut);
}

// Joins and removes `.` and `..`; null when the path climbs above the repository root.
function rbNormal(path) {
  if (path.startsWith('/')) return null;
  const parts = [];
  for (const part of path.split('/')) {
    if (part === '' || part === '.') continue;
    if (part === '..') {
      if (parts.length === 0) return null;
      parts.pop();
      continue;
    }
    parts.push(part);
  }
  return parts.join('/');
}

export const rubyLang = {
  id: 'ruby',
  exts: ['.rb'],

  extract(text) {
    const raw = String(text ?? '').replace(/\r\n?/g, '\n').split('\n');
    return rbScan(raw, rbStrip(raw));
  },

  // The spec does not say whether it came from require or require_relative, so the file's own directory is tried
  // first, then lib/, then the root. A spec that starts with a dot is always relative to the file.
  resolve(spec, fromPath, files) {
    if (typeof spec !== 'string' || spec === '' || spec.startsWith('/')) return null;
    const names = rbFileSet(files);
    const dir = rbDirOf(String(fromPath ?? ''));
    const bases = spec.startsWith('.') ? [dir] : [dir, 'lib', ''];
    for (const base of bases) {
      const joined = rbNormal([base, spec].filter(Boolean).join('/'));
      if (!joined) continue;
      const file = joined.endsWith('.rb') ? joined : `${joined}.rb`;
      if (names.has(file)) return file;
    }
    return null;
  },
};
