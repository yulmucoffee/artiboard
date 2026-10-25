// The code map's only contact with the file system: which files a checkout has, their text, and which commit they are.
// Git's own listing is used when there is one, so .gitignore decides what is left out.
import { execFile } from 'node:child_process';
import { lstat, open, readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';

const scanExec = promisify(execFile);

// folders that hold installed, built or cached files rather than the project's own code
const SCAN_SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', 'out', 'vendor', 'target', '.venv', '__pycache__', 'coverage']);
const SCAN_LOCKS = new Set(['package-lock.json', 'yarn.lock', 'pnpm-lock.yaml', 'Cargo.lock', 'poetry.lock', 'go.sum']);
const SCAN_MAX_BYTES = 1024 * 1024;
const SCAN_SNIFF_BYTES = 8192;
// Generated code says so in a comment near its top, and its names belong to the files it was made from. Only a comment
// line counts, and only these phrases: hand-written code says "generated" too (`from './generated/db'`).
const SCAN_COMMENT = /^\s*(\/\/|#|\/\*|\*|--|<!--|")/;
const SCAN_GENERATED = /generated (by|from|file|code)|auto-generated|do not edit/i;

async function scanGit(root, args) {
  const { stdout } = await scanExec('git', args, { cwd: root, maxBuffer: 256 * 1024 * 1024 });
  return stdout;
}

async function scanWalk(root, dir, out) {
  const entries = await readdir(join(root, dir), { withFileTypes: true }).catch(() => []);
  for (const e of entries) {
    const path = dir ? `${dir}/${e.name}` : e.name;
    // a link is neither a file nor a folder here: it may point out of the checkout, or at a parent folder
    if (e.isDirectory() && !SCAN_SKIP_DIRS.has(e.name)) await scanWalk(root, path, out);
    else if (e.isFile()) out.push(path);
  }
  return out;
}

const scanNamed = (path) => {
  const parts = path.split('/'), base = parts[parts.length - 1];
  return !parts.slice(0, -1).some((p) => SCAN_SKIP_DIRS.has(p)) && !SCAN_LOCKS.has(base) && !/\.min\.js$/i.test(base);
};

// A regular file, not a link (git lists links too, and one may point out of the checkout), of at most 1 MiB, with no
// NUL byte near its start (binary files carry no names worth mapping), that no comment in its first five lines calls
// generated.
async function scanWanted(root, path) {
  try {
    const st = await lstat(join(root, path));
    if (!st.isFile() || st.size > SCAN_MAX_BYTES) return false;
    const fh = await open(join(root, path), 'r');
    try {
      const buf = Buffer.alloc(Math.min(SCAN_SNIFF_BYTES, st.size));
      const { bytesRead } = await fh.read(buf, 0, buf.length, 0);
      const head = buf.subarray(0, bytesRead);
      return head.indexOf(0) < 0 && !head.toString('utf8').split('\n', 5).some((l) => SCAN_COMMENT.test(l) && SCAN_GENERATED.test(l));
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

// '/' separators and a sorted order whatever the system, so one checkout always gives the same map
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

// Which code the checkout holds: the commit (none outside git or before the first one), its branch (none when the head
// is detached) and whether the files differ from it, by an edit or by an untracked file listFiles would map. The status
// takes no lock, so a build running beside the person's own git commands never makes them fail.
export async function headState(root) {
  const git = (args) => scanGit(root, args).then((out) => out.trim(), () => undefined);
  const [commit, branch, status] = await Promise.all([git(['rev-parse', 'HEAD']), git(['rev-parse', '--abbrev-ref', 'HEAD']),
    git(['--no-optional-locks', 'status', '--porcelain', '--', '.'])]);
  return { commit: commit || undefined, branch: branch && branch !== 'HEAD' ? branch : undefined, dirty: status === undefined ? undefined : status !== '' };
}
