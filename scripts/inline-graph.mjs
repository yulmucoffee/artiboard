// The board page shows a code map's communities and explains a symbol with the same code the server uses, and the
// page must stay one file: it carries a copy of server/codemap/graph.js between two marker lines, as it carries
// server/tasks.js. This writes that copy; with --check it only says whether it is current.
import { readFileSync, writeFileSync } from 'node:fs';

const PAGE = new URL('../skills/artiboard/assets/board.html', import.meta.url);
const START = '  // ---------- code map graph: a copy of server/codemap/graph.js made by scripts/inline-graph.mjs; edit that file ----------';
const END = '  // ---------- end of code map graph ----------';

const graph = readFileSync(new URL('../server/codemap/graph.js', import.meta.url), 'utf8')
  .replace(/^export /gm, '')
  .trim().split('\n').map((l) => (l ? `  ${l}` : l)).join('\n');
const page = readFileSync(PAGE, 'utf8');
const a = page.indexOf(START), b = page.indexOf(END);
if (a < 0 || b < a) { console.error('board.html has no code-map graph markers'); process.exit(1); }
const next = `${page.slice(0, a)}${START}\n${graph}\n${page.slice(b)}`;

if (process.argv.includes('--check')) {
  if (next !== page) { console.error('board.html carries an old copy of server/codemap/graph.js: run node scripts/inline-graph.mjs'); process.exit(1); }
} else if (next !== page) {
  writeFileSync(PAGE, next);
  console.log('board.html: code map graph copied from server/codemap/graph.js');
}
