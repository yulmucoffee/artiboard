import { h, listOr, text } from '../../shared/ui';
import { amountLabel, type ShoppingItem } from './list';

type Props = { items: ShoppingItem[] };

// a row with its checkbox; the row's data-id is what a tap toggles
function ItemRow(item: ShoppingItem): string {
  return h('li', { class: item.checked ? 'item checked' : 'item', 'data-id': item.id },
    h('input', { type: 'checkbox', 'aria-label': `Bought ${item.name}`, ...(item.checked ? { checked: '' } : {}) }),
    h('span', { class: 'name' }, text(item.name)),
    h('span', { class: 'amount' }, text(amountLabel(item))));
}

// What is left to buy first, then what is in the basket; a tap on a row checks it off.
export function ShoppingList({ items }: Props): string {
  const left = items.filter((i) => !i.checked), basket = items.filter((i) => i.checked);
  return h('main', { class: 'shopping' },
    h('h1', {}, text(left.length ? `${left.length} to buy` : 'All done')),
    listOr(left, ItemRow, 'Pick recipes to fill the list.'),
    basket.length ? h('ul', { class: 'basket' }, basket.map(ItemRow)) : null);
}
