// Agents build a repository's code map from the checkout they work in, with Node alone and nothing to install, so the
// skill ships one self-contained script: server/codemap/* concatenated (language modules, the graph, the scanner, the
// builder) and an uploader. Modules keep to top-level `export function` / `export const`, unique names and relative
// imports, which is what makes a plain concatenation a correct bundle. The same script goes to the skill and to the
// site's public folder, so CI can fetch the uploader that matches the site's version from <site>/codemap.mjs. This
// writes both; --check compares both.
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = new URL('../', import.meta.url);
const read = (p) => readFileSync(new URL(p, root), 'utf8');
const OUTS = ['skills/artiboard/scripts/codemap.mjs', 'server/public/codemap.mjs'];

const langs = readdirSync(new URL('server/codemap/lang/', root)).filter((f) => f.endsWith('.js') && f !== 'index.js').sort().map((f) => `server/codemap/lang/${f}`);
const order = [...langs, 'server/codemap/lang/index.js', 'server/codemap/graph.js', 'server/codemap/scan.js', 'server/codemap/build.js'];

// the uploader's own imports, beside the ones the modules bring
const hoisted = new Set(["import { gzipSync } from 'node:zlib';",
  "import { accessSync, chmodSync, constants, existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, statSync, writeFileSync } from 'node:fs';",
  "import { tmpdir } from 'node:os';", "import { delimiter, isAbsolute, resolve, sep } from 'node:path';"]), names = new Map(), parts = [];
