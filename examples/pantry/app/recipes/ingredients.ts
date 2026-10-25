import { splitQuantity, type Quantity } from '../../shared/units';

// One ingredient line: the quantity it starts with (if any), the name, and what follows a comma ("chopped").
export type Ingredient = { quantity: Quantity | null; name: string; note?: string };

// Splits each imported line into a quantity and a name; a line without a quantity keeps its text.
export function readIngredients(lines: string[]): Ingredient[] {
  const out: Ingredient[] = [];
  for (const raw of lines) {
    if (!raw.trim()) continue;
    const [quantity, rest] = splitQuantity(raw);
    const comma = rest.indexOf(',');
    if (comma < 0) out.push({ quantity, name: rest });
    else out.push({ quantity, name: rest.slice(0, comma).trim(), note: rest.slice(comma + 1).trim() });
  }
  return out;
}

// The same ingredients for more or fewer servings. A pinch stays a pinch, and counted things round to halves:
// nobody buys 1.37 eggs.
export function scaleIngredients(list: Ingredient[], factor: number): Ingredient[] {
  return list.map((i) => {
    if (!i.quantity || i.quantity.unit === 'pinch' || factor === 1) return i;
    const exact = i.quantity.amount * factor;
    const amount = i.quantity.unit === 'count' ? Math.max(0.5, Math.round(exact * 2) / 2) : exact;
    return { ...i, quantity: { ...i.quantity, amount } };
  });
}
