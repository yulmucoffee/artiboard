// C# for the code map. Comments and string contents are blanked first, so a commented-out class or a
// string that says "class Fake" is no symbol. Then one pass tracks braces and reads each header (the text
// since the last `{`, `}` or `;`), which is where declarations and calls are told apart.

const csModifiers = new Set(['public', 'private', 'protected', 'internal', 'static', 'abstract', 'sealed',
  'partial', 'readonly', 'virtual', 'override', 'async', 'extern', 'unsafe', 'new', 'file', 'ref',
  'volatile', 'required', 'const', 'delegate']);

// Words that start a statement or an expression. None of them is a return type or a called name.
const csKeywords = new Set(['if', 'for', 'foreach', 'while', 'switch', 'catch', 'using', 'lock', 'fixed',
  'return', 'throw', 'await', 'yield', 'else', 'do', 'case', 'goto', 'in', 'is', 'as', 'when', 'new', 'base',
  'this', 'typeof', 'sizeof', 'nameof', 'default', 'checked', 'unchecked', 'stackalloc', 'out', 'operator']);

const csTypeKinds = { class: 'class', struct: 'class', record: 'class', interface: 'type', enum: 'enum' };

// The name is the third capture; the `d` flag gives its place in the header.
const csTypeHead = /^\s*((?:(?:public|private|protected|internal|static|abstract|sealed|partial|readonly|unsafe|new|file|ref)\s+)*)(class|struct|interface|record|enum)\s+(?:(?:class|struct)\s+)?([A-Za-z_]\w*)/d;
const csUsing = /^\s*(?:global\s+)?using\s+(static\s+)?([A-Za-z_][\w.]*)\s*(?:=\s*([A-Za-z_][\w.]*)\s*)?$/;
const csConstField = /\bconst\s+[^=;()]*?([A-Za-z_]\w*)\s*(?:=|$)/d;
const csCall = /(?<!\w)([A-Za-z_]\w*)(?:<[\w.,<>[\]?]*>)?\s*\(/g;
const csAttribute = /\[([^[\]]*)\]/g;
// Sticky: a string literal starts at the position it is matched at.
const csStringStart = /(\$*)(@?)(\$*)("""+|")/y;

function csExtract(text) {
  const code = csBlankDirectives(csStrip(String(text ?? '')));
  const starts = csLineStarts(code);
  const lineAt = (pos) => csLineOf(starts, pos);
  const symbols = [];
  const imports = [];
  const extendsList = [];
  const declared = new Set();
  const stack = [];
  let from = 0;

  for (const delimiter of code.matchAll(/[{};]/g)) {
    const end = delimiter.index;
    const kind = delimiter[0];
    if (kind === '}') {
      stack.pop();
      from = end + 1;
      continue;
    }
    const header = csMask(code.slice(from, end));
    const top = stack[stack.length - 1];
    const moduleScope = !top || top.kind === 'ns';
    const classScope = top?.kind === 'type' && top.level === 1;
    const head = csHead(header);
    // A call's name is its own position; a declaration's name is not a call. Constructors have no
    // return type, so they are recognised by the enclosing type's name.
    if (head && (head.ret || (top?.kind === 'type' && head.name === top.qual?.split('.').pop()))) {
      declared.add(from + head.at);
    }

    if (kind === '{' && /^\s*namespace\b/.test(header)) {
      stack.push({ kind: 'ns' });
    } else if (kind === ';' && moduleScope && csUsing.test(header)) {
      // For `using X = A.B.C;` the target is what gets imported; the alias is only a local name.
      const using = csUsing.exec(header);
      const spec = using[3] ?? using[2];
      imports.push({ spec, line: lineAt(from + header.indexOf('using')), names: [spec.split('.').pop()] });
    } else {
      const type = csTypeHead.exec(header);
      if (type) {
        const name = type[3];
        const nameAt = type.indices[3][0];
        const level = moduleScope ? 1 : classScope ? 2 : 3;
        const qual = level === 1 ? name : level === 2 ? `${top.qual}.${name}` : null;
        const iface = type[2] === 'interface';
        if (level < 3) {
          const line = lineAt(from + nameAt);
          symbols.push({
            name: qual,
            kind: csTypeKinds[type[2]],
            line,
            exported: csExported(csWords(type[1]), level === 1 || (classScope && top.iface)),
          });
          // An enum's colon names its underlying integer type, not a base.
          if (type[2] !== 'enum') {
            for (const base of csBases(header.slice(nameAt + name.length))) {
              extendsList.push({ name: qual, base, line });
            }
          }
        }
        if (kind === '{') stack.push({ kind: 'type', level, qual, iface });
      } else {
        if (classScope) {
          const member = csMember(header, kind);
          if (member) {
            symbols.push({
              name: `${top.qual}.${member.name}`,
              kind: member.kind,
              line: lineAt(from + member.at),
              exported: csExported(member.mods, top.iface),
            });
          }
        }
        if (kind === '{') stack.push({ kind: 'body' });
      }
    }
    from = end + 1;
  }

  const found = [];
  for (const call of code.matchAll(csCall)) {
    if (!csKeywords.has(call[1]) && !declared.has(call.index)) found.push({ name: call[1], at: call.index });
  }
  for (const attr of code.matchAll(csAttribute)) {
    if (!csAttributeHere(code, attr.index, attr.index + attr[0].length)) continue;
    for (const name of csAttributeNames(attr[1])) found.push({ name, at: attr.index });
  }
  found.sort((a, b) => a.at - b.at);
  const seen = new Set();
  const refs = [];
  for (const { name, at } of found) {
    const line = lineAt(at);
    if (seen.has(`${line} ${name}`)) continue;
    seen.add(`${line} ${name}`);
    refs.push({ name, line });
  }

  return { symbols, imports, refs, extends: extendsList };
}

// A class-level declaration. `;` ends a const, a field, an abstract method or an expression body;
// `{` ends a method body, a constructor or a property with accessors.
function csMember(header, end) {
  const konst = csConstField.exec(header);
  if (konst && end === ';') {
    const at = konst.indices[1][0];
    return { kind: 'const', name: konst[1], at, mods: csWords(header.slice(0, at)) };
  }
  const arrow = header.indexOf('=>');
  const paren = header.indexOf('(');
  if (end === ';' && arrow >= 0 && (paren < 0 || paren > arrow)) {
    const prop = csPropertyHead(header.slice(0, arrow));
    return prop ? { ...prop, kind: 'var' } : null;
  }
  if (paren >= 0) {
    const head = csHead(header);
    return head?.ret && !head.mods.includes('delegate') ? { ...head, kind: 'method' } : null;
  }
  if (end === '{') {
    const prop = csPropertyHead(header);
    return prop ? { ...prop, kind: 'var' } : null;
  }
  return null;
}

// `<return type> Name(` at the end of the text before the first `(`. A field initializer is not a
// method (`=` before the paren). A call is not one either: `Console.WriteLine(` follows a dot and
// `return Foo(` follows a keyword. With no return type left, the shape is a constructor's.
function csHead(header) {
  const paren = header.indexOf('(');
  if (paren < 0) return null;
  const pre = header.slice(0, paren);
  if (pre.includes('=')) return null;
  const named = /([A-Za-z_]\w*)\s*(?:<[^<>]*>\s*)?$/.exec(pre);
  if (!named) return null;
  const before = pre.slice(0, named.index);
  if (before && !/\s$/.test(before)) return null;
  const words = csWords(before);
  const rest = words.filter((word) => !csModifiers.has(word));
  if (rest.length && csKeywords.has(rest[rest.length - 1])) return null;
  return {
    name: named[1],
    at: named.index,
    mods: words.filter((word) => csModifiers.has(word)),
    ret: rest.length > 0,
  };
}

// A property is `Type Name` with no paren and no `=` before its `{` or `=>`.
function csPropertyHead(pre) {
  if (pre.includes('=') || pre.includes('(')) return null;
  const named = /([A-Za-z_]\w*)\s*$/.exec(pre);
  if (!named) return null;
  const before = pre.slice(0, named.index);
  const words = csWords(before);
  const rest = words.filter((word) => !csModifiers.has(word));
  if (!/\s$/.test(before) || !rest.length || csKeywords.has(rest[rest.length - 1])) return null;
  return { name: named[1], at: named.index, mods: words.filter((word) => csModifiers.has(word)) };
}

// Public and internal are exported. A type with no modifier is internal, so exported; a member with
// none is private, except in an interface, where members are public (defaultOn).
function csExported(mods, defaultOn) {
  if (mods.includes('file')) return false;
  if (mods.includes('public') || mods.includes('internal')) return true;
  return Boolean(defaultOn) && !mods.includes('private') && !mods.includes('protected');
}

// Base types: the list after the first colon, up to `where`, with generic arguments removed.
function csBases(tail) {
  const colon = tail.indexOf(':');
  if (colon < 0) return [];
  let list = tail.slice(colon + 1).split(/\bwhere\b/)[0];
  while (/<[^<>]*>/.test(list)) list = list.replace(/<[^<>]*>/g, '');
  return list
    .split(',')
    .map((item) => /([A-Za-z_]\w*)\s*$/.exec(item)?.[1])
    .filter(Boolean);
}

// An attribute counts only where one starts: after a statement end, a brace, a comma, a paren or
// another attribute, and before a declaration. `grid[i][j];` is an index, not an attribute.
function csAttributeHere(code, start, end) {
  let before = start - 1;
  while (before >= 0 && /\s/.test(code[before])) before--;
  let after = end;
  while (after < code.length && /\s/.test(code[after])) after++;
  const opensHere = before < 0 || ';{},()]}'.includes(code[before]);
  return opensHere && /[A-Za-z_@[]/.test(code[after] ?? '');
}

// The last segment of each attribute name, with any `target:` prefix and arguments dropped.
function csAttributeNames(group) {
  const items = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < group.length; i++) {
    if (group[i] === '(') depth++;
    else if (group[i] === ')') depth--;
    else if (group[i] === ',' && depth === 0) {
      items.push(group.slice(start, i));
      start = i + 1;
    }
  }
  items.push(group.slice(start));
  return items
    .map((item) => /^\s*(?:[A-Za-z_]\w*\s*:\s*)?([A-Za-z_][\w.]*)/.exec(item)?.[1])
    .filter(Boolean)
    .map((name) => name.split('.').pop());
}

// Attribute lists become spaces of the same length, so a header keeps the code's offsets and an
// attribute's brackets cannot look like a parameter list or a body.
function csMask(header) {
  return header.replace(/\[[^[\]]*\]/g, (match) => ' '.repeat(match.length));
}

function csWords(text) {
  return text.split(/\s+/).filter(Boolean);
}

function csBlankDirectives(code) {
  return code
    .split('\n')
    .map((line) => (/^\s*#/.test(line) ? '' : line))
    .join('\n');
}

function csLineStarts(text) {
  const starts = [0];
  for (let i = text.indexOf('\n'); i >= 0; i = text.indexOf('\n', i + 1)) starts.push(i + 1);
  return starts;
}

function csLineOf(starts, pos) {
  let lo = 0;
  let hi = starts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (starts[mid] <= pos) lo = mid;
    else hi = mid - 1;
  }
  return lo + 1;
}

// Comments become spaces and string literals become `""`, keeping every newline so line numbers hold.
function csStrip(text) {
  let out = '';
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    if (c === '/' && text[i + 1] === '/') {
      const end = text.indexOf('\n', i);
      const stop = end < 0 ? text.length : end;
      out += ' '.repeat(stop - i);
      i = stop;
      continue;
    }
    if (c === '/' && text[i + 1] === '*') {
      const end = text.indexOf('*/', i + 2);
      const stop = end < 0 ? text.length : end + 2;
      out += text.slice(i, stop).replace(/[^\n]/g, ' ');
      i = stop;
      continue;
    }
    const end = c === '"' || c === '$' || c === '@' ? csStringEnd(text, i) : -1;
    if (end > i) {
      out += `""${text.slice(i, end).replace(/[^\n]/g, '')}`;
      i = end;
      continue;
    }
    if (c === "'") {
      // A character literal; an unclosed one stops at the line end so it cannot swallow the file.
      let j = i + 1;
      while (j < text.length && text[j] !== "'" && text[j] !== '\n') j += text[j] === '\\' ? 2 : 1;
      out += "''";
      i = text[j] === "'" ? j + 1 : j;
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

// The index just past the string literal that starts at `start`, or -1 when none starts there.
// Verbatim (@) strings have no escapes and may span lines; interpolation holes may hold strings.
function csStringEnd(text, start) {
  csStringStart.lastIndex = start;
  const m = csStringStart.exec(text);
  if (!m) return -1;
  const interpolated = m[1] !== '' || m[3] !== '';
  const verbatim = m[2] === '@';
  const quotes = m[4];
  let j = start + m[0].length;
  if (quotes.length > 1) {
    const close = text.indexOf(quotes, j);
    return close < 0 ? text.length : close + quotes.length;
  }
  while (j < text.length) {
    const c = text[j];
    if (c === '\n' && !verbatim) return j;
    if (c === '\\' && !verbatim) {
      j += 2;
      continue;
    }
    if (interpolated && c === '{') {
      if (text[j + 1] === '{') j += 2;
      else j = csHoleEnd(text, j + 1);
      continue;
    }
    if (c === '"') {
      if (verbatim && text[j + 1] === '"') {
        j += 2;
        continue;
      }
      return j + 1;
    }
    j++;
  }
  return text.length;
}

// The index just past the `}` that closes an interpolation hole, skipping strings inside it.
function csHoleEnd(text, j) {
  let depth = 0;
  while (j < text.length) {
    const c = text[j];
    if (c === '"' || c === '$' || c === '@') {
      const end = csStringEnd(text, j);
      if (end > j) {
        j = end;
        continue;
      }
    }
    if (c === '{') depth++;
    else if (c === '}') {
      if (depth === 0) return j + 1;
      depth--;
    }
    j++;
  }
  return text.length;
}

// A using names a namespace, which is a directory in the repo, not a file. The first file whose
// directory, written with dots, ends with the namespace on a dot boundary is taken to define it.
// fromPath is not used: a namespace is the same everywhere in the project.
function csResolve(spec, fromPath, files) {
  if (!spec) return null;
  for (const file of files) {
    const slash = file.lastIndexOf('/');
    if (!file.endsWith('.cs') || slash < 0) continue;
    const dotted = file.slice(0, slash).replace(/\//g, '.');
    if (dotted === spec || dotted.endsWith(`.${spec}`)) return file;
  }
  return null;
}

export const csharpLang = {
  id: 'csharp',
  exts: ['.cs'],
  extract: csExtract,
  resolve: csResolve,
};
