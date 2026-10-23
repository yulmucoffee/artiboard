// What CI holds every release to (CONTRIBUTING.md): a pull request raises the version and its changelog entry names
// it, and main takes only squash-merged pull requests, whose subject ends in (#N) for an N the changelog names.
//   node scripts/release-check.mjs --pr <n> --base <git ref>          on a pull request
//   node scripts/release-check.mjs --subject "<head commit subject>"  on a push to main
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const parts = (v) => String(v).split('.').map(Number);
const newer = (a, b) => { const x = parts(a), y = parts(b); return x[0] - y[0] || x[1] - y[1] || x[2] - y[2]; };

// the ways a release breaks the rules; none means it keeps them
export function releaseProblems({ changelog, version, baseVersion, pr, subject }) {
  const top = changelog.versions[0], named = (n) => changelog.versions.some((v) => v.prs.includes(n));
  const out = [];
  if (pr != null) {
    if (!(newer(version, baseVersion) > 0)) out.push(`package.json says ${version}, not newer than ${baseVersion} on the base: bump it`);
    if (!top.prs.includes(pr)) out.push(`the newest changelog entry (${top.version}) names ${top.prs.map((n) => `#${n}`).join(', ')}, not #${pr}`);
  }
  if (subject != null) {
    const m = /\(#(\d+)\)$/.exec(subject);
    if (!m) out.push(`"${subject}" did not come through a pull request: main takes squash merges, whose subject ends in (#N)`);
    else if (!named(Number(m[1]))) out.push(`#${m[1]} is in no changelog entry`);
  }
  return out;
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  const arg = (k) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : undefined; };
  const file = (p) => JSON.parse(readFileSync(new URL(`../${p}`, import.meta.url), 'utf8'));
  const base = arg('--base');
  const problems = releaseProblems({
    changelog: file('server/public/changelog.json'),
    version: file('package.json').version,
    baseVersion: base && JSON.parse(execFileSync('git', ['show', `${base}:package.json`], { encoding: 'utf8' })).version,
    pr: arg('--pr') ? Number(arg('--pr')) : undefined,
    subject: arg('--subject'),
  });
  for (const p of problems) console.error(p);
  if (problems.length) process.exit(1);
  console.log('release ok');
}
