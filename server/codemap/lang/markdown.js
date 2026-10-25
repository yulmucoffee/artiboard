// Markdown: headings become a doc's sections, and the repo paths and backticked names it writes become mentions,
// so a search for some code also finds the docs that explain it. Which mentions are real is decided at build time,
// against the repo's files and symbols.

// file endings a word must have to read as a file name when it has no '/'
const MD_FILE_EXTS = 'js|mjs|cjs|jsx|ts|tsx|mts|cts|py|rb|go|rs|java|kt|kts|cs|swift|php|c|h|cc|cpp|hpp|sql|md|mdx|json|ya?ml|toml|sh|html|css|scss|vue|svelte';
const MD_PATH = new RegExp(`(?:\\.{1,2}/)?[\\w@~.-]+(?:/[\\w@~.-]+)+|[\\w@~-][\\w@~.-]*\\.(?:${MD_FILE_EXTS})(?![\\w-])`, 'g');
const MD_NAME = /^[A-Za-z_$][\w$]*(?:[.#][A-Za-z_$][\w$]*)*$/;
// `doing` or `member` in prose is a word; `fetchCart`, `Cart`, `parse_amount`, `Cart.add` or `fetch()` is code
const MD_CODE = /[a-z0-9][A-Z]|^[A-Z]|[_.#$]/;
const MD_URL = /\b[a-z][a-z0-9+.-]*:\/\/\S+|\bwww\.\S+/gi;

// a section reads as its words, and its id stays the same when only the markup around them changes
function mdHeading(s) {
  return s.replace(/\s+#+\s*$/, '').replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/[`*_]/g, '').trim();
}

function mdPaths(line, n, refs) {
  for (const m of line.replace(MD_URL, ' ').matchAll(MD_PATH)) {
    const p = m[0].replace(/[.,;:!?]+$/, '');
    if (p && !p.endsWith('/')) refs.push({ name: p, line: n, path: true });
  }
}

function mdExtract(text) {
  const out = { symbols: [], imports: [], refs: [], extends: [] };
  if (!text) return out;
  const lines = text.split(/\r?\n/);
  let fence = '', start = 0;
  // front matter is data, and its closing --- would read as a heading underline
  if (/^---\s*$/.test(lines[0])) {
    const close = lines.findIndex((l, i) => i > 0 && /^(---|\.\.\.)\s*$/.test(l));
    if (close > 0) start = close + 1;
  }
  for (let i = start; i < lines.length; i++) {
    const line = lines[i], n = i + 1;
    const f = /^ {0,3}(`{3,}|~{3,})/.exec(line);
    if (f && (!fence || f[1][0] === fence[0] && f[1].length >= fence.length)) { fence = fence ? '' : f[1]; continue; }
    if (fence) { mdPaths(line, n, out.refs); continue; }
    const atx = /^ {0,3}(#{1,6})\s+(.*)$/.exec(line);
    const prev = i > start ? lines[i - 1] : '';
    const underline = /^ {0,3}(=+|-+)\s*$/.exec(line);
    if (atx && mdHeading(atx[2])) {
      out.symbols.push({ name: mdHeading(atx[2]), kind: `h${atx[1].length}`, line: n });
    } else if (underline && prev.trim() && !/^ {0,3}([-*+>#|]|\d+[.)])/.test(prev) && out.symbols.every((s) => s.line !== i)) {
      // Title followed by === or ---: the heading is the line above
      out.symbols.push({ name: mdHeading(prev), kind: underline[1][0] === '=' ? 'h1' : 'h2', line: i });
      continue;
    }
    const plain = line.replace(/<!--.*?-->/g, ' ');
    for (const m of plain.matchAll(/`([^`]+)`/g)) {
      const written = m[1].trim(), name = written.replace(/\(.*\)$/, '');
      if (MD_NAME.test(name) && (name !== written || MD_CODE.test(name))) out.refs.push({ name, line: n });
    }
    mdPaths(plain, n, out.refs);
  }
  // a section runs to the line before the next heading
  out.symbols.sort((a, b) => a.line - b.line);
  const last = lines.length - (lines[lines.length - 1] === '' ? 1 : 0);
  out.symbols.forEach((s, i) => { s.end = i + 1 < out.symbols.length ? out.symbols[i + 1].line - 1 : last; });
  return out;
}

export const markdownLang = {
  id: 'md',
  exts: ['.md', '.mdx', '.markdown'],
  // its file is a doc and its symbols are sections
  doc: true,
  extract: mdExtract,
  resolve: () => null,
};
