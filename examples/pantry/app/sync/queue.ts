import type { Synced } from './conflicts';

// An edit made on this phone that the server has not confirmed. The queue lives in storage, so an edit made offline
// survives the app being closed.
export type Change = { seq: number; listId: string; item: Synced };

const QUEUE_KEY = 'pantry.queue';

function load(): Change[] {
  return JSON.parse(localStorage.getItem(QUEUE_KEY) || '[]');
}

function store(changes: Change[]): void {
  localStorage.setItem(QUEUE_KEY, JSON.stringify(changes));
}

// Records an edit. A newer edit of the same item replaces the older one, so the queue holds one change per item.
export function enqueue(listId: string, item: Synced): void {
  const changes = load();
  const seq = changes.reduce((max, c) => Math.max(max, c.seq), 0) + 1;
  store([...changes.filter((c) => !(c.listId === listId && c.item.id === item.id)), { seq, listId, item }]);
}

// The edits waiting to be sent for one list, oldest first.
export function pending(listId: string): Change[] {
  return load().filter((c) => c.listId === listId).sort((a, b) => a.seq - b.seq);
}

// Forgets the edits the server confirmed. An item edited again since keeps its newer change, which has a new seq.
export function confirmSent(seqs: number[]): void {
  store(load().filter((c) => !seqs.includes(c.seq)));
}
