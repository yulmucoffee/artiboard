// C and C++ extraction against tests/fixtures/codemap/c/engine.cpp. Every expected value is written from reading the
// numbered fixture, so a wrong extractor fails here instead of agreeing with itself.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { cLang } from '../server/codemap/lang/c.js';

const text = readFileSync(new URL('./fixtures/codemap/c/engine.cpp', import.meta.url), 'utf8');
const got = cLang.extract(text, 'engine.cpp');

test('symbols: macros, typedefs, types, functions and Class.method definitions; static is not exported', () => {
  assert.deepEqual(got.symbols, [
    { name: 'MAX_JOBS', kind: 'const', line: 7, exported: true },
    { name: 'u64', kind: 'type', line: 10, exported: true },
    { name: 'Callback', kind: 'type', line: 11, exported: true },
    { name: 'Point', kind: 'type', line: 12, exported: true },
    { name: 'Point', kind: 'type', line: 12, exported: true },
    { name: 'Mode', kind: 'enum', line: 14, exported: true },
    { name: 'Node', kind: 'type', line: 16, exported: true },
    { name: 'helper', kind: 'fn', line: 20, exported: false },
    { name: 'process', kind: 'fn', line: 25, exported: true },
    { name: 'Queue', kind: 'class', line: 34, exported: true },
    { name: 'Queue.Queue', kind: 'method', line: 44, exported: true },
    { name: 'Queue.size', kind: 'method', line: 49, exported: true },
    { name: 'Queue.push', kind: 'method', line: 56, exported: true },
    { name: 'connect', kind: 'fn', line: 64, exported: true },
    { name: 'legacy_entry', kind: 'fn', line: 73, exported: true },
    { name: 'Box', kind: 'class', line: 81, exported: true },
    { name: 'Box.get', kind: 'method', line: 84, exported: true },
    { name: 'main', kind: 'fn', line: 87, exported: true },
  ]);
});

test('imports: quoted and bracketed includes both give the bare spec', () => {
  assert.deepEqual(got.imports, [
    { spec: 'engine/queue.h', line: 1, names: [] },
    { spec: 'vector', line: 2, names: [] },
    { spec: 'stdio.h', line: 3, names: [] },
  ]);
});

test('refs: calls by their last segment, new T, and base names; prototypes and keywords are not calls', () => {
  assert.deepEqual(got.refs, [
    { name: 'SQUARE', line: 22 },
    { name: 'cb', line: 28 },
    { name: 'helper', line: 28 },
    { name: 'Base', line: 34 },
    { name: 'Logger', line: 34 },
    { name: 'reset', line: 46 },
    { name: 'push_back', line: 52 },
    { name: 'size', line: 53 },
    { name: 'Node', line: 58 },
    { name: 'emit', line: 59 },
    { name: 'open_socket', line: 66 },
    { name: 'connect', line: 75 },
    { name: 'Base', line: 81 },
    { name: 'Queue', line: 89 },
    { name: 'push', line: 90 },
    { name: 'size', line: 92 },
  ]);
});

test('extends: class bases with access keywords dropped, template classes included', () => {
  assert.deepEqual(got.extends, [
    { name: 'Queue', base: 'Base', line: 34 },
    { name: 'Queue', base: 'Logger', line: 34 },
    { name: 'Box', base: 'Base', line: 81 },
  ]);
});

test('a commented-out definition or a definition inside a string is not a symbol', () => {
  const names = got.symbols.map((s) => s.name);
  for (const fake of ['ignored', 'Phantom', 'Fake', 'fake']) {
    assert.ok(!names.some((n) => n.includes(fake)), `${fake} must not be a symbol`);
  }
});

test('resolve: quoted includes from the including directory, then a repo path that ends with the spec', () => {
  const files = ['engine/queue.h', 'include/net/socket.h', 'src/main.cpp', 'src/util/str.h'];
  assert.equal(cLang.resolve('util/str.h', 'src/main.cpp', files), 'src/util/str.h');
  assert.equal(cLang.resolve('str.h', 'src/util/a.cpp', files), 'src/util/str.h');
  assert.equal(cLang.resolve('engine/queue.h', 'src/main.cpp', files), 'engine/queue.h', 'a root-relative path');
  assert.equal(cLang.resolve('net/socket.h', 'src/main.cpp', files), 'include/net/socket.h', 'a path ending with the spec');
  assert.equal(cLang.resolve('../engine/queue.h', 'src/main.cpp', files), 'engine/queue.h');
  assert.equal(cLang.resolve('vector', 'src/main.cpp', files), null, 'a standard header outside the repo');
  assert.equal(cLang.resolve('stdio.h', 'src/main.cpp', files), null);
});

test('a declaration without a body is not a symbol, and a macro-like call without a return type is not a function', () => {
  assert.deepEqual(cLang.extract('int size(void);\nstruct A;\n', 'a.h').symbols, []);
  assert.deepEqual(cLang.extract('TEST(Suite, Case) {\n}\n', 'a.cpp').symbols, []);
});

test('empty, comment-only and malformed input return empty results without throwing', () => {
  const empty = { symbols: [], imports: [], refs: [], extends: [] };
  assert.deepEqual(cLang.extract('', 'x.c'), empty);
  assert.deepEqual(cLang.extract('// nothing here\n/* block */\n', 'x.c'), empty);
  const broken = cLang.extract('int f(int x) {\n  return g(x\n', 'x.c');
  for (const key of ['symbols', 'imports', 'refs', 'extends']) assert.ok(Array.isArray(broken[key]), key);
});
