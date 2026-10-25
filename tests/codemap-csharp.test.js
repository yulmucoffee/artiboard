// The C# extractor (server/codemap/lang/csharp.js). The expected values come from reading the fixture
// tests/fixtures/codemap/csharp/Invoice.cs line by line, not from running the extractor.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { csharpLang } from '../server/codemap/lang/csharp.js';

const fixture = readFileSync(new URL('./fixtures/codemap/csharp/Invoice.cs', import.meta.url), 'utf8');
const result = csharpLang.extract(fixture, 'Invoice.cs');

test('symbols: types, nested types and members; a comment or a string adds none', () => {
  assert.deepEqual(result.symbols, [
    { name: 'Invoice', kind: 'class', line: 13, exported: true },
    { name: 'Invoice.MaxLines', kind: 'const', line: 15, exported: true },
    { name: 'Invoice.Prefix', kind: 'const', line: 16, exported: false },
    { name: 'Invoice.Number', kind: 'var', line: 19, exported: true },
    { name: 'Invoice.Total', kind: 'var', line: 20, exported: true },
    { name: 'Invoice.Count', kind: 'var', line: 21, exported: true },
    { name: 'Invoice.Add', kind: 'method', line: 25, exported: true },
    { name: 'Invoice.ComputeTotal', kind: 'method', line: 33, exported: true },
    { name: 'Invoice.Parse', kind: 'method', line: 39, exported: true },
    { name: 'Invoice.Hidden', kind: 'method', line: 41, exported: false },
    { name: 'Invoice.Post', kind: 'method', line: 43, exported: true },
    { name: 'Invoice.Line', kind: 'class', line: 49, exported: true },
    { name: 'Invoice.Status', kind: 'enum', line: 55, exported: true },
    { name: 'IPayable', kind: 'type', line: 58, exported: true },
    { name: 'IPayable.Total', kind: 'var', line: 60, exported: true },
    { name: 'IPayable.Pay', kind: 'method', line: 61, exported: true },
    { name: 'Receipt', kind: 'class', line: 64, exported: true },
    { name: 'Money', kind: 'class', line: 66, exported: true },
    { name: 'Money.Currency', kind: 'const', line: 68, exported: true },
    { name: 'Level', kind: 'enum', line: 71, exported: true },
    { name: 'Ledger', kind: 'class', line: 74, exported: true },
    { name: 'Ledger.Pick', kind: 'method', line: 78, exported: true },
    { name: 'Ledger.Close', kind: 'method', line: 80, exported: true },
  ]);
});

test('imports: plain, static and aliased usings name their last segment', () => {
  assert.deepEqual(result.imports, [
    { spec: 'System', line: 1, names: ['System'] },
    { spec: 'System.Collections.Generic', line: 2, names: ['Generic'] },
    { spec: 'System.Math', line: 3, names: ['Math'] },
    { spec: 'Acme.Payments.Gateway', line: 4, names: ['Gateway'] },
    { spec: 'Acme.Billing.Models', line: 5, names: ['Models'] },
  ]);
});

test('extends: base types and interfaces of a header, generic arguments dropped', () => {
  assert.deepEqual(result.extends, [
    { name: 'Invoice', base: 'BaseEntity', line: 13 },
    { name: 'Invoice', base: 'IPayable', line: 13 },
    { name: 'Invoice.Line', base: 'IComparable', line: 49 },
    { name: 'Receipt', base: 'IPayable', line: 64 },
    { name: 'Ledger', base: 'Base', line: 74 },
  ]);
});

test('refs: calls, constructions and attributes; declarations, keywords and comments are not calls', () => {
  assert.deepEqual(result.refs, [
    { name: 'Serializable', line: 12 },
    { name: 'List', line: 17 },
    { name: 'ComputeTotal', line: 20 },
    { name: 'ArgumentNullException', line: 27 },
    { name: 'Add', line: 28 },
    { name: 'Write', line: 29 },
    { name: 'Obsolete', line: 32 },
    { name: 'Round', line: 36 },
    { name: 'Sum', line: 36 },
    { name: 'Invoice', line: 39 },
    { name: 'Open', line: 45 },
    { name: 'Record', line: 46 },
    { name: 'Route', line: 73 },
    { name: 'First', line: 78 },
    { name: 'Save', line: 80 },
    { name: 'Receipt', line: 80 },
  ]);
});

