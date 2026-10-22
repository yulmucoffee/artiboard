// The changelog the project list shows: one entry per version, newest first, matching package.json.
// Every pull request adds an entry and bumps the version (CONTRIBUTING.md); these checks keep that honest.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const read = (path) => JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8'));
const log = read('../server/public/changelog.json');
const pkg = read('../package.json');
const SEMVER = /^(\d+)\.(\d+)\.(\d+)$/;
const parts = (v) => SEMVER.exec(v).slice(1).map(Number);
const newer = (a, b) => { const x = parts(a), y = parts(b); return x[0] - y[0] || x[1] - y[1] || x[2] - y[2]; };

test('the newest changelog entry is the package version', () => {
  assert.ok(Array.isArray(log.versions) && log.versions.length > 0);
  assert.equal(log.versions[0].version, pkg.version, 'bump package.json and add a changelog entry together');
});

test('versions go newest first, each once, with a date and pull requests', () => {
  log.versions.forEach((v, i) => {
    assert.match(v.version, SEMVER, `version ${v.version}`);
    assert.match(v.date, /^\d{4}-\d\d-\d\d$/, `${v.version} date`);
    assert.ok(Array.isArray(v.prs) && v.prs.every((n) => Number.isInteger(n) && n > 0), `${v.version} prs`);
    if (i) assert.ok(newer(log.versions[i - 1].version, v.version) > 0, `${log.versions[i - 1].version} before ${v.version}`);
    if (i) assert.ok(log.versions[i - 1].date >= v.date, `${v.version} date order`);
  });
});

test('each entry has one to three short lines in English and Korean', () => {
  for (const v of log.versions) {
    for (const lang of ['en', 'ko']) {
      const lines = v.lines?.[lang];
      assert.ok(Array.isArray(lines) && lines.length >= 1 && lines.length <= 3, `${v.version} ${lang}: 1-3 lines`);
      for (const line of lines) assert.ok(typeof line === 'string' && line.trim() && line.length <= 200, `${v.version} ${lang}: ${line}`);
    }
  }
});
