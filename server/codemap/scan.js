// The code map's only contact with the file system: which files a checkout has, their text, and its commit.
// Git's own listing is used when there is one, so .gitignore decides what is left out.
import { execFile } from 'node:child_process';
import { open, readFile, readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';

const scanExec = promisify(execFile);

// folders that hold installed, built or cached files rather than the project's own code
const SCAN_SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', 'out', 'vendor', 'target', '.venv', '__pycache__', 'coverage']);
const SCAN_LOCKS = new Set(['package-lock.json', 'yarn.lock', 'pnpm-lock.yaml', 'Cargo.lock', 'poetry.lock', 'go.sum']);
const SCAN_MAX_BYTES = 1024 * 1024;
const SCAN_SNIFF_BYTES = 8192;
// generated code says so near its top; its names belong to the files it was made from
const SCAN_GENERATED = /\bgenerated\b|\bdo not edit\b/i;

async function scanGit(root, args) {
  const { stdout } = await scanExec('git', args, { cwd: root, maxBuffer: 256 * 1024 * 1024 });
  return stdout;
}

async function scanWalk(root, dir, out) {
  const entries = await readdir(join(root, dir), { withFileTypes: true }).catch(() => []);
  for (const e of entries) {
    const path = dir ? `${dir}/${e.name}` : e.name;
    // links are not followed: a link to a parent folder would never end
    if (e.isDirectory() && !SCAN_SKIP_DIRS.has(e.name)) await scanWalk(root, path, out);
    else if (e.isFile()) out.push(path);
  }
  return out;
}

const scanNamed = (path) => {
  const parts = path.split('/'), base = parts[parts.length - 1];
  return !parts.slice(0, -1).some((p) => SCAN_SKIP_DIRS.has(p)) && !SCAN_LOCKS.has(base) && !/\.min\.js$/i.test(base);
};

// A regular file of at most 1 MiB, with no NUL byte near its start (binary files carry no names worth mapping) and
// no "generated" or "do not edit" in its first five lines.
async function scanWanted(root, path) {
  try {
    const st = await stat(join(root, path));
    if (!st.isFile() || st.size > SCAN_MAX_BYTES) return false;
    const fh = await open(join(root, path), 'r');
    try {
      const buf = Buffer.alloc(Math.min(SCAN_SNIFF_BYTES, st.size));
      const { bytesRead } = await fh.read(buf, 0, buf.length, 0);
      const head = buf.subarray(0, bytesRead);
      return head.indexOf(0) < 0 && !SCAN_GENERATED.test(head.toString('utf8').split('\n', 5).join('\n'));
    } finally { await fh.close(); }
  } catch { return false; }
}

// many files at once, but not so many that the process runs out of file handles
async function scanEach(items, fn, width = 64) {
  const out = new Array(items.length);
  for (let i = 0; i < items.length; i += width) {
    const part = await Promise.all(items.slice(i, i + width).map(fn));
    for (let j = 0; j < part.length; j++) out[i + j] = part[j];
  }
  return out;
}

// repo-relative paths with '/' separators, sorted
export async function listFiles(root) {
  let paths;
  try {
    if ((await scanGit(root, ['rev-parse', '--is-inside-work-tree'])).trim() !== 'true') throw new Error('not a work tree');
    paths = (await scanGit(root, ['ls-files', '-z', '--cached', '--others', '--exclude-standard'])).split('\0').filter(Boolean);
  } catch {
    paths = await scanWalk(root, '', []);
  }
  paths = [...new Set(paths)].filter(scanNamed);
  const keep = await scanEach(paths, (p) => scanWanted(root, p));
  return paths.filter((p, i) => keep[i]).sort();
}

export async function readFiles(root, paths) {
  const texts = await scanEach(paths, (p) => readFile(join(root, p), 'utf8').catch(() => null));
  const out = new Map();
  paths.forEach((p, i) => { if (texts[i] != null) out.set(p, texts[i]); });
  return out;
}

// the checked-out commit, or undefined outside a git work tree
export async function headCommit(root) {
  try { return (await scanGit(root, ['rev-parse', 'HEAD'])).trim() || undefined; } catch { return undefined; }
}
