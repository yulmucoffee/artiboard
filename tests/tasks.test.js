// The task rules every writer shares (server/tasks.js): who holds a task, what a status change sets, who may change
// what, and when a task is free to pick. Expected values come from the board rules, not from running the code.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { TASK_FIELDS, boardStatuses, holderOf, isReady, mayChange, statusEffects, unmetDeps } from '../server/tasks.js';
import { CHANGE_CASES } from './task-cases.js';

const AT = '2026-10-23T09:00:00.000Z';
const doneKeys = new Set(['A-1']);
const isDone = (k) => doneKeys.has(k);

test('the owner holds a task, whether a claim or an assignment set it; nothing else does', () => {
  assert.equal(holderOf({ status: 'doing', owner: 'ana', claimedBy: { who: 'ben' } }), 'ana', 'a task reassigned after a claim is its new owner\'s');
  assert.equal(holderOf({ status: 'doing', claimedBy: { who: 'ben' } }), null, 'a claim alone holds nothing');
  assert.equal(holderOf({ status: 'todo', owner: 'ana' }), 'ana', 'an assignment holds a task not yet started');
  assert.equal(holderOf({ status: 'todo' }), null);
});

test('a task is free to pick when it is to do, unheld and waits on nothing', () => {
  assert.deepEqual(unmetDeps({ deps: ['A-1', 'A-2', 7] }, isDone), ['A-2'], 'only keys, only the unfinished');
  assert.equal(isReady({ status: 'todo', deps: ['A-1'] }, isDone), true);
  assert.equal(isReady({ status: 'todo', deps: ['A-2'] }, isDone), false, 'waits on A-2');
  assert.equal(isReady({ status: 'todo', owner: 'ben' }, isDone), false, 'assigned to someone');
  assert.equal(isReady({ status: 'doing' }, isDone), false);
});

test('a status change sets what goes with it', () => {
  const held = { status: 'doing', owner: 'ana', claimedBy: { who: 'ana' } };
  assert.deepEqual(statusEffects(held, 'todo', AT), { claimedBy: null, owner: null }, 'back to todo releases the task');
  assert.deepEqual(statusEffects(held, 'done', AT), { doneAt: AT }, 'done stamps when');
  assert.deepEqual(statusEffects({ status: 'done', doneAt: AT }, 'done', AT), {}, 'done again keeps the first day');
  assert.deepEqual(statusEffects({ status: 'done', doneAt: AT, archivedAt: AT }, 'doing', AT), { doneAt: null, archivedAt: null },
    'leaving done takes back the done day and the archive');
  assert.deepEqual(statusEffects(held, 'review', AT), {});
});

test('the holder changes anything; others what the rules open to them', () => {
  for (const [t, me, patch, override, want, why] of CHANGE_CASES) assert.equal(mayChange(t, me, patch, override), want, why);
});

test('the agents\' protocol lists exactly the task fields', () => {
  const doc = readFileSync(new URL('../skills/artiboard/references/protocol.md', import.meta.url), 'utf8');
  const line = /`tasks\/<id>`: status only\. Fields: ([^.]+)\./.exec(doc);
  assert.ok(line, 'protocol.md names the task fields');
  const listed = line[1].replace(/\s*\([^)]*\)/g, '').split(/,\s*/).map((f) => f.trim());
  assert.deepEqual(listed, TASK_FIELDS);
});

test('a board uses the five statuses and any it adds in meta/config.statuses, before done', () => {
  assert.deepEqual(boardStatuses({}), ['todo', 'doing', 'review', 'blocked', 'done']);
  assert.deepEqual(boardStatuses({ statuses: ['qa', 'staging'] }), ['todo', 'doing', 'review', 'blocked', 'qa', 'staging', 'done']);
  assert.deepEqual(boardStatuses({ statuses: ['qa', 'qa', 'done', 'In Review', 7] }), ['todo', 'doing', 'review', 'blocked', 'qa', 'done'], 'each once, lowercase ids only');
});
