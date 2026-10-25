// The Swift extractor (server/codemap/lang/swift.js). The expected values come from reading the fixture
// tests/fixtures/codemap/swift/Billing.swift line by line, not from running the extractor.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { swiftLang } from '../server/codemap/lang/swift.js';

const fixture = readFileSync(new URL('./fixtures/codemap/swift/Billing.swift', import.meta.url), 'utf8');
const result = swiftLang.extract(fixture, 'Billing.swift');

test('symbols: top-level declarations, members of types, nested types; comments and strings add none', () => {
  assert.deepEqual(result.symbols, [
    { name: 'defaultRate', kind: 'const', line: 11, exported: true },
    { name: 'counter', kind: 'var', line: 12, exported: true },
    { name: 'secret', kind: 'const', line: 13, exported: false },
    { name: 'Amount', kind: 'type', line: 15, exported: true },
    { name: 'Payable', kind: 'type', line: 17, exported: true },
    { name: 'Payable.pay', kind: 'method', line: 19, exported: true },
    { name: 'Invoice', kind: 'class', line: 23, exported: true },
    { name: 'Invoice.pay', kind: 'method', line: 35, exported: true },
    { name: 'Invoice.audit', kind: 'method', line: 41, exported: false },
    { name: 'Invoice.Line', kind: 'class', line: 46, exported: true },
    { name: 'Invoice.Status', kind: 'enum', line: 51, exported: true },
    { name: 'Invoice', kind: 'type', line: 57, exported: true },
    { name: 'Invoice.summary', kind: 'method', line: 59, exported: true },
    { name: 'Receipt', kind: 'class', line: 62, exported: true },
    { name: 'Rates', kind: 'enum', line: 67, exported: true },
    { name: 'Rates.current', kind: 'method', line: 69, exported: true },
    { name: 'makeInvoice', kind: 'fn', line: 73, exported: true },
    { name: 'helper', kind: 'fn', line: 81, exported: false },
  ]);
});

test('imports: a module name, and the module of a kinded import', () => {
  assert.deepEqual(result.imports, [
    { spec: 'Foundation', line: 1, names: [] },
    { spec: 'Core.Models', line: 2, names: [] },
    { spec: 'Billing', line: 3, names: [] },
  ]);
});

test('extends: protocols and superclasses of a header, and an extension\'s conformances', () => {
  assert.deepEqual(result.extends, [
    { name: 'Payable', base: 'AnyObject', line: 17 },
    { name: 'Invoice', base: 'NSObject', line: 23 },
    { name: 'Invoice', base: 'Payable', line: 23 },
    { name: 'Invoice', base: 'CustomStringConvertible', line: 57 },
  ]);
});

test('refs: calls and attributes; declarations, cases, initializers and interpolations are not calls', () => {
  assert.deepEqual(result.refs, [
    { name: 'testable', line: 3 },
    { name: 'objc', line: 22 },
    { name: 'reduce', line: 28 },
    { name: 'log', line: 37 },
    { name: 'Receipt', line: 38 },
    { name: 'current', line: 42 },
    { name: 'print', line: 43 },
    { name: 'MainActor', line: 72 },
    { name: 'Invoice', line: 78 },
  ]);
});

test('resolve: a module resolves to the first file under a folder of its name, or to nothing', () => {
  const files = [
    'Sources/App/main.swift',
    'Sources/Core/Models.swift',
    'Sources/Core/README.md',
    'Sources/Core/Util/Extra.swift',
    'Sources/CoreKit/Kit.swift',
    'Tests/CoreTests/ModelsTests.swift',
  ];
  assert.equal(swiftLang.resolve('Core.Models', 'Sources/App/main.swift', files), 'Sources/Core/Models.swift');
  assert.equal(swiftLang.resolve('Core', 'Sources/App/main.swift', files), 'Sources/Core/Models.swift');
  assert.equal(swiftLang.resolve('CoreKit', 'Sources/App/main.swift', files), 'Sources/CoreKit/Kit.swift');
  assert.equal(swiftLang.resolve('Foundation', 'Sources/App/main.swift', files), null, 'a system framework is not in the repo');
  assert.equal(swiftLang.resolve('Core', 'Sources/App/main.swift', ['Core.swift']), null, 'a file named like the module is not its folder');
  assert.equal(swiftLang.resolve('', 'Sources/App/main.swift', files), null);
});

test('empty, comment-only and malformed input give empty or partial results without throwing', () => {
  const empty = { symbols: [], imports: [], refs: [], extends: [] };
  assert.deepEqual(swiftLang.extract(''), empty);
  assert.deepEqual(swiftLang.extract('// class A {}\n/* struct B {} */\n'), empty);
  for (const text of ['}}} ) ] ; {{{', 'class', '"unterminated', '"""', '"\\(', '/* open', 'import', 'extension']) {
    assert.doesNotThrow(() => swiftLang.extract(text), text);
  }
});

test('nested block comments and multi-line strings hide declarations and keep line numbers', () => {
  const nested = '/* outer /* inner */ class Hidden {} */ class Shown {}';
  assert.deepEqual(swiftLang.extract(nested).symbols, [{ name: 'Shown', kind: 'class', line: 1, exported: true }]);

  const multi = ['let text = """', 'class Fake', '"""', 'class After {}'].join('\n');
  assert.deepEqual(swiftLang.extract(multi).symbols, [
    { name: 'text', kind: 'const', line: 1, exported: true },
    { name: 'After', kind: 'class', line: 4, exported: true },
  ]);
});

test('a call inside an interpolation is part of the string and is not read', () => {
  const parsed = swiftLang.extract('let s = "a \\(f("x")) b"\nlet t = g()');
  assert.deepEqual(parsed.refs, [{ name: 'g', line: 2 }]);
});

test('a type header that runs over lines still scopes its members', () => {
  const text = ['public class Box<T: Equatable>: Container<T>', '  where T: Hashable', '{', '    func put(_ x: T) { }', '}'].join('\n');
  assert.deepEqual(swiftLang.extract(text).symbols, [
    { name: 'Box', kind: 'class', line: 1, exported: true },
    { name: 'Box.put', kind: 'method', line: 4, exported: true },
  ]);
});
