// The Ruby extractor (server/codemap/lang/ruby.js) on tests/fixtures/codemap/ruby/shipping.rb. The expected rows are
// written from the fixture by hand. The traps are a =begin block, a commented-out def, a heredoc body that holds a
// def and a Quote.new, a def in a string, a singleton class, an endless def, and a `.for(` call that is not a keyword.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { rubyLang } from '../server/codemap/lang/ruby.js';

const source = readFileSync(new URL('./fixtures/codemap/ruby/shipping.rb', import.meta.url), 'utf8');
const found = rubyLang.extract(source);
const EMPTY = { symbols: [], imports: [], refs: [], extends: [] };

// Sorted, the way the build passes the repository's files.
const FILES = [
  'app/models/order.rb',
  'app/models/shipping/quote.rb',
  'app/models/shipping/rate.rb',
  'lib/billing.rb',
  'lib/billing/invoice.rb',
  'shipping.rb',
];

test('symbols: modules, classes, constants and methods, with a class-level method named Class.method', () => {
  assert.deepEqual(found.symbols, [
    { name: 'Shipping', kind: 'module', line: 17, exported: true },
    { name: 'Shipping.RATE_TABLE', kind: 'const', line: 18, exported: true },
    { name: 'Shipping.NOTE', kind: 'const', line: 19, exported: true },
    { name: 'Quote', kind: 'class', line: 21, exported: true },
    { name: 'Quote.initialize', kind: 'method', line: 25, exported: true },
    { name: 'Quote.price', kind: 'method', line: 30, exported: true },
    { name: 'Quote.for', kind: 'method', line: 35, exported: true },
    { name: 'Quote.default_mode', kind: 'method', line: 40, exported: true },
    { name: 'Quote.base_fee', kind: 'method', line: 47, exported: true },
    { name: 'Shipping.rate_for', kind: 'method', line: 52, exported: true },
    { name: 'Courier', kind: 'class', line: 57, exported: true },
    { name: 'Courier.DEFAULT_SERVICE', kind: 'const', line: 59, exported: true },
    { name: 'Courier.services', kind: 'method', line: 61, exported: true },
    { name: 'Courier.dispatch', kind: 'method', line: 63, exported: true },
  ], 'no def inside =begin, a comment, a string or a heredoc becomes a symbol');
});

test('imports: require, require_relative and load, each with the spec as written', () => {
  assert.deepEqual(found.imports, [
    { spec: 'json', line: 3 },
    { spec: 'billing/invoice', line: 4 },
    { spec: '../models/order', line: 5 },
    { spec: 'config/rates.rb', line: 6 },
  ]);
});

test('refs: calls by name, constructions by the constant before .new, and no def or bare new', () => {
  assert.deepEqual(found.refs, [
    { name: 'fetch', line: 31 },
    { name: 'base_fee', line: 32 },
    { name: 'Invoice', line: 32 },
    { name: 'fetch', line: 53 },
    { name: 'map', line: 61 },
    { name: 'Quote', line: 70 },
    { name: 'for', line: 72 },
  ]);
});

test('extends: a superclass, and the module each include or extend names in its class', () => {
  assert.deepEqual(found.extends, [
    { name: 'Quote', base: 'Base', line: 21 },
    { name: 'Quote', base: 'Comparable', line: 22 },
    { name: 'Quote', base: 'Forwardable', line: 23 },
    { name: 'Courier', base: 'Helpers', line: 58 },
  ]);
});

test('resolve: require_relative from the file\'s directory, require from lib/ and the root', () => {
  const from = 'app/models/shipping/quote.rb';
  assert.equal(rubyLang.resolve('rate', from, FILES), 'app/models/shipping/rate.rb', 'a sibling, without ./');
  assert.equal(rubyLang.resolve('./rate', from, FILES), 'app/models/shipping/rate.rb');
  assert.equal(rubyLang.resolve('../order', from, FILES), 'app/models/order.rb');
  assert.equal(rubyLang.resolve('../order.rb', from, FILES), 'app/models/order.rb', 'a spec that already ends in .rb');
  assert.equal(rubyLang.resolve('missing', from, FILES), null);
  assert.equal(rubyLang.resolve('../../../../order', from, FILES), null, 'above the repository root');
  assert.equal(rubyLang.resolve('billing', 'app/models/order.rb', FILES), 'lib/billing.rb', 'lib/ before the root');
  assert.equal(rubyLang.resolve('billing/invoice', 'app/models/order.rb', FILES), 'lib/billing/invoice.rb');
  assert.equal(rubyLang.resolve('shipping', 'lib/billing.rb', FILES), 'shipping.rb', 'the root, when lib/ has none');
  assert.equal(rubyLang.resolve('json', 'app/models/order.rb', FILES), null, 'a gem, not in the repository');
  assert.equal(rubyLang.resolve('/abs/path', from, FILES), null, 'an absolute path is not in the repository');
  assert.equal(rubyLang.resolve('', from, FILES), null);
  assert.equal(rubyLang.resolve('shipping', from, []), null, 'an empty file list resolves nothing');
});

test('empty input and comment-only input give empty results', () => {
  assert.deepEqual(rubyLang.extract(''), EMPTY);
  assert.deepEqual(rubyLang.extract('# def hidden\n=begin\nclass Hidden\n=end\n'), EMPTY);
  assert.deepEqual(rubyLang.extract(null), EMPTY);
});

test('malformed input gives arrays, not exceptions', () => {
  for (const bad of ['def (\nclass <<\n<<~EOS\nbody\n', '=begin\nunterminated', 'module\nend end end\n', '%w[ \n', 'x = "\n']) {
    const out = rubyLang.extract(bad);
    assert.ok(Array.isArray(out.symbols) && Array.isArray(out.imports) && Array.isArray(out.refs));
    assert.ok(Array.isArray(out.extends));
  }
});
