// The Python extractor (server/codemap/lang/python.js) on tests/fixtures/codemap/python/ledger.py. The expected rows
// are written from the fixture by hand. The traps are a commented-out def, a docstring and a string that say
// "class Ghost", a def nested in a method, and a multi-line import with a comment inside it.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { pythonLang } from '../server/codemap/lang/python.js';

const source = readFileSync(new URL('./fixtures/codemap/python/ledger.py', import.meta.url), 'utf8');
const found = pythonLang.extract(source);
const EMPTY = { symbols: [], imports: [], refs: [], extends: [] };

// Sorted, the way the build passes the repository's files.
const FILES = [
  'app/__init__.py',
  'app/billing/__init__.py',
  'app/billing/ledger.py',
  'app/billing/money.py',
  'app/shared/errors.py',
  'app/shared/util/__init__.py',
  'lib/tools.py',
  'lib/tools/__init__.py',
  'src/acme/core.py',
  'src/acme/store/__init__.py',
  'tests/test_ledger.py',
];

test('symbols: module-level defs, classes and assignments, and the methods of a class, by line', () => {
  assert.deepEqual(found.symbols, [
    { name: 'MAX_ENTRIES', kind: 'const', line: 24, exported: true },
    { name: 'DEFAULT_CURRENCY', kind: 'const', line: 25, exported: true },
    { name: 'SEPARATOR', kind: 'const', line: 26, exported: true },
    { name: '_cache', kind: 'var', line: 27, exported: false },
    { name: 'note', kind: 'var', line: 28, exported: true },
    { name: 'parse_entry', kind: 'fn', line: 31, exported: true },
    { name: 'load_entries', kind: 'fn', line: 38, exported: true },
    { name: 'Entry', kind: 'class', line: 44, exported: true },
    { name: 'Entry.__init__', kind: 'method', line: 47, exported: true },
    { name: 'Entry.signed', kind: 'method', line: 52, exported: true },
    { name: 'Entry._audit', kind: 'method', line: 56, exported: false },
    { name: 'Entry.blank', kind: 'method', line: 60, exported: true },
    { name: 'Ledger', kind: 'class', line: 64, exported: true },
    { name: 'Ledger.post', kind: 'method', line: 65, exported: true },
    { name: 'Ledger.total', kind: 'method', line: 71, exported: true },
    { name: 'Ledger.describe', kind: 'method', line: 74, exported: true },
    { name: 'build_default', kind: 'fn', line: 80, exported: true },
  ], 'no commented, quoted or nested def, and no class attribute, becomes a symbol');
});

test('imports: plain, dotted, aliased, relative, and the parenthesized multi-line one', () => {
  assert.deepEqual(found.imports, [
    { spec: '__future__', line: 6, names: ['annotations'] },
    { spec: 'json', line: 8 },
    { spec: 'os.path', line: 9 },
    { spec: 'decimal', line: 10 },
    { spec: '.money', line: 11, names: ['Money', 'parse_money'] },
    { spec: '..shared.errors', line: 12, names: ['LedgerError', 'Overdraft'] },
    { spec: '..shared', line: 16, names: ['util'] },
  ]);
});

test('refs: calls, constructions and decorators by their last segment; defs and keywords are not refs', () => {
  assert.deepEqual(found.refs, [
    { name: 'parse_money', line: 33 },
    { name: 'Entry', line: 34 },
    { name: 'get', line: 34 },
    { name: 'cached', line: 37 },
    { name: 'open', line: 39 },
    { name: 'loads', line: 40 },
    { name: 'parse_entry', line: 41 },
    { name: 'super', line: 48 },
    { name: '__init__', line: 48 },
    { name: 'property', line: 51 },
    { name: 'startswith', line: 53 },
    { name: 'staticmethod', line: 59 },
    { name: 'Entry', line: 61 },
    { name: 'Money', line: 61 },
    { name: 'Overdraft', line: 67 },
    { name: 'append', line: 68 },
    { name: 'Decimal', line: 69 },
    { name: 'sum', line: 72 },
    { name: 'str', line: 76 },
    { name: 'label', line: 77 },
    { name: 'join', line: 80 },
    { name: 'Ledger', line: 81 },
    { name: 'post', line: 82 },
    { name: 'parse_entry', line: 82 },
    { name: 'print', line: 87 },
    { name: 'build_default', line: 87 },
    { name: 'total', line: 87 },
  ]);
});

test('extends: each base of a class, by its last segment', () => {
  assert.deepEqual(found.extends, [
    { name: 'Entry', base: 'Money', line: 44 },
    { name: 'Ledger', base: 'Entry', line: 64 },
    { name: 'Ledger', base: 'Mixin', line: 64 },
  ]);
});

test('resolve: relative specs count dots from the importing file\'s package', () => {
  const from = 'app/billing/ledger.py';
  assert.equal(pythonLang.resolve('.money', from, FILES), 'app/billing/money.py');
  assert.equal(pythonLang.resolve('.', from, FILES), 'app/billing/__init__.py', 'the package itself');
  assert.equal(pythonLang.resolve('..shared.errors', from, FILES), 'app/shared/errors.py');
  assert.equal(pythonLang.resolve('..shared.util', from, FILES), 'app/shared/util/__init__.py', 'a package directory');
  assert.equal(pythonLang.resolve('.missing', from, FILES), null);
  assert.equal(pythonLang.resolve('....shared.errors', from, FILES), null, 'more dots than the repository has levels');
});

test('resolve: absolute specs from the root, a src/ layout, and a file before a package', () => {
  const from = 'tests/test_ledger.py';
  assert.equal(pythonLang.resolve('app.billing.money', from, FILES), 'app/billing/money.py');
  assert.equal(pythonLang.resolve('app.billing', from, FILES), 'app/billing/__init__.py');
  assert.equal(pythonLang.resolve('acme.core', from, FILES), 'src/acme/core.py', 'src/ is not part of the name');
  assert.equal(pythonLang.resolve('acme.store', from, FILES), 'src/acme/store/__init__.py');
  assert.equal(pythonLang.resolve('lib.tools', from, FILES), 'lib/tools.py', 'lib/tools.py beats lib/tools/__init__.py');
  assert.equal(pythonLang.resolve('requests', from, FILES), null, 'a package, not in the repository');
  assert.equal(pythonLang.resolve('requests.adapters', from, FILES), null);
  assert.equal(pythonLang.resolve('json', from, []), null, 'an empty file list resolves nothing');
  assert.equal(pythonLang.resolve('', from, FILES), null);
});

test('empty input and comment-only input give empty results', () => {
  assert.deepEqual(pythonLang.extract(''), EMPTY);
  assert.deepEqual(pythonLang.extract('# def hidden():\n# class Hidden(Base):\n#   pass\n'), EMPTY);
  assert.deepEqual(pythonLang.extract(null), EMPTY);
});

test('malformed input gives arrays, not exceptions', () => {
  for (const bad of ['class (:\n  def f(\n', '"""never closed\ndef g():\n', 'x = [\n', 'from import\nimport\n@\n']) {
    const out = pythonLang.extract(bad);
    assert.ok(Array.isArray(out.symbols) && Array.isArray(out.imports) && Array.isArray(out.refs));
    assert.ok(Array.isArray(out.extends));
  }
});
