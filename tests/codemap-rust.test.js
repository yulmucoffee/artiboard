// The Rust extractor on tests/fixtures/codemap/rust/store.rs. The expected values are read from the fixture by
// hand (line numbers included), not copied from the output. Refs are compared sorted by line and name,
// because one line can hold several calls.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { rustLang } from '../server/codemap/lang/rust.js';

const text = readFileSync(new URL('./fixtures/codemap/rust/store.rs', import.meta.url), 'utf8');
const byLineName = (a, b) => a.line - b.line || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0);

test('rust: symbols are the items and impl or trait members; commented and inline-mod items add none', () => {
  assert.deepEqual(rustLang.extract(text).symbols, [
    { name: 'helpers', kind: 'module', line: 7, exported: false },
    { name: 'api', kind: 'module', line: 8, exported: true },
    { name: 'LIMIT', kind: 'const', line: 18, exported: false },
    { name: 'COUNTER', kind: 'var', line: 19, exported: true },
    { name: 'Map', kind: 'type', line: 20, exported: true },
    { name: 'Store', kind: 'type', line: 23, exported: true },
    { name: 'Mode', kind: 'enum', line: 28, exported: true },
    { name: 'Repo', kind: 'type', line: 33, exported: true },
    { name: 'Repo.get', kind: 'method', line: 34, exported: true },
    { name: 'Repo.len', kind: 'method', line: 35, exported: true },
    { name: 'Store.new', kind: 'method', line: 39, exported: true },
    { name: 'Store.put', kind: 'method', line: 43, exported: true },
    { name: 'Store.secret', kind: 'method', line: 48, exported: false },
    { name: 'Store.get', kind: 'method', line: 55, exported: false },
    { name: 'Mode.fmt', kind: 'method', line: 61, exported: false },
    { name: 'double', kind: 'fn', line: 66, exported: true },
    { name: 'Wrapper', kind: 'type', line: 71, exported: false },
    { name: 'build', kind: 'fn', line: 75, exported: false },
    { name: 'Mode.fmt', kind: 'method', line: 89, exported: false },
  ]);
});

test('rust: use lists expand one brace level and name the local binding; mod declarations import their module', () => {
  assert.deepEqual(rustLang.extract(text).imports, [
    { spec: 'std::collections::HashMap', line: 2, names: ['HashMap'] },
    { spec: 'std::fmt', line: 3, names: ['fmt'] },
    { spec: 'std::fmt::Display', line: 3, names: ['Show'] },
    { spec: 'std::fmt::Write', line: 3, names: ['Write'] },
    { spec: 'crate::board::task::Task', line: 4, names: ['Task'] },
    { spec: 'crate::board::task::Status', line: 4, names: ['Status'] },
    { spec: 'super::util', line: 5, names: ['util'] },
    { spec: 'extlib::Decode', line: 6, names: ['Decode'] },
    { spec: 'helpers', line: 7, names: ['helpers'] },
    { spec: 'std::io::prelude', line: 94 },
  ]);
});

test('rust: calls, macro calls and path owners are refs; a fn name, keywords and attributes are not', () => {
  const refs = rustLang.extract(text).refs.sort(byLineName);
  assert.deepEqual(refs, [
    { name: 'HashMap', line: 40 },
    { name: 'new', line: 40 },
    { name: 'insert', line: 44 },
    { name: 'to_string', line: 44 },
    { name: 'check', line: 45 },
    { name: 'helpers', line: 45 },
    { name: 'format', line: 50 },
    { name: 'cloned', line: 56 },
    { name: 'get', line: 56 },
    { name: 'write', line: 62 },
    { name: 'Store', line: 77 },
    { name: 'new', line: 77 },
    { name: 'Task', line: 78 },
    { name: 'default', line: 78 },
    { name: 'put', line: 78 },
    { name: 'log', line: 79 },
    { name: 'api', line: 80 },
    { name: 'inner', line: 80 },
    { name: 'unwrap', line: 81 },
    { name: 'write', line: 90 },
  ]);
});

test('rust: an impl of a trait extends the trait, named by the type it is for', () => {
  assert.deepEqual(rustLang.extract(text).extends, [
    { name: 'Store', base: 'Repo', line: 54 },
    { name: 'Mode', base: 'Display', line: 60 },
    { name: 'Mode', base: 'Debug', line: 84 },
  ]);
});

const FILES = [
  'crates/extra/src/lib.rs',
  'crates/extra/src/util.rs',
  'src/board.rs',
  'src/board/task.rs',
  'src/lib.rs',
  'src/net/http.rs',
  'src/net/mod.rs',
  'tests/it.rs',
];

test('rust: crate::, self:: and super:: resolve to module files; the longest module path wins', () => {
  const resolve = rustLang.resolve;
  assert.equal(resolve('crate::board::task::Task', 'src/net/http.rs', FILES), 'src/board/task.rs');
  assert.equal(resolve('crate::board::task::Task', 'src/lib.rs', FILES), 'src/board/task.rs');
  assert.equal(resolve('crate::board::Board', 'src/lib.rs', FILES), 'src/board.rs');
  assert.equal(resolve('crate::net', 'src/lib.rs', FILES), 'src/net/mod.rs');
  assert.equal(resolve('crate::Missing', 'src/net/http.rs', FILES), 'src/lib.rs', 'an item of the crate root names the root file');
  assert.equal(resolve('super::Board', 'src/board/task.rs', FILES), 'src/board.rs');
  assert.equal(resolve('self::task', 'src/board.rs', FILES), 'src/board/task.rs');
  assert.equal(resolve('crate::util::helper', 'crates/extra/src/lib.rs', FILES), 'crates/extra/src/util.rs', 'the crate is the nearest src with a lib.rs');
});

test('rust: a bare path is looked up beside the file, then at the crate root; external crates resolve to nothing', () => {
  const resolve = rustLang.resolve;
  assert.equal(resolve('task', 'src/board.rs', FILES), 'src/board/task.rs');
  assert.equal(resolve('net', 'src/lib.rs', FILES), 'src/net/mod.rs');
  assert.equal(resolve('extlib::Decode', 'src/lib.rs', FILES), null);
  assert.equal(resolve('std::collections::HashMap', 'src/net/http.rs', FILES), null);
  assert.equal(resolve('super::x', 'src/lib.rs', FILES), null, 'the crate root has no parent module');
  assert.equal(resolve('super::super::super::x', 'src/net/http.rs', FILES), null, 'climbs past the crate root');
});

test('rust: empty, comment-only and malformed input gives empty results without throwing', () => {
  for (const src of ['', '// only a comment\n/* nested /* block */ still */\n']) {
    assert.deepEqual(rustLang.extract(src), { symbols: [], imports: [], refs: [], extends: [] });
  }
  for (const src of ['impl {', 'fn (', '/* unterminated', 'use a::{b', "r#\"raw", "'", 'mod x {']) {
    assert.doesNotThrow(() => rustLang.extract(src));
  }
  assert.doesNotThrow(() => rustLang.resolve('', 'a.rs', []));
});
