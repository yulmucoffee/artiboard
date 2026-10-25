// SQL extraction against tests/fixtures/codemap/sql/billing.sql. Every expected value is written from reading the
// numbered fixture, so a wrong extractor fails here instead of agreeing with itself.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { sqlLang } from '../server/codemap/lang/sql.js';

const text = readFileSync(new URL('./fixtures/codemap/sql/billing.sql', import.meta.url), 'utf8');
const got = sqlLang.extract(text, 'billing.sql');

test('symbols: tables, views, functions, procedures, indexes, types and triggers, schema-free names', () => {
  assert.deepEqual(got.symbols, [
    { name: 'money_amount', kind: 'type', line: 11, exported: true },
    { name: 'customers', kind: 'table', line: 13, exported: true },
    { name: 'invoices', kind: 'table', line: 20, exported: true },
    { name: 'invoices_customer_idx', kind: 'var', line: 28, exported: true },
    { name: 'invoices_number_idx', kind: 'var', line: 29, exported: true },
    { name: 'open_invoices', kind: 'type', line: 31, exported: true },
    { name: 'total_for', kind: 'fn', line: 37, exported: true },
    { name: 'close_month', kind: 'fn', line: 42, exported: true },
    { name: 'invoices_audit', kind: 'fn', line: 49, exported: true },
  ]);
});

test('imports: psql \\i and \\ir and mysql source, each with its spec as written', () => {
  assert.deepEqual(got.imports, [
    { spec: 'sql/extensions.sql', line: 2, names: [] },
    { spec: 'sql/types.sql', line: 3, names: [] },
    { spec: 'legacy/mysql_init.sql', line: 4, names: [] },
  ]);
});

test('refs: tables read or written by from, join, into, update, delete, alter, references and index or trigger on', () => {
  assert.deepEqual(got.refs, [
    { name: 'customers', line: 22 },
    { name: 'invoices', line: 28 },
    { name: 'invoices', line: 29 },
    { name: 'invoices', line: 33 },
    { name: 'customers', line: 34 },
    { name: 'invoices', line: 39 },
    { name: 'invoices', line: 45 },
    { name: 'invoices', line: 50 },
    { name: 'audit_row', line: 51 },
    { name: 'customers', line: 53 },
    { name: 'customers', line: 54 },
    { name: 'invoices', line: 55 },
    { name: 'invoices', line: 56 },
    { name: 'open_invoices', line: 57 },
  ]);
});

test('no inheritance: SQL has no class bases, and a foreign key is a reference', () => {
  assert.deepEqual(got.extends, []);
});

test('a definition inside a comment or a string is not a symbol', () => {
  const names = got.symbols.map((s) => s.name);
  for (const fake of ['ghost', 'fake', 'fake_fn', 'fake_helper']) assert.ok(!names.includes(fake), `${fake} must not be a symbol`);
  const quoted = sqlLang.extract("select 'it''s a create table fake (x)';\ncreate table real_one (id int);", 'x.sql');
  assert.deepEqual(quoted.symbols, [{ name: 'real_one', kind: 'table', line: 2, exported: true }]);
});

test('resolve: \\i paths relative to the including file, else null', () => {
  const files = ['legacy/mysql_init.sql', 'migrations/0001.sql', 'sql/extensions.sql', 'sql/types.sql'];
  assert.equal(sqlLang.resolve('sql/extensions.sql', 'billing.sql', files), 'sql/extensions.sql');
  assert.equal(sqlLang.resolve('extensions.sql', 'sql/billing.sql', files), 'sql/extensions.sql');
  assert.equal(sqlLang.resolve('../legacy/mysql_init.sql', 'sql/billing.sql', files), 'legacy/mysql_init.sql');
  assert.equal(sqlLang.resolve('sql/types.sql', 'migrations/0001.sql', files), null, 'relative to the including directory only');
  assert.equal(sqlLang.resolve('missing.sql', 'billing.sql', files), null);
});

test('empty, comment-only and malformed input return empty results without throwing', () => {
  const empty = { symbols: [], imports: [], refs: [], extends: [] };
  assert.deepEqual(sqlLang.extract('', 'x.sql'), empty);
  assert.deepEqual(sqlLang.extract('-- only a comment\n/* block */\n', 'x.sql'), empty);
  const broken = sqlLang.extract('create table (\n  x int\n', 'x.sql');
  for (const key of ['symbols', 'imports', 'refs', 'extends']) assert.ok(Array.isArray(broken[key]), key);
});
