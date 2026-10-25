// Talks to the shop's server. CommonJS on purpose: require() is an import too.
const { formatLine } = require('../util/format');
const { Cart } = require('../cart');

async function fetchCart(id) {
  const res = await fetch(`/carts/${id}`);
  const cart = new Cart();
  for (const item of await res.json()) cart.add(item);
  console.log(formatLine(cart));
  return cart;
}

module.exports = { fetchCart };
