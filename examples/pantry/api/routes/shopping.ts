import type { ShoppingItem } from '../../app/shopping/list';
import { resolveConflict } from '../../app/sync/conflicts';
import type { Db } from '../db/recipes';
import type { Session } from '../db/users';

// GET /shopping/:list: the household's list.
export async function getList(db: Db, session: Session, listId: string): Promise<{ items: ShoppingItem[] }> {
  const items = await db.query<ShoppingItem>(
    'SELECT id, name, quantity, checked, updated_at FROM shopping_items WHERE household_id = $1 AND list_id = $2',
    [session.householdId, listId],
  );
  return { items };
}

// PUT /shopping/:list: a phone's edits, each decided against the stored item by the rule the phones use, so every
// phone and the server end on the same list. Answers with the whole list.
export async function putItems(db: Db, session: Session, listId: string, edits: ShoppingItem[]): Promise<{ items: ShoppingItem[] }> {
  const stored = new Map((await getList(db, session, listId)).items.map((item) => [item.id, item]));
  for (const edit of edits) {
    const had = stored.get(edit.id), winner = had ? resolveConflict(edit, had) : edit;
    if (winner === had) continue;
    await db.query(
      `INSERT INTO shopping_items (household_id, list_id, id, name, quantity, checked, updated_at) VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (household_id, list_id, id) DO UPDATE SET name = $4, quantity = $5, checked = $6, updated_at = $7`,
      [session.householdId, listId, winner.id, winner.name, winner.quantity, winner.checked, winner.updatedAt],
    );
  }
  return getList(db, session, listId);
}
