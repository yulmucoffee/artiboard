// SQL: tables, views, functions, procedures, indexes, types and triggers, and the tables and functions a statement
// reads or writes. Comments and '' strings are blanked first. A declared name is never also a reference to itself,
// so the tokens that name a declaration are marked before the references are read.

const SQL_SKIP = /--[^\n]*|\/\*[\s\S]*?(?:\*\/|$)|'(?:[^']|'')*'/g;
const SQL_TOKEN = /"([^"\n]*)"|`([^`\n]*)`|[A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*|\d[\w.]*|'[^']*'|\S/g;
const SQL_KIND = new Map([['table', 'table'], ['view', 'type'], ['function', 'fn'], ['procedure', 'fn'], ['index', 'var'], ['type', 'type'], ['trigger', 'fn']]);
const SQL_MODS = new Set(['or', 'replace', 'temp', 'temporary', 'unlogged', 'materialized', 'unique', 'global', 'local', 'recursive']);
const SQL_OPTIONAL = new Set(['if', 'not', 'exists', 'only', 'concurrently']);
const SQL_REF_KW = new Set(['from', 'join', 'into', 'update', 'references', 'table']);
const SQL_NOT_TARGET = new Set(['select', 'set', 'values', 'lateral', 'with', 'on', 'where', 'as', 'dual']);
// Keywords and builtins that take a parenthesis. The type names and DDL keywords (check, key, unique) only appear
// this way in column and table definitions, never as a call.
const SQL_NOT_CALL = new Set(['count', 'sum', 'max', 'min', 'coalesce', 'now', 'lower', 'upper', 'length', 'substr', 'concat', 'cast', 'exists', 'in', 'any', 'all', 'values', 'select', 'insert', 'update', 'delete', 'check', 'primary', 'key', 'unique', 'foreign', 'constraint', 'default', 'using', 'on', 'as', 'over', 'filter', 'returning', 'where', 'with', 'when', 'not', 'and', 'or', 'is', 'like', 'between', 'interval', 'array', 'enum', 'numeric', 'decimal', 'varchar', 'char', 'character', 'timestamp', 'time', 'bit', 'if', 'from', 'join', 'into', 'references', 'table']);
const SQL_INDEX = new WeakMap();

function sqlBlank(s) {
  return s.replace(/[^\n]/g, ' ');
}

function sqlStrip(text) {
  return text.replace(/\r\n?/g, '\n').replace(SQL_SKIP, (m) => (m[0] === "'" ? `'${sqlBlank(m.slice(1, -1))}'` : sqlBlank(m)));
}

function sqlTokens(code) {
  const toks = [];
  let line = 1;
  let at = 0;
  for (const m of code.matchAll(SQL_TOKEN)) {
    for (; at < m.index; at++) if (code.charCodeAt(at) === 10) line++;
    if (m[1] !== undefined || m[2] !== undefined) toks.push({ v: m[1] ?? m[2], w: true, line });
    else toks.push({ v: m[0], w: /^[A-Za-z_]/.test(m[0]), line });
  }
  return toks;
}

function sqlLow(t) {
  return t ? t.v.toLowerCase() : '';
}

function sqlLast(name) {
  return name.slice(name.lastIndexOf('.') + 1);
}

function sqlSkipOptional(toks, k) {
  while (toks[k] && toks[k].w && SQL_OPTIONAL.has(sqlLow(toks[k]))) k++;
  return k;
}

function sqlParse(text) {
  const code = sqlStrip(text);
  const toks = sqlTokens(code);
  const declared = new Set();
  const skip = new Set();
  const symbols = [];
  const refs = [];

  // Pass 1: each `create` names one object; an index or trigger also reads the table after its `on`.
  for (let i = 0; i < toks.length; i++) {
    if (sqlLow(toks[i]) !== 'create') continue;
    let j = i + 1;
    while (toks[j] && toks[j].w && SQL_MODS.has(sqlLow(toks[j]))) j++;
    const kw = sqlLow(toks[j]);
    const kind = SQL_KIND.get(kw);
    if (!kind) continue;
    const k = sqlSkipOptional(toks, j + 1);
    const named = toks[k];
    if (named && named.w && named.v && sqlLow(named) !== 'on') {
      declared.add(k);
      symbols.push({ name: sqlLast(named.v), kind, line: named.line, exported: true });
    }
    if (kw === 'index' || kw === 'trigger') {
      let on = k;
      while (toks[on] && toks[on].v !== ';' && sqlLow(toks[on]) !== 'on') on++;
      const target = sqlSkipOptional(toks, on + 1);
      if (sqlLow(toks[on]) === 'on' && toks[target] && toks[target].w && toks[target].v) {
        refs.push({ at: target, name: sqlLast(toks[target].v), line: toks[target].line });
        skip.add(target);
      }
    }
  }

  // Pass 2: a keyword reads the object after it; any other name followed by `(` is a call unless it is a builtin.
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i];
    if (!t.w || declared.has(i) || skip.has(i)) continue;
    const low = sqlLow(t);
    if (SQL_REF_KW.has(low)) {
      const target = sqlSkipOptional(toks, i + 1);
      const tt = toks[target];
      if (tt && tt.w && tt.v && !declared.has(target) && !skip.has(target) && !SQL_NOT_TARGET.has(sqlLow(tt))) {
        refs.push({ at: target, name: sqlLast(tt.v), line: tt.line });
        skip.add(target);
      }
      continue;
    }
    if (toks[i + 1] && toks[i + 1].v === '(' && !SQL_NOT_CALL.has(low)) refs.push({ at: i, name: sqlLast(t.v), line: t.line });
  }

  // `\i file.sql` and `\ir file.sql` (psql) and `source file.sql` (mysql), one per line.
  const imports = [];
  code.split('\n').forEach((ln, idx) => {
    const psql = /^\s*\\ir?\s+([^\s;]+);?\s*$/.exec(ln);
    const mysql = /^\s*source\s+([^\s;]*[./][^\s;]*);?\s*$/i.exec(ln);
    const m = psql || mysql;
    if (m) imports.push({ spec: m[1], line: idx + 1, names: [] });
  });

  symbols.sort((a, b) => a.line - b.line);
  refs.sort((a, b) => a.at - b.at);
  return { symbols, imports, refs: refs.map(({ name, line }) => ({ name, line })), extends: [] };
}

function sqlIndex(files) {
  let set = SQL_INDEX.get(files);
  if (!set) {
    set = new Set(files);
    SQL_INDEX.set(files, set);
  }
  return set;
}

// Only a path relative to the including file resolves; psql runs the path from the working directory, which is
// not known from the repo, so other forms stay unresolved.
function sqlResolve(spec, fromPath, files) {
  const dir = fromPath.slice(0, fromPath.lastIndexOf('/') + 1);
  const out = [];
  for (const seg of (dir + spec).split('/')) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') out.pop();
    else out.push(seg);
  }
  const rel = out.join('/');
  return sqlIndex(files).has(rel) ? rel : null;
}

export const sqlLang = {
  id: 'sql',
  exts: ['.sql'],
  extract(text) {
    return sqlParse(text);
  },
  resolve: sqlResolve,
};
