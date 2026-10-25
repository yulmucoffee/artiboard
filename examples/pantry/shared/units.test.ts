// Cases taken from real imported recipes. Runs with any TypeScript runner; a wrong answer throws.
import { formatQuantity, parseQuantity, splitQuantity, toMetric } from './units';

const cases: [string, number, string][] = [
  ['1 1/2 cups', 1.5, 'cup'],
  ['1½ cups', 1.5, 'cup'],
  ['200g', 200, 'g'],
  ['2 큰술', 2, 'tbsp'],
  ['a pinch', 1, 'pinch'],
  ['3 eggs', 3, 'count'],
];

for (const [line, amount, unit] of cases) {
  const q = parseQuantity(line);
  if (!q || Math.abs(q.amount - amount) > 1e-9 || q.unit !== unit) throw new Error(`${line}: got ${JSON.stringify(q)}`);
}

function expectSame(actual: unknown, wanted: unknown, what: string): void {
  if (JSON.stringify(actual) !== JSON.stringify(wanted)) throw new Error(`${what}: ${JSON.stringify(actual)}, not ${JSON.stringify(wanted)}`);
}

expectSame(parseQuantity('salt to taste'), null, 'a line without an amount');
expectSame(splitQuantity('2 onions, chopped')[1], 'onions, chopped', 'the words after the quantity');
expectSame(formatQuantity({ amount: 1.5, unit: 'cup' }), '1 ½ cups', 'formatQuantity');
expectSame(toMetric({ amount: 2, unit: 'tbsp' }), { amount: 30, unit: 'ml' }, 'toMetric');
console.log(`units: ${cases.length + 4} cases pass`);
