// The five READMEs are one document in five languages: the same headings, tables, code blocks and links in the same
// order. Prints the first place a translation's shape differs from README.md; exits 1 if any does.
import { readFileSync } from 'node:fs';

const FILES = ['README.md', 'README.ko.md', 'README.ja.md', 'README.es.md', 'README.zh-CN.md'];
const shape = (line) => {
  if (/^#{1,6} /.test(line)) return line.match(/^#+/)[0];
  if (line.startsWith('|')) return `| x${line.split('|').length - 2}`;
  if (line.startsWith('```')) return '```';
  if (line.startsWith('<')) return line.replace(/>[^<]*</g, '><').replace(/"[^"]*"/g, '""');
  if (!line.trim()) return '';
  return 'text';
};
const read = (f) => readFileSync(new URL(`../${f}`, import.meta.url), 'utf8').split('\n').map(shape);

const base = read(FILES[0]);
let bad = 0;
for (const f of FILES.slice(1)) {
  const other = read(f), n = Math.max(base.length, other.length);
  for (let i = 0; i < n; i++) {
    if (base[i] !== other[i]) {
      console.error(`${f}:${i + 1} is "${other[i] ?? '(end)'}" where README.md:${i + 1} is "${base[i] ?? '(end)'}"`);
      bad++;
      break;
    }
  }
}
if (bad) process.exit(1);
console.log(`README shape: ${FILES.length} languages match (${base.length} lines)`);
