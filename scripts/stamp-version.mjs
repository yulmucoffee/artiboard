// package.json holds the version. This stamps it where code and agents read it: server/version.js (the site reports
// it in board_start and board_whoami) and the skill's SKILL.md, so an agent can tell its installed skill is older
// than the site. npm version runs it; with --check it only says whether both are current.
import { readFileSync, writeFileSync } from 'node:fs';

const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const files = [
  [new URL('../server/version.js', import.meta.url), () => `// written by scripts/stamp-version.mjs from package.json\nexport const VERSION = '${version}';\n`],
  [new URL('../skills/artiboard/SKILL.md', import.meta.url), (cur) => cur.replace(/^This is artiboard \S+\./m, `This is artiboard ${version}.`)],
];
let stale = 0;
for (const [url, make] of files) {
  let cur = '';
  try { cur = readFileSync(url, 'utf8'); } catch {}
  const next = make(cur);
  if (next === cur) continue;
  if (process.argv.includes('--check')) { console.error(`${url.pathname} does not carry ${version}: run node scripts/stamp-version.mjs`); stale++; }
  else writeFileSync(url, next);
}
if (stale) process.exit(1);
