// Everything a change must pass before it merges, in one command: npm run check. CI runs the same list.
// Each step is a command; the first failure stops the run with its output.
import { spawnSync } from 'node:child_process';

const steps = [
  ['the version is stamped where agents read it', 'node', ['scripts/stamp-version.mjs', '--check']],
  ['nothing defined and unused (page functions, UI strings, server exports)', 'node', ['scripts/unused.mjs']],
  ['READMEs share one shape', 'node', ['scripts/readme-shape.mjs']],
  ['the page carries the current task rules', 'node', ['scripts/inline-rules.mjs', '--check']],
  ['the demo is built from the current page', 'node', ['examples/build-demo.cjs', '--check']],
  ['server, MCP and changelog tests', 'npm', ['test', '--silent']],
  ['the board page in a browser-like DOM', 'node', ['tests/smoke.cjs']],
];
for (const [name, cmd, args] of steps) {
  const r = spawnSync(cmd, args, { stdio: 'pipe', encoding: 'utf8' });
  if (r.status !== 0) {
    process.stdout.write(r.stdout || '');
    process.stderr.write(r.stderr || '');
    console.error(`\ncheck failed: ${name}`);
    process.exit(1);
  }
  console.log(`ok  ${name}`);
}
