#!/usr/bin/env node
// Entry point: builds a cart, prices it and prints it.
import { Cart, applyDiscount } from './cart';
import { fetchCart } from './api';
import * as format from './util/format.js';
import Badge from './components/Badge.jsx';
import express from 'express';

const app = express();

export async function main(id) {
  const cart = id ? await fetchCart(id) : new Cart();
  cart.add({ id: 'a', name: 'Tea', price: 3 });
  console.log(format.formatLine(cart), applyDiscount(cart, 0.1));
  return Badge;
}

main(process.argv[2]);
