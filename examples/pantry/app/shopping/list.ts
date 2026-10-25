import { enqueue } from '../sync/queue';
import { formatQuantity, toMetric, type Quantity } from '../../shared/units';

// One line of the list. updatedAt decides whose edit wins when two phones change the same line offline.
export type ShoppingItem = { id: string; name: string; quantity: Quantity | null; checked: boolean; updatedAt: number };

// a line is known by its name, so "Flour" from two recipes is one line
const itemId = (name: string) => name.trim().toLowerCase().replace(/\s+/g, '-');

// Adds a recipe's ingredients, as readIngredients() gives them, to the list; each joins the line of the same name.
export function addToList(list: ShoppingItem[], ingredients: Pick<ShoppingItem, 'name' | 'quantity'>[], now = Date.now()): ShoppingItem[] {
  const added = ingredients.map((i) => ({ id: itemId(i.name), name: i.name, quantity: i.quantity, checked: false, updatedAt: now }));
  return mergeItems([...list, ...added]);
}

// One line per name, its amounts added up in grams or millilitres. Amounts that cannot be added (2 onions and 100 g
// of onion) keep the first; a merged line is bought only when every part of it was.
export function mergeItems(items: ShoppingItem[]): ShoppingItem[] {
  const byId = new Map<string, ShoppingItem>();
  for (const item of items) {
    const quantity = item.quantity && toMetric(item.quantity), had = byId.get(item.id);
    if (!had) { byId.set(item.id, { ...item, quantity }); continue; }
    const sum = had.quantity && quantity && had.quantity.unit === quantity.unit
      ? { amount: had.quantity.amount + quantity.amount, unit: quantity.unit } : had.quantity;
    byId.set(item.id, { ...had, quantity: sum, checked: had.checked && item.checked, updatedAt: Math.max(had.updatedAt, item.updatedAt) });
  }
  return [...byId.values()];
}

// The amount a row shows: '1 ½ cups', '300 g', or nothing for a line like "salt".
export function amountLabel(item: ShoppingItem): string {
  return item.quantity ? formatQuantity(item.quantity) : '';
}

// Checks a line off or back on, stamped now so sync knows it is the newer edit, and queues the edit for the server.
export function toggleItem(listId: string, list: ShoppingItem[], id: string, now = Date.now()): ShoppingItem[] {
  return list.map((item) => {
    if (item.id !== id) return item;
    const changed = { ...item, checked: !item.checked, updatedAt: now };
    enqueue(listId, changed);
    return changed;
  });
}