test('resolve: a namespace resolves to the first file in its folder, dots on a segment boundary', () => {
  const files = [
    'src/Acme/Billing/Invoice.cs',
    'src/Acme/Billing/Models/Line.cs',
    'src/Acme/Billing/Models/Tax.cs',
    'src/Acme/Payments/Gateway.cs',
    'src/Acme/Payments/readme.md',
    'tests/Acme.Billing.Tests/InvoiceTests.cs',
  ];
  const at = 'src/Acme/Billing/Invoice.cs';
  assert.equal(csharpLang.resolve('Acme.Billing', at, files), 'src/Acme/Billing/Invoice.cs');
  assert.equal(csharpLang.resolve('Acme.Billing.Models', at, files), 'src/Acme/Billing/Models/Line.cs');
  assert.equal(csharpLang.resolve('Acme.Payments', at, files), 'src/Acme/Payments/Gateway.cs');
  assert.equal(csharpLang.resolve('Acme.Billing.Tests', at, files), 'tests/Acme.Billing.Tests/InvoiceTests.cs');
  assert.equal(csharpLang.resolve('System', at, files), null, 'a framework namespace is not in the repo');
  assert.equal(csharpLang.resolve('', at, files), null);
  assert.equal(
    csharpLang.resolve('Billing.Models', at, ['src/Acme/OldBilling/Models/Old.cs']),
    null,
    'a folder whose name only ends with the segment is not the namespace',
  );
});

test('empty, comment-only and malformed input give empty or partial results without throwing', () => {
  const empty = { symbols: [], imports: [], refs: [], extends: [] };
  assert.deepEqual(csharpLang.extract(''), empty);
  assert.deepEqual(csharpLang.extract('// class A {}\n/* struct B {} */\n\n'), empty);
  for (const text of ['}}} ] ) ; {{{', 'class', '"unterminated', '@"', '"""', "'", '/* open', '[', 'using', 'namespace X']) {
    assert.doesNotThrow(() => csharpLang.extract(text), text);
  }
});

test('strings in every C# form hide declarations, and line numbers hold through multi-line ones', () => {
  const text = [
    'public class Real',
    '{',
    '    const string Verbatim = @"',
    'class Fake1 { }";',
    '    const string Interp = $"{Name("x")} class Fake2";',
    '    const string Raw = """',
    '    class Fake3 { }',
    '    """;',
    '    public void Go() { }',
    '}',
  ].join('\n');
  assert.deepEqual(csharpLang.extract(text).symbols, [
    { name: 'Real', kind: 'class', line: 1, exported: true },
    { name: 'Real.Verbatim', kind: 'const', line: 3, exported: false },
    { name: 'Real.Interp', kind: 'const', line: 5, exported: false },
    { name: 'Real.Raw', kind: 'const', line: 6, exported: false },
    { name: 'Real.Go', kind: 'method', line: 9, exported: true },
  ]);
  assert.deepEqual(csharpLang.extract(text).refs, [], 'a call inside an interpolation hole is not read');
});

test('a type two levels deep is not a symbol, and an index is not an attribute', () => {
  const text = [
    'class Outer {',
    '    class Mid {',
    '        class Deep { void Hidden() { } }',
    '        void MidOnly() { }',
    '    }',
    '    void Top() { var v = grid[i][j]; }',
    '}',
  ].join('\n');
  const parsed = csharpLang.extract(text);
  assert.deepEqual(parsed.symbols, [
    { name: 'Outer', kind: 'class', line: 1, exported: true },
    { name: 'Outer.Mid', kind: 'class', line: 2, exported: false },
    { name: 'Outer.Top', kind: 'method', line: 6, exported: false },
  ]);
  assert.deepEqual(parsed.refs, []);
});

test('stacked attribute lines each count once, and named arguments are not attributes', () => {
  const text = [
    '[HttpGet]',
    '[Authorize(Roles = "a,b")]',
    '[Route("x", Name = "y")]',
    'public class C { }',
    '[assembly: InternalsVisibleTo("x")]',
    'class D { }',
  ].join('\n');
  assert.deepEqual(csharpLang.extract(text).refs, [
    { name: 'HttpGet', line: 1 },
    { name: 'Authorize', line: 2 },
    { name: 'Route', line: 3 },
    { name: 'InternalsVisibleTo', line: 5 },
  ]);
});
