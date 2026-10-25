// Old pricing code nobody imports any more; it keeps a second formatPrice.
export function formatPrice(cents) {
  return (cents / 100).toFixed(2);
}

export class Ledger {
  record(entry) {
    return [entry.cents].map(formatPrice);
  }
}
