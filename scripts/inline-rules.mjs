// The board page must stay one file (a claude.ai artifact publishes it as is), so it carries a copy of the task rules
// in server/tasks.js between two marker lines. This writes that copy; with --check it only says whether it is current.
import { readFileSync, writeFileSync } from 'node:fs';

const PAGE = new URL('../skills/artiboard/assets/board.html', import.meta.url);
const START = '  // ---------- task rules: a copy of server/tasks.js made by scripts/inline-rules.mjs; edit that file ----------';
const END = '  // ---------- end of task rules ----------';

const rules = readFileSync(new URL('../server/tasks.js', import.meta.url), 'utf8')
  .replace(/^export /gm, '')
  .trim().split('\n').map((l) => (l ? `  ${l}` : l)).join('\n');
const page = readFileSync(PAGE, 'utf8');
const a = page.indexOf(START), b = page.indexOf(END);
if (a < 0 || b < a) { console.error('board.html has no task-rules markers'); process.exit(1); }
const next = `${page.slice(0, a)}${START}\n${rules}\n${page.slice(b)}`;

if (process.argv.includes('--check')) {
  if (next !== page) { console.error('board.html carries old task rules: run node scripts/inline-rules.mjs'); process.exit(1); }
} else if (next !== page) {
  writeFileSync(PAGE, next);
  console.log('board.html: task rules copied from server/tasks.js');
}
