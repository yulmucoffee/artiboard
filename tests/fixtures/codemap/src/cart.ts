// The shopping cart: items, totals and the discount rule.
import { Store, type Record } from './store.js';
import { formatPrice as price } from './util/format.js';

export type Price = number;

export enum Currency {
  EUR = 'EUR',
  USD = 'USD',
}

export interface CartItem extends Record {
  name: string;
  price: Price;
}

export class Cart extends Store<CartItem> {
  add(item: CartItem) {
    this.save(item);
    return this;
  }

  total(): number {
    return this.items.reduce((sum, item) => sum + item.price, 0);
  }

  label = () => price(this.total());
}

export function applyDiscount(cart: Cart, rate: number) {
  return cart.total() * (1 - rate);
}