for (const file of order) {
  const src = read(file);
  const kept = [];
  for (const line of src.split('\n')) {
    if (/^import\b.*from\s+'node:[^']+';\s*$/.test(line)) { hoisted.add(line); continue; }
    if (/^import\b.*from\s+'\.\.?\/[^']+';\s*$/.test(line)) continue;
    if (/^import\b/.test(line)) throw new Error(`${file}: an import the bundle cannot carry: ${line}`);
    if (/^export\s+(default|\{)/.test(line)) throw new Error(`${file}: only top-level export function / export const bundle: ${line}`);
    const m = /^(?:export\s+)?(?:async\s+)?(?:function|const|let|class)\s+([A-Za-z_$][\w$]*)/.exec(line);
    if (m) {
      if (names.has(m[1])) throw new Error(`${file}: top-level name ${m[1]} is also declared in ${names.get(m[1])}`);
      names.set(m[1], file);
    }
    kept.push(line.replace(/^export\s+/, ''));
  }
  parts.push(`// ---- ${file} ----\n${kept.join('\n').trim()}\n`);
}

const main = `
// ---- uploader ----
// node codemap.mjs --site https://board.example --project P --repo owner/name [--root DIR] [--label L] [--token abt_…] [--if-changed]
// node codemap.mjs --hook | --workflow, then the same arguments
// The token comes from --token or ARTIBOARD_TOKEN. What leaves the machine: paths, names, line numbers, each symbol's
// declaration line (a constant's without its value) and the comment above it. No bodies. --if-changed asks the site
// first and builds nothing when its map already describes this commit and neither it nor the checkout had changes no
// commit holds, so CI or a git hook can run it on every commit. --workflow writes that CI job and --hook installs those
// hooks; a repository gets one of the two, or its map flips between the branches they build.
// a repository as the server names it: owner/name, from a URL too, in any case
const repoKey = (r) => String(r || '').replace(/^https?:\\/\\/[^/]+\\//i, '').replace(/\\.git$/i, '').toLowerCase();
// one word to sh: as it is when nothing in it is special, else in single quotes
const shellWord = (s) => (/^[\\w@%+=:,./-]+$/.test(s) ? s : \`'\${String(s).replace(/'/g, \`'\\\\''\`)}'\`);
const codemapGit = async (cwd, ...args) => (await scanGit(cwd, args)).trim();
const CODEMAP_MARK = '# artiboard code map';

// The default branch: origin/HEAD when the clone recorded it, else what origin says (a remote added by hand records
// nothing), else main. git may not stop to ask for a password while the timeout runs.
async function codemapBranch(top) {
  const origin = await codemapGit(top, 'symbolic-ref', 'refs/remotes/origin/HEAD').catch(() => '');
  if (origin) return origin.replace(/^refs\\/remotes\\/origin\\//, '');
  const said = await scanExec('git', ['ls-remote', '--symref', 'origin', 'HEAD'], { cwd: top, timeout: 5000, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } })
    .then((r) => r.stdout, () => '');
  return /^ref: refs\\/heads\\/(\\S+)\\tHEAD$/m.exec(said)?.[1] || 'main';
}

// A CI job that rebuilds the map on each push to the default branch, with the uploader of the site's own version
async function codemapWorkflow({ site, project, repo, label, root }) {
  const top = await codemapGit(root, 'rev-parse', '--show-toplevel'), dir = join(top, '.github', 'workflows');
  const file = join(dir, 'artiboard-codemap.yml');
  if (existsSync(file)) { console.error(\`\${file} exists; not overwritten\`); process.exit(1); }
  // a job written by hand from an older recipe is a second writer
  const other = (existsSync(dir) ? readdirSync(dir, { withFileTypes: true }) : []).find((e) => e.isFile() && readFileSync(join(dir, e.name), 'utf8').includes('codemap.mjs'));
  if (other) {
    console.error(\`.github/workflows/\${other.name} already runs codemap.mjs, and two jobs would flip the map between them: add --if-changed to that one, or delete it and run --workflow again\`);
    process.exit(1);
  }
  const branch = await codemapBranch(top);
  // CI checks out at the repository's root, so a map of one folder names that folder
  const folder = (await codemapGit(root, 'rev-parse', '--show-prefix')).replace(/\\/$/, '');
  const run = ['--site', site, '--project', project, '--repo', repo, ...(label ? ['--label', label] : []), ...(folder ? ['--root', folder] : []), '--if-changed'];
  mkdirSync(dir, { recursive: true });
  writeFileSync(file, [
    \`# Written by codemap.mjs --workflow: rebuilds the board's code map of \${repo} on each push to \${branch}.\`,
    'name: artiboard code map',
    'on:',
    '  push:',
    \`    branches: [\${branch}]\`,
    '# one run at a time and the newest last, so an older push never replaces a newer map',
    'concurrency: artiboard-codemap',
    'jobs:',
    '  codemap:',
    '    runs-on: ubuntu-latest',
    '    steps:',
    '      - uses: actions/checkout@v4',
    '      - uses: actions/setup-node@v4',
    '        with:',
    '          node-version: 22',
    '      # saved outside the checkout, where the map would count it as an uncommitted change',
    '      - env:',
    '          ARTIBOARD_TOKEN: \${{ secrets.ARTIBOARD_TOKEN }}',
    '        run: |',
    \`          curl -fsSL \${shellWord(\`\${site}/codemap.mjs\`)} -o "$RUNNER_TEMP/codemap.mjs"\`,
    \`          node "$RUNNER_TEMP/codemap.mjs" \${run.map(shellWord).join(' ')}\`,
    '',
  ].join('\\n'));
  console.log(\`wrote \${file}: it rebuilds the map of \${repo} on each push to \${branch}\`);
  console.log(\`next: gh secret set ARTIBOARD_TOKEN --repo \${repo} with a member's token (a viewer's cannot write maps), then commit the workflow\`);
}

// The node this shell finds, named in the hooks: GUI git clients, and shells that set up a version manager in a
// profile, run hooks with another PATH. The PATH entry, not process.execPath, which a package manager may resolve to
// one version's folder that an upgrade removes.
const codemapNode = () => (process.env.PATH || '').split(delimiter).map((d) => join(d, 'node')).find((at) => {
  try { accessSync(at, constants.X_OK); return isAbsolute(at) && statSync(at).isFile(); } catch { return false; }
}) || process.execPath;
// whether a hook's #! line names a shell, directly or through env, so that the sh line can go in it
const codemapShell = (first) => {
  const words = first.slice(2).trim().split(/\\s+/).map((w) => w.split('/').pop());
  return ['sh', 'bash', 'dash', 'zsh'].includes(words[0] === 'env' ? words.find((w, i) => i && !w.startsWith('-')) : words[0]);
};

// Hooks that rebuild the map after each commit, merge and rebase, in the background so git never waits on it. Every
// path in them is absolute and git's own variables are cleared before the build: a hook runs with the GIT_DIR of
// whatever ran it, yet the map must describe the checkout that installed it. So they go only where that checkout
// alone runs them: not from a linked worktree, whose repository's hooks folder every worktree shares and which goes
// away, and not into a hooks folder outside the git dir (core.hooksPath), which other repositories may share or the
// repository may track.
async function codemapHook({ site, project, repo, label, root, token }) {
  const self = realpathSync(process.argv[1]);
  if ([tmpdir(), '/tmp'].some((d) => existsSync(d) && self.startsWith(realpathSync(d) + sep))) {
    console.error(\`the hooks would run \${self}, which is in a temp folder and will vanish: run --hook with the skill's scripts/codemap.mjs\`);
    process.exit(2);
  }
  const gitDir = await codemapGit(root, 'rev-parse', '--absolute-git-dir');
  const common = resolve(root, await codemapGit(root, 'rev-parse', '--git-common-dir'));
  if (realpathSync(gitDir) !== realpathSync(common)) {
    console.error(\`\${resolve(root)} is a linked worktree: every worktree of a repository runs one hooks folder, and these hooks would keep this one's paths after it is removed. Nothing installed; run --hook from the main checkout\`);
    process.exit(2);
  }
  const hooks = resolve(root, await codemapGit(root, 'rev-parse', '--git-path', 'hooks'));
  const env = join(gitDir, 'artiboard-codemap.env'), log = join(gitDir, 'codemap.log');
  const run = [codemapNode(), self, '--site', site, '--project', project, '--repo', repo, ...(label ? ['--label', label] : []), '--root', resolve(root), '--if-changed'];
  // a subshell, so sitting out a rebase leaves the hook's other lines running; set -a exports what the env file sets
  const build = \`unset $(git rev-parse --local-env-vars); env=\${shellWord(env)}; set -a; [ -f "$env" ] && . "$env"; \${run.map(shellWord).join(' ')} >> \${shellWord(log)} 2>&1 &\`;
  const sitOut = '[ -d "$(git rev-parse --git-path rebase-merge)" ] || [ -d "$(git rev-parse --git-path rebase-apply)" ] && exit 0; ';
  // a rebase commits once for each commit it moves, then runs post-rewrite once, while its own state may still be there
  const each = \`( \${sitOut}\${build} ) \${CODEMAP_MARK}\`, lines = { 'post-commit': each, 'post-merge': each, 'post-rewrite': \`( \${build} ) \${CODEMAP_MARK}\` };
  if (!hooks.startsWith(common + sep)) {
    console.error([\`git runs this repository's hooks from \${hooks}, outside \${common} (core.hooksPath): a folder other repositories share would run them there too, and a tracked one would carry this checkout's paths into every clone. Nothing installed; add these lines by hand where they belong:\`,
      ...Object.entries(lines).map(([name, line]) => \`\${name}: \${line}\`)].join('\\n'));
    process.exit(2);
  }
  const before = {};
  for (const name of Object.keys(lines)) {
    const file = join(hooks, name), text = existsSync(file) ? readFileSync(file, 'utf8') : '', first = text.split('\\n')[0];
    if (first.startsWith('#!') && !codemapShell(first)) {
      console.error(\`\${file} is not a shell script (\${first}), and the line --hook adds is sh. Nothing installed; have that hook run this line with sh:\\n\${lines[name]}\`);
      process.exit(2);
    }
    before[name] = text;
  }
  if (token) {
    writeFileSync(env, \`ARTIBOARD_TOKEN=\${shellWord(token)}\\n\`, { mode: 0o600 });
    chmodSync(env, 0o600);
  } else if (existsSync(env)) token = /^ARTIBOARD_TOKEN=(.*)$/m.exec(readFileSync(env, 'utf8'))?.[1];
  mkdirSync(hooks, { recursive: true });
  for (const [name, text] of Object.entries(before)) {
    const file = join(hooks, name), own = text ? text.replace(/\\n$/, '').split('\\n') : [];
    const [first, ...rest] = own[0]?.startsWith('#!') ? own : ['#!/bin/sh', ...own];
    // right after the #! line, which a hook that ends in exit or exec never reaches past; a line that already runs the
    // uploader, marked or written by hand from 1.17's recipe, goes, so the map keeps one writer
    const kept = rest.filter((l) => !l.endsWith(CODEMAP_MARK) && (l.trimStart().startsWith('#') || !l.includes('codemap.mjs')));
    const next = [first, lines[name], ...kept].join('\\n') + '\\n';
    if (next !== text) writeFileSync(file, next);
    chmodSync(file, 0o755);
  }
  console.log(\`hooks: \${Object.keys(before).map((name) => join(hooks, name)).join(', ')} rebuild the map in the background after each commit, merge and rebase; log: \${log}\`);
  console.log(existsSync(env) ? \`token: \${env}\` : 'token from the environment: set ARTIBOARD_TOKEN wherever git runs');
  console.log("a team board's map describes the shared default branch, so CI is its one writer (--workflow): keep hooks to checkouts only you commit to");
  return token;
}
async function codemapMain(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) if (argv[i].startsWith('--')) args[argv[i].slice(2)] = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true;
  const need = (k) => { if (!args[k] || args[k] === true) { console.error(\`--\${k} is required\`); process.exit(2); } return args[k]; };
  const site = need('site').replace(/\\/$/, ''), project = need('project'), repo = need('repo');
  const root = args.root && args.root !== true ? args.root : process.cwd();
  const label = args.label && args.label !== true ? args.label : undefined;
  if (args.workflow) return codemapWorkflow({ site, project, repo, label, root });
  let token = args.token && args.token !== true ? args.token : process.env.ARTIBOARD_TOKEN;
  // installed hooks build once now, so the map exists before the next commit
  if (args.hook) token = await codemapHook({ site, project, repo, label, root, token });
  if (!token) { console.error('pass --token or set ARTIBOARD_TOKEN'); process.exit(2); }
  const url = \`\${site}/api/p/\${encodeURIComponent(project)}/map\`, auth = { Authorization: \`Bearer \${token}\` };
  // a clean checkout at the commit the site's map describes, with no changes of its own, has nothing new to send; a
  // site that cannot say (an older one answers 405) gets the map, as without --if-changed
  const head = args['if-changed'] || args.hook ? await headState(root) : {};
  if (head.commit && !head.dirty) {
    const res = await fetch(url, { headers: auth });
    const maps = res.ok ? (await res.json().catch(() => ({}))).maps || [] : [];
    const have = maps.find((m) => repoKey(m.repo) === repoKey(repo));
    if (have && have.commit === head.commit && !have.dirty) {
      console.log(\`up to date: \${repo} at \${mapSource(head)[0]} on \${site}/p/\${project}\`);
      return;
    }
  }
  const started = Date.now();
  const { index, chunks } = await mapRepo(root, { repo, label, ...head });
  // a map whose files were read while HEAD moved on would say one commit and hold another's files, so it is not sent:
  // the hook of the newer commit sends the right one (a cherry-pick's last pick; post-rewrite, once a rebase ends)
  if (head.commit && (await headState(root)).commit !== head.commit) { console.log(\`skipped: HEAD moved while \${repo} was read\`); return; }
  // gzipped bytes as an octet stream: a map's JSON is large and hosts cap request bodies, and a host that parses
  // JSON bodies itself would choke on compressed JSON; the server inflates what starts with the gzip magic bytes
  const res = await fetch(url, {
    method: 'POST', headers: { 'Content-Type': 'application/octet-stream', ...auth },
    body: gzipSync(JSON.stringify({ repo, index, chunks, root })),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) { console.error(\`upload failed (\${res.status}): \${body.message || body.error || 'unknown'}\`); process.exit(1); }
  const c = index.counts || {};
  console.log([\`\${repo} → \${site}/p/\${project}: \${c.files || 0} files, \${c.symbols || 0} symbols, \${c.edges || 0} edges in \${body.chunks} chunks (\${Date.now() - started} ms)\`,
    ...mapSource(index)].join(' · '));
  for (const com of (index.communities || []).slice(0, 8)) console.log(\`  \${com.name} · \${com.n} files · \${(com.top || []).slice(0, 3).join(', ')}\`);
}
if (import.meta.url === \`file://\${process.argv[1]}\` || process.argv[1]?.endsWith('codemap.mjs')) codemapMain(process.argv.slice(2)).catch((e) => { console.error(e.message || e); process.exit(1); });
`;

const out = `#!/usr/bin/env node
// Generated by scripts/inline-codemap.mjs from server/codemap/* into skills/artiboard/scripts/codemap.mjs and
// server/public/codemap.mjs; do not edit: change those files and rebuild.
// Maps a repository (files, symbols, imports, calls, docs) and uploads the map to a board. Needs Node 22 and nothing else.
${[...hoisted].sort().join('\n')}

${parts.join('\n')}${main}`;

// a duplicate top-level name across modules is a syntax error in the bundle and nowhere else: let node find it
const probe = join(tmpdir(), `codemap-${process.pid}.mjs`);
writeFileSync(probe, out);
const parsed = spawnSync(process.execPath, ['--check', probe], { encoding: 'utf8' });
rmSync(probe, { force: true });
if (parsed.status !== 0) { console.error(parsed.stderr.trim()); process.exit(1); }

const stale = OUTS.filter((p) => { try { return read(p) !== out; } catch { return true; } });
if (process.argv.includes('--check')) {
  if (stale.length) { console.error(`stale: ${stale.join(', ')}; run node scripts/inline-codemap.mjs`); process.exit(1); }
  console.log('codemap script current');
} else {
  for (const p of stale) {
    mkdirSync(new URL('.', new URL(p, root)), { recursive: true });
    writeFileSync(new URL(p, root), out);
    console.log(`${p} built from ${order.length} modules`);
  }
}
