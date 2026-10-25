// Reading amounts back from text; its errors are formatted by format.js, which imports this file back.
import { formatPrice } from './format.js';

export function parseAmount(value) {
  const n = Number(value);
  if (Number.isNaN(n)) throw new Error(`not an amount: ${formatPrice(0)}`);
  return n;
}
