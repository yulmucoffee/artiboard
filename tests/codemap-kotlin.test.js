// The Kotlin extractor (server/codemap/lang/kotlin.js) on one fixture file. Expected values are read from the fixture
// by hand: a commented-out class with a nested comment, a string and a raw string that mention classes, an aliased
// import, a companion object, nested types, a multi-line header, a data class and an extension function must come out
// exactly as listed here.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { kotlinLang } from '../server/codemap/lang/kotlin.js';

const fixture = readFileSync(new URL('./fixtures/codemap/kotlin/Order.kt', import.meta.url), 'utf8');
const result = kotlinLang.extract(fixture, 'com/acme/orders/Order.kt');

test('symbols: exact names, kinds, lines and exported flags', () => {
  assert.deepEqual(result.symbols, [
    { name: 'MAX_ITEMS', kind: 'const', line: 16, exported: true },
    { name: 'SECRET', kind: 'const', line: 17, exported: false },
    { name: 'defaultCurrency', kind: 'const', line: 18, exported: true },
    { name: 'retries', kind: 'var', line: 19, exported: true },
    { name: 'Order', kind: 'class', line: 22, exported: true },
    { name: 'Order.add', kind: 'method', line: 26, exported: true },
    { name: 'Order.total', kind: 'method', line: 32, exported: true },
    { name: 'Order.recount', kind: 'method', line: 34, exported: false },
    { name: 'String.shout', kind: 'method', line: 43, exported: true },
    { name: 'Order.wire', kind: 'method', line: 46, exported: false },
    { name: 'Order.VERSION', kind: 'const', line: 51, exported: true },
    { name: 'Order.create', kind: 'method', line: 52, exported: true },
    { name: 'Order.Line', kind: 'class', line: 55, exported: true },
    { name: 'Order.Line.amount', kind: 'method', line: 56, exported: true },
    { name: 'Order.Deep', kind: 'class', line: 59, exported: true },
    { name: 'Point', kind: 'class', line: 66, exported: true },
    { name: 'Invoice', kind: 'class', line: 68, exported: true },
    { name: 'Invoice.pay', kind: 'method', line: 73, exported: true },
    { name: 'Shape', kind: 'type', line: 76, exported: true },
    { name: 'Shape.area', kind: 'method', line: 77, exported: true },
    { name: 'Status', kind: 'enum', line: 80, exported: true },
    { name: 'Status.label', kind: 'method', line: 83, exported: true },
    { name: 'Outcome', kind: 'class', line: 86, exported: true },
    { name: 'Outcome.Done', kind: 'class', line: 87, exported: true },
    { name: 'Registry', kind: 'class', line: 90, exported: true },
    { name: 'Registry.lookup', kind: 'method', line: 91, exported: true },
    { name: 'main', kind: 'fn', line: 94, exported: true },
  ]);
});

test('no symbol comes from a comment, a string, a raw string or a second nesting level', () => {
  const names = result.symbols.map((s) => s.name).join(' ');
  for (const hidden of ['Retired', 'Ghost', 'Hidden', 'Fake', 'Phantom', 'ghost', 'hidden', 'Deeper', 'Companion']) {
    assert.equal(names.includes(hidden), false, `${hidden} must not be a symbol`);
  }
});

test('imports: spec as written (an alias is dropped), its line, and the names it brings', () => {
  assert.deepEqual(result.imports, [
    { spec: 'com.acme.money.Money', line: 3, names: ['Money'] },
    { spec: 'com.acme.tax.TaxRule', line: 4, names: ['TaxRule'] },
    { spec: 'com.acme.util.*', line: 5, names: [] },
    { spec: 'com.acme.util.Formatter', line: 6, names: ['Formatter'] },
    { spec: 'javax.inject.Inject', line: 7, names: ['Inject'] },
  ]);
});

test('extends: supertypes of each class, interface and object, from headers that span lines', () => {
  assert.deepEqual(result.extends, [
    { name: 'Order', base: 'Document', line: 22 },
    { name: 'Order', base: 'Payable', line: 22 },
    { name: 'Order', base: 'Printable', line: 22 },
    { name: 'Invoice', base: 'Document', line: 68 },
    { name: 'Invoice', base: 'Auditable', line: 68 },
    { name: 'Shape', base: 'Printable', line: 76 },
    { name: 'Outcome.Done', base: 'Outcome', line: 87 },
  ]);
});

