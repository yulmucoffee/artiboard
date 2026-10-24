// Finds what a file defines and nothing uses: functions in the page and the project list, their UI string keys, and
// server exports no other module imports. Exits 1 if it finds any, so npm run check keeps them from coming back.
import { readFileSync, readdirSync } from 'node:fs';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const found = [];

// functions declared in a page script and never mentioned again (a call, a handler or a reference)
for (const page of ['skills/artiboard/assets/board.html', 'server/public/index.html', 'server/public/shim.js']) {
  // the page's copy of server/tasks.js is that module's; its unused parts are checked there
  const src = read(page).replace(/\/\/ -+ task rules:[\s\S]*?\/\/ -+ end of task rules -+/, '');
  for (const [, name] of src.matchAll(/\bfunction ([A-Za-z_$][\w$]*)\s*\(/g)) {
    const uses = src.split(new RegExp(`(?<![\\w$])${name.replace(/\$/g, '\\$')}(?![\\w$])`)).length - 1;
    if (uses < 2) found.push(`${page}: function ${name}`);
  }
}

// keys of the English UI strings no code reads: T('key'), or a key built from a prefix the code names (T('st_'+s))
for (const page of ['skills/artiboard/assets/board.html', 'server/public/index.html']) {
  const src = read(page), table_at = /\ben:\s*\{/.exec(src);
  if (!table_at) continue;
  const at = table_at.index, open = at + table_at[0].length - 1;
  let depth = 0, end = open;
  for (let i = open + 1; i < src.length; i++) { if (src[i] === '{') depth++; else if (src[i] === '}') { if (!depth) { end = i; break; } depth--; } }
  const table = src.slice(at, end), rest = src.slice(0, at) + src.slice(end);
  const keys = [...new Set([...table.matchAll(/(?:^[ \t]*|[{,][ \t]*)([A-Za-z_]\w*):\s*(?=['"[{])/gm)].map((m) => m[1]))];
  const prefixes = [...rest.matchAll(/['"]([A-Za-z]+_)['"]\s*\+/g)].map((m) => m[1]);
  const suffixes = [...rest.matchAll(/\+\s*['"]([A-Z]\w*)['"]/g)].map((m) => m[1]);
  for (const k of keys) {
    const used = new RegExp(`['"]${k}['"]`).test(rest) || prefixes.some((p) => k.startsWith(p)) || suffixes.some((x) => k.endsWith(x))
      || new RegExp(`\\bL\\.${k}\\b`).test(rest);
    if (!used) found.push(`${page}: string ${k}`);
  }
}

// server exports nothing else imports
const files = readdirSync(new URL('../server/', import.meta.url), { recursive: true }).filter((f) => f.endsWith('.js')).map((f) => `server/${f}`);
// the page counts as a user of server/tasks.js: it carries that module's code
const all = files.concat(['tests/server.test.js', 'tests/tasks.test.js', 'scripts/bench.mjs', 'api/_app.js', 'skills/artiboard/assets/board.html'])
  .map((f) => [f, f.endsWith('board.html') ? read(f).replace(/\/\/ -+ task rules:[\s\S]*?\/\/ -+ end of task rules -+/, '') : read(f)]);
for (const [f, src] of all.filter(([f]) => f.startsWith('server/'))) {
  for (const [, name] of src.matchAll(/^export (?:async )?(?:function|const|class) ([A-Za-z_$][\w$]*)/gm)) {
    if (!all.some(([g, other]) => g !== f && new RegExp(`\\b${name}\\b`).test(other))) found.push(`${f}: export ${name}`);
  }
}

if (found.length) { console.error(found.join('\n')); process.exit(1); }
console.log('nothing defined and unused');
