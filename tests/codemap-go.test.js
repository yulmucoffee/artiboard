// The Go extractor on tests/fixtures/codemap/go/store.go. The expected values are read from the fixture by
// hand (line numbers included), not copied from the output. Refs are compared sorted by line and name,
// because one line can hold several calls.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { goLang } from '../server/codemap/lang/go.js';

const text = readFileSync(new URL('./fixtures/codemap/go/store.go', import.meta.url), 'utf8');
const byLineName = (a, b) => a.line - b.line || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0);

test('go: symbols are the funcs, methods, types, vars and consts; comments and strings add none', () => {
  assert.deepEqual(goLang.extract(text).symbols, [
    { name: 'DefaultLimit', kind: 'const', line: 25, exported: true },
    { name: 'maxBatch', kind: 'const', line: 26, exported: false },
    { name: 'ErrMissing', kind: 'var', line: 29, exported: true },
    { name: 'lookup', kind: 'var', line: 31, exported: false },
    { name: 'cache', kind: 'var', line: 31, exported: false },
    { name: 'Version', kind: 'const', line: 33, exported: true },
    { name: 'Store', kind: 'type', line: 36, exported: true },
    { name: 'Base', kind: 'type', line: 43, exported: true },
    { name: 'Reader', kind: 'type', line: 47, exported: true },
    { name: 'Count', kind: 'type', line: 52, exported: true },
    { name: 'New', kind: 'fn', line: 54, exported: true },
    { name: 'Store.Put', kind: 'method', line: 61, exported: true },
    { name: 'Store.Size', kind: 'method', line: 68, exported: true },
    { name: 'Store.Dump', kind: 'method', line: 72, exported: true },
    { name: 'helper', kind: 'fn', line: 81, exported: false },
    { name: 'init', kind: 'fn', line: 85, exported: false },
    { name: 'limitA', kind: 'var', line: 90, exported: false },
    { name: 'limitB', kind: 'var', line: 90, exported: false },
    { name: 'build', kind: 'var', line: 91, exported: false },
  ]);
});

test('go: imports keep the quoted path; a grouped alias names its alias; blank imports name nothing', () => {
  assert.deepEqual(goLang.extract(text).imports, [
    { spec: 'context', line: 5, names: ['context'] },
    { spec: 'encoding/json', line: 6, names: ['json'] },
    { spec: 'fmt', line: 7, names: ['fmt'] },
    { spec: 'sync', line: 8, names: ['sync'] },
    { spec: 'github.com/example/jsonfast', line: 10, names: ['jsonlib'] },
    { spec: 'embed', line: 11 },
    { spec: 'github.com/example/board/internal/tasks', line: 12, names: ['tasks'] },
    { spec: 'strings', line: 15, names: ['strings'] },
  ]);
});

test('go: calls and exported composite literals are refs; declared names and keywords are not', () => {
  const refs = goLang.extract(text).refs.sort(byLineName);
  assert.deepEqual(refs, [
    { name: 'Errorf', line: 29 },
    { name: 'Store', line: 58 },
    { name: 'Lock', line: 62 },
    { name: 'Unlock', line: 63 },
    { name: 'Count', line: 76 },
    { name: 'Marshal', line: 76 },
    { name: 'Index', line: 77 },
    { name: 'Name', line: 77 },
    { name: 'Println', line: 77 },
    { name: 'helper', line: 78 },
    { name: 'Sprint', line: 82 },
    { name: 'ToUpper', line: 82 },
    { name: 'Print', line: 86 },
    { name: 'configure', line: 91 },
  ]);
});

test('go: a struct or interface line that is just a type name extends the type it sits in', () => {
  assert.deepEqual(goLang.extract(text).extends, [
    { name: 'Store', base: 'Base', line: 38 },
    { name: 'Store', base: 'Index', line: 39 },
    { name: 'Reader', base: 'Stringer', line: 49 },
  ]);
});

const FILES = [
  'README.md',
  'cmd/board/main.go',
  'go.mod',
  'internal/log/log.go',
  'internal/only/only_test.go',
  'internal/tasks/index.go',
  'internal/tasks/index_test.go',
  'internal/tasks/tasks.go',
  'pkg/store/store.go',
  'pkg/store/store_test.go',
];

test('go: an import resolves to the first non-test .go file of its package directory', () => {
  const resolve = goLang.resolve;
  assert.equal(resolve('github.com/example/board/internal/tasks', 'cmd/board/main.go', FILES), 'internal/tasks/index.go');
  assert.equal(resolve('github.com/example/board/pkg/store', 'cmd/board/main.go', FILES), 'pkg/store/store.go');
  assert.equal(resolve('github.com/example/board/internal/log', 'cmd/board/main.go', FILES), 'internal/log/log.go');
  assert.equal(resolve('example.com/tasks', 'cmd/board/main.go', ['a/tasks/x.go', 'b/tasks/y.go']), 'a/tasks/x.go', 'two packages with the tail: the first by name wins');
  assert.equal(resolve('example.com/app/tasks', 'cmd/board/main.go', FILES), 'internal/tasks/index.go', 'a shorter tail matches a directory');
});

test('go: stdlib, relative and test-only package paths resolve to nothing', () => {
  const resolve = goLang.resolve;
  assert.equal(resolve('encoding/json', 'pkg/store/store.go', FILES), null);
  assert.equal(resolve('fmt', 'pkg/store/store.go', FILES), null);
  assert.equal(resolve('./local', 'pkg/store/store.go', FILES), null);
  assert.equal(resolve('github.com/example/board/internal/only', 'cmd/board/main.go', FILES), null, 'a directory with only _test.go files is no package');
});

test('go: empty, comment-only and malformed input gives empty results without throwing', () => {
  for (const src of ['', '// only a comment\n/* and a block\n*/\n']) {
    assert.deepEqual(goLang.extract(src), { symbols: [], imports: [], refs: [], extends: [] });
  }
  assert.doesNotThrow(() => goLang.extract('func (r *T) \nimport (\n"open\ntype X struct {\n\tA\n'));
  assert.doesNotThrow(() => goLang.resolve('', 'a.go', []));
  // An unterminated string ends at its line, so the next line is still read.
  assert.deepEqual(goLang.extract('var s = "open\nfunc Real() {}\n').symbols.map((s) => s.name), ['s', 'Real']);
});
