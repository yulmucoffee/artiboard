// The Java extractor (server/codemap/lang/java.js) on one fixture file. Expected values are read from the fixture by
// hand: a commented-out class, a string and a text block that mention classes, a static import, nested types, an
// interface implementation, annotations and a record must come out exactly as listed here.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { javaLang } from '../server/codemap/lang/java.js';

const fixture = readFileSync(new URL('./fixtures/codemap/java/Invoice.java', import.meta.url), 'utf8');
const result = javaLang.extract(fixture, 'com/acme/billing/Invoice.java');

test('symbols: exact names, kinds, lines and exported flags', () => {
  assert.deepEqual(result.symbols, [
    { name: 'Invoice', kind: 'class', line: 19, exported: true },
    { name: 'Invoice.MAX_LINES', kind: 'const', line: 21, exported: true },
    { name: 'Invoice.SEED', kind: 'const', line: 22, exported: false },
    { name: 'Invoice.PREFIX', kind: 'const', line: 23, exported: false },
    { name: 'Invoice.TEMPLATE', kind: 'const', line: 24, exported: false },
    { name: 'Invoice.describe', kind: 'method', line: 39, exported: true },
    { name: 'Invoice.add', kind: 'method', line: 43, exported: true },
    { name: 'Invoice.note', kind: 'method', line: 51, exported: true },
    { name: 'Invoice.recount', kind: 'method', line: 57, exported: false },
    { name: 'Invoice.firstOr', kind: 'method', line: 64, exported: false },
    { name: 'Invoice.Builder', kind: 'class', line: 68, exported: true },
    { name: 'Invoice.Builder.number', kind: 'method', line: 71, exported: true },
    { name: 'Invoice.Builder.build', kind: 'method', line: 76, exported: true },
    { name: 'Invoice.Visitor', kind: 'type', line: 81, exported: true },
    { name: 'Invoice.Visitor.visit', kind: 'method', line: 82, exported: false },
    { name: 'Invoice.Status', kind: 'enum', line: 89, exported: true },
    { name: 'Invoice.Line', kind: 'class', line: 91, exported: true },
    { name: 'Invoice.Line.amount', kind: 'method', line: 92, exported: true },
    { name: 'Discount', kind: 'class', line: 98, exported: false },
    { name: 'Discount.applyTo', kind: 'method', line: 99, exported: false },
    { name: 'Discount.getX', kind: 'method', line: 102, exported: true },
    { name: 'Discount.n', kind: 'method', line: 103, exported: false },
  ]);
});

test('no symbol comes from a comment, a string, a text block or a second nesting level', () => {
  const names = result.symbols.map((s) => s.name).join(' ');
  for (const hidden of ['Retired', 'AlsoRetired', 'Fake', 'Phantom', 'ghost', 'Deep', 'deepMethod']) {
    assert.equal(names.includes(hidden), false, `${hidden} must not be a symbol`);
  }
});

test('imports: spec as written, its line, and the names it brings', () => {
  assert.deepEqual(result.imports, [
    { spec: 'com.acme.money.Money.zero', line: 3, names: ['zero'] },
    { spec: 'com.acme.money.Money', line: 4, names: ['Money'] },
    { spec: 'com.acme.tax.TaxRule', line: 5, names: ['TaxRule'] },
    { spec: 'com.acme.util.*', line: 6, names: [] },
    { spec: 'java.util.ArrayList', line: 7, names: ['ArrayList'] },
    { spec: 'java.util.List', line: 8, names: ['List'] },
    { spec: 'javax.annotation.Nullable', line: 9, names: ['Nullable'] },
  ]);
});

test('extends: the base list of each class, implements included', () => {
  assert.deepEqual(result.extends, [
    { name: 'Invoice', base: 'Document', line: 19 },
    { name: 'Invoice', base: 'Payable', line: 19 },
    { name: 'Invoice', base: 'Printable', line: 19 },
    { name: 'Invoice.Line', base: 'Printable', line: 91 },
  ]);
});

