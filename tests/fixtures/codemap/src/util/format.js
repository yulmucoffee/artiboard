// Formatting helpers shared by the cart and the API client.
import { parseAmount } from './parse.js';

// function ghost() {} was removed; this comment must not become a symbol
/* class Phantom {} */
const LABEL = 'class Fake extends Store {}';

export const CURRENCY = 'EUR';
/** Prices as "3.00 EUR". */
export function formatPrice(value) {
  const amount = parseAmount(value);
  return `${amount.toFixed(2)} ${CURRENCY}`;
}

export function formatLine(item) {
  return `${item.name}: ${formatPrice(item.price)}`;
}

function shout(text) {
  return String(text).toUpperCase() + LABEL.slice(0, 0);
}

export { shout };
