// PHP extraction against tests/fixtures/codemap/php/billing.php. Every expected value is written from reading the
// numbered fixture, so a wrong extractor fails here instead of agreeing with itself.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { phpLang } from '../server/codemap/lang/php.js';

const text = readFileSync(new URL('./fixtures/codemap/php/billing.php', import.meta.url), 'utf8');
const got = phpLang.extract(text, 'billing.php');

test('symbols: top-level definitions, methods as Class.method, and visibility', () => {
  assert.deepEqual(got.symbols, [
    { name: 'RATE', kind: 'const', line: 19, exported: true },
    { name: 'Chargeable', kind: 'type', line: 22, exported: true },
    { name: 'Chargeable.charge', kind: 'method', line: 24, exported: true },
    { name: 'Logs', kind: 'class', line: 27, exported: true },
    { name: 'Logs.log', kind: 'method', line: 29, exported: true },
    { name: 'Gateway', kind: 'class', line: 36, exported: true },
    { name: 'Gateway.TIMEOUT', kind: 'const', line: 40, exported: true },
    { name: 'Gateway.SECRET', kind: 'const', line: 41, exported: false },
    { name: 'Gateway.send', kind: 'method', line: 43, exported: false },
    { name: 'Gateway.make', kind: 'method', line: 51, exported: true },
    { name: 'Gateway.sign', kind: 'method', line: 56, exported: false },
    { name: 'Gateway.charge', kind: 'method', line: 58, exported: true },
    { name: 'Invoice', kind: 'class', line: 66, exported: true },
    { name: 'Invoice.total', kind: 'method', line: 68, exported: true },
    { name: 'Status', kind: 'enum', line: 75, exported: true },
    { name: 'settle', kind: 'fn', line: 80, exported: true },
  ]);
});

test('imports: uses with groups and aliases keep full specs; literal includes keep their path', () => {
  assert.deepEqual(got.imports, [
    { spec: 'App\\Models\\User', line: 6, names: ['User'] },
    { spec: 'App\\Models\\Invoice', line: 7, names: ['Invoice'] },
    { spec: 'App\\Support\\Money', line: 8, names: ['Money'] },
    { spec: 'App\\Support\\Clock', line: 8, names: ['Clock'] },
    { spec: 'App\\Support\\format_date', line: 9, names: ['format_date'] },
    { spec: 'Vendor\\Lib\\Str', line: 10, names: ['Str'] },
    { spec: 'config/paths.php', line: 11, names: [] },
    { spec: 'views/footer.php', line: 12, names: [] },
  ]);
});

test('refs: calls, constructions, static and member calls, and base lists in source order', () => {
  assert.deepEqual(got.refs, [
    { name: 'define', line: 20 },
    { name: 'Payable', line: 22 },
    { name: 'Countable', line: 22 },
    { name: 'write', line: 32 },
    { name: 'BaseGateway', line: 36 },
    { name: 'Chargeable', line: 36 },
    { name: 'Countable', line: 36 },
    { name: 'Logs', line: 38 },
    { name: 'Retries', line: 38 },
    { name: 'Str', line: 48 },
    { name: 'upper', line: 48 },
    { name: 'Tick', line: 53 },
    { name: 'Money', line: 60 },
    { name: 'from', line: 60 },
    { name: 'send', line: 61 },
    { name: 'Bill', line: 62 },
    { name: 'create', line: 62 },
    { name: 'save', line: 62 },
    { name: 'Model', line: 66 },
    { name: 'format_date', line: 71 },
    { name: 'Tick', line: 71 },
    { name: 'now', line: 71 },
    { name: 'User', line: 71 },
    { name: 'find', line: 71 },
    { name: 'charge', line: 82 },
    { name: 'total', line: 83 },
    { name: 'Invoice', line: 84 },
    { name: 'Logger', line: 86 },
    { name: 'info', line: 86 },
  ]);
});

test('extends: interface parents, class parents and implements, trait uses as bases', () => {
  assert.deepEqual(got.extends, [
    { name: 'Chargeable', base: 'Payable', line: 22 },
    { name: 'Chargeable', base: 'Countable', line: 22 },
    { name: 'Gateway', base: 'BaseGateway', line: 36 },
    { name: 'Gateway', base: 'Chargeable', line: 36 },
    { name: 'Gateway', base: 'Countable', line: 36 },
    { name: 'Gateway', base: 'Logs', line: 38 },
    { name: 'Gateway', base: 'Retries', line: 38 },
    { name: 'Invoice', base: 'Model', line: 66 },
  ]);
});

test('a definition inside a comment, a string or a heredoc never becomes a symbol', () => {
  const names = got.symbols.map((s) => s.name);
  for (const fake of ['Ghost', 'ghost', 'Phantom', 'GHOST', 'Fake', 'fake', 'heredoc_fake']) {
    assert.ok(!names.some((n) => n.includes(fake)), `${fake} must not be a symbol`);
  }
});

test('resolve: namespaces map by PSR-4 guesses, includes by the including file directory', () => {
  const files = ['app/Models/User.php', 'config/paths.php', 'lib/helpers.php', 'src/App/Support/Money.php', 'src/Vendor/Lib/Str.php', 'views/footer.php'];
  assert.equal(phpLang.resolve('App\\Support\\Money', 'billing.php', files), 'src/App/Support/Money.php');
  assert.equal(phpLang.resolve('Vendor\\Lib\\Str', 'billing.php', files), 'src/Vendor/Lib/Str.php');
  assert.equal(phpLang.resolve('App\\Models\\User', 'billing.php', files), 'app/Models/User.php', 'the root namespace segment may be dropped');
  assert.equal(phpLang.resolve('Illuminate\\Support\\Str', 'billing.php', files), null, 'a package outside the repo');
  assert.equal(phpLang.resolve('Vendor\\Lib\\Missing', 'billing.php', files), null);
  assert.equal(phpLang.resolve('./helpers.php', 'lib/app.php', files), 'lib/helpers.php');
  assert.equal(phpLang.resolve('../config/paths.php', 'lib/boot.php', files), 'config/paths.php');
  assert.equal(phpLang.resolve('views/footer.php', 'billing.php', files), 'views/footer.php');
  assert.equal(phpLang.resolve('config/paths.php', 'app/Boot.php', files), null, 'includes resolve against the including directory only');
  assert.equal(phpLang.resolve('missing.php', 'billing.php', files), null);
});

test('markup outside the php tags is blanked, so a template word is not a symbol', () => {
  const got2 = phpLang.extract('<h1>class Markup {}</h1>\n<?php function real() {} ?>\n<p>function fake() {</p>', 'page.php');
  assert.deepEqual(got2.symbols, [{ name: 'real', kind: 'fn', line: 2, exported: true }]);
});

test('empty, comment-only and malformed input return empty results without throwing', () => {
  const empty = { symbols: [], imports: [], refs: [], extends: [] };
  assert.deepEqual(phpLang.extract('', 'x.php'), empty);
  assert.deepEqual(phpLang.extract('<?php\n// only a comment\n/* block\n   comment */\n', 'x.php'), empty);
  const broken = phpLang.extract('<?php\nclass { function ( }}} use ; new', 'x.php');
  for (const key of ['symbols', 'imports', 'refs', 'extends']) assert.ok(Array.isArray(broken[key]), key);
});
