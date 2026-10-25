// Java: comments and string contents are blanked first, keeping line numbers. Each line is then read against the
// declaration shapes below. Braces give the member depth, so a method body never reads as a member.

const javaCallSkip = new Set([
  'if', 'for', 'while', 'switch', 'catch', 'synchronized', 'return', 'throw', 'new', 'super', 'this', 'assert', 'yield',
  'case', 'else', 'record',
]);
const javaKinds = { class: 'class', record: 'class', interface: 'type', '@interface': 'type', enum: 'enum' };
const javaTypeRe = /^(\s*(?:@[\w.]+(?:\([^)]*\))?\s+)*)((?:(?:public|protected|private|static|final|abstract|sealed|non-sealed|strictfp)\s+)*)(@interface|class|interface|enum|record)\s+([A-Za-z_$][\w$]*)/;
const javaMethodRe = /^(\s*(?:@[\w.]+(?:\([^)]*\))?\s+)*)((?:(?:public|protected|private|static|final|abstract|synchronized|native|default|strictfp)\s+)*)(?:<[^(){};=]*>\s*)?((?!(?:public|protected|private|static|final|abstract|synchronized|native|default|strictfp)\b)[\w$.]+(?:<[^(){};=]*>)?(?:\[\])*)\s+([\w$]+)(?=\s*\()/;
const javaFieldRe = /^\s*(?:@[\w.]+(?:\([^)]*\))?\s+)*((?:(?:public|protected|private|static|final|transient|volatile)\s+)+)[\w$.]+(?:<[^(){};=]*>)?(?:\[\])*\s+([\w$]+)\s*[=;]/;
const javaCtorRe = /^\s*(?:(?:public|protected|private)\s+)?([A-Za-z_$][\w$]*)\s*\(/;
const javaImportRe = /^\s*import\s+(static\s+)?([\w$.*]+)\s*;/;
const javaCallRe = /(?<![@\w$])([A-Za-z_$][\w$]*)\s*\(/g;
const javaAnnotationRe = /@((?:[A-Za-z_$][\w$]*\.)*[A-Za-z_$][\w$]*)/g;
const javaNewRe = /\bnew\s+((?:[A-Za-z_$][\w$]*\s*\.\s*)*[A-Za-z_$][\w$]*)/g;
const javaIndexes = new WeakMap();

function javaStrip(text) {
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
      const close = text.indexOf('*/', i + 2);
      const stop = close === -1 ? n : close + 2;
      out.push(blankKeepLines(text.slice(i, stop)));
      i = stop;
    } else if (text.startsWith('"""', i)) {
      let j = i + 3;
      while (j < n && !text.startsWith('"""', j)) j += text[j] === '\\' ? 2 : 1;
      const stop = Math.min(n, j + 3);
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

function javaBlankSpan(code, start, end) {
  return code.slice(0, start) + ' '.repeat(end - start) + code.slice(end);
}

function javaLast(qualified) {
  return qualified.slice(qualified.lastIndexOf('.') + 1).trim();
}

// The names a class header extends or implements. Generic arguments go first so 'extends' inside <T extends X> is
// not read as the base list.
function javaBases(header) {
  let h = header;
  while (/<[^<>]*>/.test(h)) h = h.replace(/<[^<>]*>/g, '');
  const bases = [];
  const lists = [
    /\bextends\s+(.*?)(?=\bimplements\b|\bpermits\b|$)/.exec(h),
    /\bimplements\s+(.*?)(?=\bpermits\b|$)/.exec(h),
  ];
  for (const list of lists) {
    if (!list) continue;
    for (const part of list[1].split(',')) {
      const name = javaLast(part);
      if (/^[A-Za-z_$][\w$]*$/.test(name)) bases.push(name);
    }
  }
  return bases;
}

function javaRefNames(code) {
  const names = [];
  for (const m of code.matchAll(javaCallRe)) if (!javaCallSkip.has(m[1])) names.push(m[1]);
  for (const m of code.matchAll(javaAnnotationRe)) if (m[1] !== 'interface') names.push(javaLast(m[1]));
  for (const m of code.matchAll(javaNewRe)) names.push(javaLast(m[1].replace(/\s/g, '')));
  return names;
}

// The file list is one sorted array per build, so index it once per array.
function javaFileIndex(files) {
  let index = javaIndexes.get(files);
  if (!index) {
    index = { paths: new Set(files), byName: new Map() };
    for (const p of files) {
      const base = p.slice(p.lastIndexOf('/') + 1);
      const list = index.byName.get(base);
      if (list) list.push(p);
      else index.byName.set(base, [p]);
    }
    javaIndexes.set(files, index);
  }
  return index;
}

function javaFindFile(qualified, index) {
  const rel = `${qualified.replace(/\./g, '/')}.java`;
  if (index.paths.has(rel)) return rel;
  for (const root of ['src/main/java/', 'src/']) {
    if (index.paths.has(root + rel)) return root + rel;
  }
  const tail = `/${rel}`;
  const candidates = index.byName.get(rel.slice(rel.lastIndexOf('/') + 1)) ?? [];
  return candidates.find((p) => p.endsWith(tail)) ?? null;
}

export const javaLang = {
  id: 'java',
  exts: ['.java'],
  extract(text) {
    const lines = javaStrip(String(text ?? '')).split('\n');
    const symbols = [];
    const imports = [];
    const refs = [];
    const extended = [];
    const seenRefs = new Set();
    const types = []; // open type bodies, innermost last; a body deeper than one nesting level is skipped
    let pending = null; // a type header whose '{' has not come yet
    let depth = 0;

    const addRef = (name, line) => {
      const key = `${line} ${name}`;
      if (seenRefs.has(key)) return;
      seenRefs.add(key);
      refs.push({ name, line });
    };
    const openType = (open) => {
      types.push({ full: open.full, bodyDepth: depth, skip: open.skip });
      if (open.skip) return;
      for (const base of javaBases(open.header)) {
        extended.push({ name: open.full, base, line: open.line });
        addRef(base, open.line);
      }
    };

    lines.forEach((code, index) => {
      const line = index + 1;
      const top = types.at(-1);
      const atMembers = depth === (top ? top.bodyDepth : 0);
      let refText = code;
      let scanFrom = 0;

      const imp = javaImportRe.exec(code);
      if (imp) imports.push({ spec: imp[2], line, names: imp[2].endsWith('*') ? [] : [javaLast(imp[2])] });

      const type = !pending && atMembers ? javaTypeRe.exec(code) : null;
      if (type) {
        const name = type[4];
        const full = top ? `${top.full}.${name}` : name;
        const skip = types.length >= 2;
        if (!skip) symbols.push({ name: full, kind: javaKinds[type[3]], line, exported: /\bpublic\b/.test(type[2]) });
        pending = { full, skip, line, header: '' };
        refText = javaBlankSpan(code, type[1].length, type[0].length);
        scanFrom = type[0].length;
      } else if (!pending && atMembers && top) {
        const method = javaMethodRe.exec(code);
        const field = method ? null : javaFieldRe.exec(code);
        const ctor = method ? null : javaCtorRe.exec(code);
        if (method) {
          // Blank modifiers, return type and name: a 'void' before '(' would otherwise read as a call.
          refText = javaBlankSpan(code, method[1].length, method[0].length);
          const declared = /[{;,(]\s*$/.test(code) && !javaCallSkip.has(method[3]) && !javaCallSkip.has(method[4]);
          if (declared && !top.skip) {
            symbols.push({ name: `${top.full}.${method[4]}`, kind: 'method', line, exported: /\bpublic\b/.test(method[2]) });
          }
        } else if (field && /\bstatic\b/.test(field[1]) && /\bfinal\b/.test(field[1]) && !top.skip) {
          symbols.push({ name: `${top.full}.${field[2]}`, kind: 'const', line, exported: /\bpublic\b/.test(field[1]) });
        } else if (ctor && ctor[1] === javaLast(top.full)) {
          refText = javaBlankSpan(code, ctor.index, ctor[0].length);
        }
      }

      for (const name of javaRefNames(refText)) addRef(name, line);
      if (pending) pending.header += ' ';

      for (let k = scanFrom; k < code.length; k += 1) {
        const ch = code[k];
        if (ch === '{') {
          depth += 1;
          if (pending) {
            openType(pending);
            pending = null;
          }
        } else if (ch === '}') {
          depth -= 1;
          while (types.length && types.at(-1).bodyDepth > depth) types.pop();
        } else if (pending) {
          pending.header += ch;
        }
      }
    });

    return { symbols, imports, refs, extends: extended };
  },
  resolve(spec, fromPath, files) {
    if (spec.endsWith('*') || spec.startsWith('java.') || spec.startsWith('javax.')) return null;
    const index = javaFileIndex(files);
    const found = javaFindFile(spec, index);
    if (found) return found;
    // A static member (a.b.C.m) or a nested type (a.b.C.Inner) names the class file a/b/C.java.
    const dot = spec.lastIndexOf('.');
    return dot > 0 ? javaFindFile(spec.slice(0, dot), index) : null;
  },
};
