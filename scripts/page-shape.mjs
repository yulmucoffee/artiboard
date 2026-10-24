// The page scripts and the page test keep one shape, so a diff shows a change and not a reflow: prettier at width 120,
// single quotes, no trailing commas. The task-rules copy inside the page (between the markers scripts/inline-rules.mjs
// writes) is left as that script writes it. This writes the files; with --check it only says which are off.
// prettier is not a dependency of the site: CI installs it next to jsdom; locally, npm install --no-save prettier@3.9.10.
import { readFileSync, writeFileSync } from 'node:fs';

const FILES = ['skills/artiboard/assets/board.html', 'server/public/index.html', 'tests/smoke.cjs'];
const OPTIONS = { parser: 'babel', printWidth: 120, singleQuote: true, trailingComma: 'none' };
const START = '  // ---------- task rules:', END = '  // ---------- end of task rules ----------';

let prettier;
try { prettier = await import('prettier'); } catch { console.error('prettier is not installed: npm install --no-save prettier@3.9.10'); process.exit(1); }

// an HTML page's last script block, formatted around the rules copy; a .cjs file whole
async function shaped(src, html) {
  if (!html) return prettier.format(src, OPTIONS);
  const open = src.lastIndexOf('<script>\n') + '<script>\n'.length, close = src.lastIndexOf('</script>');
  let script = src.slice(open, close), rules = null;
  const a = script.indexOf(START), b = script.indexOf(END);
  if (a >= 0 && b > a) {
    rules = script.slice(a, b + END.length);
    script = script.slice(0, a) + '// __TASK_RULES__' + script.slice(b + END.length);
  }
  let out = await prettier.format(script, OPTIONS);
  if (rules) out = out.replace(/^[ \t]*\/\/ __TASK_RULES__[ \t]*$/m, () => rules);
  return src.slice(0, open) + out + src.slice(close);
}

const check = process.argv.includes('--check');
let off = 0;
for (const f of FILES) {
  const url = new URL(`../${f}`, import.meta.url), cur = readFileSync(url, 'utf8');
  const next = await shaped(cur, f.endsWith('.html'));
  if (next === cur) continue;
  if (check) { console.error(`${f} is not in shape: run node scripts/page-shape.mjs`); off++; }
  else { writeFileSync(url, next); console.log(`${f}: shaped`); }
}
if (off) process.exit(1);
if (check) console.log('page scripts in shape');
