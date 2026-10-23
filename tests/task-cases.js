// Cases for who may change a task, written from the board rules. tests/tasks.test.js runs them against
// server/tasks.js, and tests/server.test.js runs them through each database's write path, so the rules in JavaScript
// and in SQL can't drift apart. People are 'ana' and 'ben'; a database run maps them to two real members.

const AT = '2026-10-23T09:00:00.000Z';
const doing = { status: 'doing', owner: 'ana', claimedBy: { who: 'ana' } };
const review = { status: 'review', owner: 'ana', claimedBy: { who: 'ana' } };
const done = { status: 'done', owner: 'ana', claimedBy: { who: 'ana' }, doneAt: AT };

// [task, writer, patch, override, allowed, why]
export const CHANGE_CASES = [
  [doing, 'ana', { status: 'blocked', branch: 'x' }, false, true, 'the holder'],
  [{ status: 'todo' }, 'ben', { status: 'doing' }, false, true, 'nobody holds it'],
  [doing, 'ben', { due: '2026-11-01' }, false, true, 'anyone moves the due day'],
  [doing, 'ben', { waitingOn: [], updatedAt: AT }, false, true, 'bookkeeping the board does itself'],
  [doing, 'ben', { lastMessageAt: AT, lastMessageBy: 'ben' }, false, true, 'and a post saying who wrote last'],
  [doing, 'ben', { status: 'blocked' }, false, false, 'someone else\'s work'],
  [doing, 'ben', { status: 'blocked' }, true, true, 'unless a person says so'],
  [review, 'ben', { status: 'done', doneAt: AT }, false, true, 'a reviewer finishes it'],
  [review, 'ben', { status: 'doing' }, false, true, 'or sends it back'],
  [review, 'ben', { summary: 'merged, notes in the PR' }, false, true, 'and writes its summary'],
  [review, 'ben', { status: 'blocked' }, false, false, 'but not anything else'],
  [review, 'ben', { status: 'done', branch: 'x' }, false, false, 'nor the branch with it'],
  [review, 'ben', { status: null }, false, false, 'nor clear its status'],
  [done, 'ben', { archivedAt: AT }, false, true, 'anyone archives done work'],
  [doing, 'ben', { archivedAt: AT }, false, false, 'only done work'],
  [done, 'ben', { status: 'doing' }, false, false, 'reopening is the holder\'s'],
  [{ status: 'todo', owner: 'ana' }, 'ben', { status: 'doing', owner: 'ben' }, false, false, 'an assignment holds it too'],
  [doing, 'ben', { spec: 'docs/other.md' }, false, false, 'its details are the holder\'s'],
];

