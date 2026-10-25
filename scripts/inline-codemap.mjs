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

const hoisted = new Set(["import { gzipSync } from 'node:zlib';"]), names = new Map(), parts = [];
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
// The token comes from --token or ARTIBOARD_TOKEN. What leaves the machine: paths, names, line numbers, each symbol's
// declaration line (a constant's without its value) and the comment above it. No bodies. --if-changed asks the site
// first and builds nothing when its map already describes this commit and neither it nor the checkout had changes no
// commit holds, so CI or a git hook can run it on every commit.
async function codemapMain(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) if (argv[i].startsWith('--')) args[argv[i].slice(2)] = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true;
  const need = (k) => { if (!args[k] || args[k] === true) { console.error(\`--\${k} is required\`); process.exit(2); } return args[k]; };
  const site = need('site').replace(/\\/$/, ''), project = need('project'), repo = need('repo');
  const token = args.token && args.token !== true ? args.token : process.env.ARTIBOARD_TOKEN;
  if (!token) { console.error('pass --token or set ARTIBOARD_TOKEN'); process.exit(2); }
  const root = args.root && args.root !== true ? args.root : process.cwd();
  const url = \`\${site}/api/p/\${encodeURIComponent(project)}/map\`, auth = { Authorization: \`Bearer \${token}\` };
  // a clean checkout at the commit the site's map describes, with no changes of its own, has nothing new to send; a
  // site that cannot say (an older one answers 405) gets the map, as without --if-changed
  const head = args['if-changed'] ? await headState(root) : {};
  if (head.commit && !head.dirty) {
    const res = await fetch(url, { headers: auth });
    const maps = res.ok ? (await res.json().catch(() => ({}))).maps || [] : [];
    const have = maps.find((m) => String(m.repo).toLowerCase() === repo.toLowerCase());
    if (have && have.commit === head.commit && !have.dirty) {
      console.log(\`up to date: \${repo} at \${mapSource(head)[0]} on \${site}/p/\${project}\`);
      return;
    }
  }
  const started = Date.now();
  const { index, chunks } = await mapRepo(root, { repo, label: args.label && args.label !== true ? args.label : undefined, ...head });
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
