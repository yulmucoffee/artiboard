// Times what agents and pages wait on, at board sizes, on SQLite in this process: node scripts/bench.mjs [sizes…]
// Run it before and after a change and compare the medians. RTT_MS=40 adds that delay to every store call, to see
// round trips the way a remote database (Supabase from Vercel) charges them.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makeFlow } from '../server/flow.js';
import { openSqlite } from '../server/store/sqlite.js';

const sizes = process.argv.slice(2).map(Number).filter(Boolean);
const RUNS = 9, RTT = Number(process.env.RTT_MS) || 0;
const dir = mkdtempSync(join(tmpdir(), 'artiboard-bench-'));
const STATUS = ['done', 'done', 'done', 'todo', 'todo', 'doing', 'review', 'blocked'];

async function board(n) {
  const store = await openSqlite({ file: join(dir, `b${n}.db`), boardUrl: 'http://bench' });
  await store.createProject(null, { id: 'b', title: 'Bench', lang: 'en', repos: [] });
  const at = new Date().toISOString();
  for (let i = 0; i < n; i += 100) {
    const writes = [];
    for (let j = i; j < Math.min(n, i + 100); j++) {
      const status = STATUS[j % STATUS.length], deps = j > 10 ? [`T-${j - 7}`, `T-${j - 3}`] : [];
      writes.push({ op: 'set', path: `tasks/T-${j}`, data: { key: `T-${j}`, title: `task ${j}`, status, owner: status === 'todo' ? null : `p${j % 5}`,
        claimedBy: ['doing', 'review', 'blocked'].includes(status) ? { who: `p${j % 5}`, agent: true, at } : null, deps, waitingOn: [], updatedAt: at } });
    }
    await store.apply(null, 'b', writes);
  }
  if (!RTT) return store;
  const slow = (fn) => async (...a) => { await new Promise((r) => setTimeout(r, RTT)); return fn(...a); };
  return { ...store, get: slow(store.get), query: slow(store.query), readMany: slow(store.readMany), apply: slow(store.apply), overview: slow(store.overview) };
}

async function time(fn) {
  await fn();
  const ms = [];
  for (let i = 0; i < RUNS; i++) { const t = performance.now(); await fn(); ms.push(performance.now() - t); }
  ms.sort((a, b) => a - b);
  return `${ms[RUNS >> 1].toFixed(1)} ms (${ms[0].toFixed(1)}–${ms[RUNS - 1].toFixed(1)})`;
}

console.log(`median (min–max) of ${RUNS} runs after one warm-up${RTT ? `, ${RTT} ms per store call` : ''}`);
for (const n of sizes.length ? sizes : [500, 5000, 20000]) {
  const store = await board(n), flow = makeFlow(store), member = { uid: null, person: 'p1' };
  console.log(`${n} tasks  board_start ${await time(() => flow.start(member, { project: 'b', ready: 8, peek: true }))}`
    + `  board_task ${await time(() => flow.task('b', 'T-100'))}  overview ${await time(() => store.overview())}`);
  store.close?.();
}
rmSync(dir, { recursive: true, force: true });
