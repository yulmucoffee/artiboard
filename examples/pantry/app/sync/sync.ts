import { currentSession } from '../auth/magicLink';
import { mergeLists, type Synced } from './conflicts';
import { confirmSent, pending } from './queue';

// One round with the server: send this phone's edits to a list, take the list back, and lay any edit made meanwhile
// over it. Null when signed out or offline; the queue keeps the edits for the next round.
export async function syncNow<T extends Synced>(listId: string): Promise<T[] | null> {
  const session = currentSession();
  if (!session) return null;
  const sent = pending(listId);
  try {
    const res = await fetch(`/api/shopping/${encodeURIComponent(listId)}`, {
      method: 'PUT',
      headers: { authorization: `Bearer ${session.token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ items: sent.map((c) => c.item) }),
    });
    if (!res.ok) return null;
    const { items } = await res.json();
    confirmSent(sent.map((c) => c.seq));
    return mergeLists(items as T[], pending(listId).map((c) => c.item as T));
  } catch {
    return null;
  }
}

// Syncs now, whenever the phone comes back online, and every 30 seconds while the list is open. Returns the stop.
export function startSync<T extends Synced>(listId: string, show: (items: T[]) => void): () => void {
  const round = () => syncNow<T>(listId).then((items) => items && show(items));
  const timer = setInterval(round, 30_000);
  window.addEventListener('online', round);
  round();
  return () => {
    clearInterval(timer);
    window.removeEventListener('online', round);
  };
}