test('refs: calls (generic ones too), constructions, annotations, supertypes; declarations are not refs', () => {
  assert.deepEqual(result.refs, [
    { name: 'Audited', line: 21 },
    { name: 'Document', line: 22 },
    { name: 'Payable', line: 22 },
    { name: 'Printable', line: 22 },
    { name: 'mutableListOf', line: 24 },
    { name: 'IllegalStateException', line: 27 },
    { name: 'add', line: 28 },
    { name: 'recount', line: 29 },
    { name: 'fold', line: 32 },
    { name: 'zero', line: 32 },
    { name: 'apply', line: 32 },
    { name: 'amount', line: 32 },
    { name: 'trimIndent', line: 39 },
    { name: 'println', line: 40 },
    { name: 'uppercase', line: 43 },
    { name: 'Inject', line: 45 },
    { name: 'format', line: 47 },
    { name: 'Order', line: 52 },
    { name: 'Document', line: 68 },
    { name: 'Auditable', line: 68 },
    { name: 'Document', line: 71 },
    { name: 'Printable', line: 76 },
    { name: 'lowercase', line: 83 },
    { name: 'Outcome', line: 87 },
    { name: 'Order', line: 95 },
    { name: 'add', line: 96 },
    { name: 'Line', line: 96 },
  ]);
});

test('resolve: exact path, source roots (Kotlin and Java), a suffix match, and the class file of a nested name', () => {
  // Sorted, as the build passes it.
  const files = [
    'com/acme/java/Legacy.java',
    'com/acme/money/Money.kt',
    'com/acme/tax/TaxRule.kt',
    'com/acme/util/Formatter.kt',
    'modules/web/src/main/kotlin/com/acme/web/Routes.kt',
    'src/main/java/com/acme/java/Bridge.java',
    'src/main/kotlin/com/acme/orders/Order.kt',
  ];
  const from = 'src/main/kotlin/com/acme/orders/Order.kt';
  assert.equal(kotlinLang.resolve('com.acme.money.Money', from, files), 'com/acme/money/Money.kt', 'exact path');
  assert.equal(kotlinLang.resolve('com.acme.orders.Order', from, files), 'src/main/kotlin/com/acme/orders/Order.kt', 'src/main/kotlin root');
  assert.equal(kotlinLang.resolve('com.acme.web.Routes', from, files), 'modules/web/src/main/kotlin/com/acme/web/Routes.kt', 'any path ending in the spec');
  assert.equal(kotlinLang.resolve('com.acme.java.Legacy', from, files), 'com/acme/java/Legacy.java', 'a Java file in a Kotlin repo');
  assert.equal(kotlinLang.resolve('com.acme.java.Bridge', from, files), 'src/main/java/com/acme/java/Bridge.java', 'src/main/java root for Java');
  assert.equal(kotlinLang.resolve('com.acme.money.Money.Companion', from, files), 'com/acme/money/Money.kt', 'a companion or nested name names its file');
  assert.equal(kotlinLang.resolve('com.acme.util.Missing', from, files), null, 'not in the repo');
});

test('resolve: wildcards and the standard library are not repo files', () => {
  const files = ['com/acme/util/Formatter.kt'];
  assert.equal(kotlinLang.resolve('com.acme.util.*', 'app/Main.kt', files), null);
  assert.equal(kotlinLang.resolve('kotlin.collections.List', 'app/Main.kt', files), null, 'a package outside the file list');
  assert.equal(kotlinLang.resolve('org.junit.Test', 'app/Main.kt', files), null);
});

test('empty, comment-only and malformed input give empty results without throwing', () => {
  const empty = { symbols: [], imports: [], refs: [], extends: [] };
  assert.deepEqual(kotlinLang.extract('', 'A.kt'), empty);
  assert.deepEqual(kotlinLang.extract('// only a comment\n/* and /* a nested */ block */\n', 'A.kt'), empty);
  assert.doesNotThrow(() => kotlinLang.extract('class {{{ "unterminated\n fun f( \'\n """ open', 'A.kt'));
  assert.doesNotThrow(() => kotlinLang.extract('/* never closed /* twice\nclass Open(', 'A.kt'));
  assert.doesNotThrow(() => kotlinLang.extract('}}} ) ( ;;; @', 'A.kt'));
});
