import { formatPrice } from '../util/format.js';

export function Badge({ value }) {
  return <span className="badge">{formatPrice(value)}</span>;
}

export default function PriceList({ items }) {
  return (
    <ul>
      {items.map((item) => (
        <li key={item.id}>
          <Badge value={item.price} />
        </li>
      ))}
    </ul>
  );
}