test('refs: calls by last segment, constructions, annotations, bases; declarations are not refs', () => {
  assert.deepEqual(result.refs, [
    { name: 'Audited', line: 18 },
    { name: 'Document', line: 19 },
    { name: 'Payable', line: 19 },
    { name: 'Printable', line: 19 },
    { name: 'ArrayList', line: 30 },
    { name: 'zero', line: 31 },
    { name: 'Override', line: 38 },
    { name: 'number', line: 40 },
    { name: 'size', line: 40 },
    { name: 'size', line: 44 },
    { name: 'IllegalStateException', line: 45 },
    { name: 'add', line: 47 },
    { name: 'recount', line: 48 },
    { name: 'Nullable', line: 51 },
    { name: 'wrap', line: 53 },
    { name: 'zero', line: 58 },
    { name: 'plus', line: 60 },
    { name: 'apply', line: 60 },
    { name: 'amount', line: 60 },
    { name: 'isEmpty', line: 65 },
    { name: 'get', line: 65 },
    { name: 'requireNonNull', line: 72 },
    { name: 'Invoice', line: 77 },
    { name: 'Printable', line: 91 },
  ]);
});

test('resolve: exact path, source roots, a suffix match, and a class file for a static or nested name', () => {
  // Sorted, as the build passes it.
  const files = [
    'app/Main.java',
    'com/acme/money/Money.java',
    'com/acme/tax/TaxRule.java',
    'com/acme/util/Format.java',
    'modules/api/src/main/java/com/acme/api/Api.java',
    'src/com/acme/legacy/Old.java',
    'src/main/java/com/acme/billing/Invoice.java',
  ];
  const from = 'app/Main.java';
  assert.equal(javaLang.resolve('com.acme.money.Money', from, files), 'com/acme/money/Money.java', 'exact path');
  assert.equal(javaLang.resolve('com.acme.billing.Invoice', from, files), 'src/main/java/com/acme/billing/Invoice.java', 'src/main/java root');
  assert.equal(javaLang.resolve('com.acme.legacy.Old', from, files), 'src/com/acme/legacy/Old.java', 'src root');
  assert.equal(javaLang.resolve('com.acme.api.Api', from, files), 'modules/api/src/main/java/com/acme/api/Api.java', 'any path ending in /com/acme/api/Api.java');
  assert.equal(javaLang.resolve('acme.util.Format', from, files), 'com/acme/util/Format.java', 'suffix match on whole segments');
  assert.equal(javaLang.resolve('com.acme.money.Money.zero', from, files), 'com/acme/money/Money.java', 'static member names its class');
  assert.equal(javaLang.resolve('com.acme.billing.Invoice.Line', from, files), 'src/main/java/com/acme/billing/Invoice.java', 'nested type names its outer file');
  assert.equal(javaLang.resolve('til.Format', from, files), null, 'a suffix must start at a segment');
  assert.equal(javaLang.resolve('com.acme.util.Missing', from, files), null, 'not in the repo');
});

test('resolve: wildcards and the JDK are not repo files', () => {
  const files = ['com/acme/util/Format.java', 'java/util.java'];
  assert.equal(javaLang.resolve('com.acme.util.*', 'app/Main.java', files), null);
  assert.equal(javaLang.resolve('java.util.List', 'app/Main.java', files), null, 'java.* is never a repo file');
  assert.equal(javaLang.resolve('javax.annotation.Nullable', 'app/Main.java', files), null);
  assert.equal(javaLang.resolve('org.example.check.Test', 'app/Main.java', files), null, 'a package outside the repo');
});

test('empty, comment-only and malformed input give empty results without throwing', () => {
  const empty = { symbols: [], imports: [], refs: [], extends: [] };
  assert.deepEqual(javaLang.extract('', 'A.java'), empty);
  assert.deepEqual(javaLang.extract('// only a comment\n/* and a block\n   comment */\n', 'A.java'), empty);
  assert.doesNotThrow(() => javaLang.extract('class {{{ "unterminated\n void f( \'\n """ open', 'A.java'));
  assert.doesNotThrow(() => javaLang.extract('}}} ) ( ;;; @', 'A.java'));
});
