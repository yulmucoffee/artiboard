import { currentSession } from '../auth/magicLink';
import type { ShoppingItem } from '../shopping/list';

// how many days before an item's best-before date its reminder comes
const REMIND_DAYS = 2;

// Sends this phone's push token to the API. Signed out, there is no one to notify, and nothing is sent.
export async function registerForPush(deviceToken: string): Promise<boolean> {
  const session = currentSession();
  if (!session) return false;
  const res = await fetch('/api/devices', {
    method: 'PUT',
    headers: { authorization: `Bearer ${session.token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ token: deviceToken }),
  });
  return res.ok;
}

// The reminders to schedule on the phone itself, so they work offline: one per bought item whose best-before date
// is two days away or less, at nine in the morning so none wakes anyone.
export function remindExpiring(items: (ShoppingItem & { bestBefore?: string })[], today: Date): { at: Date; body: string }[] {
  const soon = new Date(today.getTime() + REMIND_DAYS * 864e5);
  // nine this morning, or nine tomorrow once that has passed: an hour of 24 + 9 rolls over to the next day
  const at = new Date(today);
  at.setHours(today.getHours() < 9 ? 9 : 24 + 9, 0, 0, 0);
  return items
    .filter((i) => i.checked && i.bestBefore && new Date(i.bestBefore) <= soon)
    .map((i) => ({ at, body: `${i.name} is best before ${i.bestBefore}. Cook something with it?` }));
}
