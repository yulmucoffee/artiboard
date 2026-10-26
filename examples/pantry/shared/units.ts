// An amount in one unit; 'count' is for "2 eggs", 'pinch' for what nobody measures.
export type Quantity = { amount: number; unit: Unit };
export type Unit = 'g' | 'kg' | 'ml' | 'l' | 'tsp' | 'tbsp' | 'cup' | 'count' | 'pinch';
const UNITS: Record<string, Unit> = { g: 'g', 그램: 'g', kg: 'kg', ml: 'ml', l: 'l', tsp: 'tsp', 작은술: 'tsp', tbsp: 'tbsp',
  큰술: 'tbsp', cup: 'cup', cups: 'cup', 컵: 'cup', pinch: 'pinch', 꼬집: 'pinch' };
const FRACTIONS: Record<string, number> = { '½': 1 / 2, '⅓': 1 / 3, '⅔': 2 / 3, '¼': 1 / 4, '¾': 3 / 4 };
const METRIC: Partial<Record<Unit, [number, Unit]>> = { kg: [1000, 'g'], l: [1000, 'ml'], tsp: [5, 'ml'], tbsp: [15, 'ml'], cup: [240, 'ml'] };

// '2', '1.5', '1,5', '1/2', '½' or '1½' as a number; NaN for a word
function readAmount(word: string): number {
  const vulgar = FRACTIONS[word.slice(-1)], [top, bottom] = word.split('/');
  if (vulgar !== undefined) return Number(word.slice(0, -1) || 0) + vulgar;
  return bottom ? Number(top) / Number(bottom) : Number(word.replace(',', '.') || NaN);
}

// The quantity a line starts with and the words after it: '2 cups flour' is 2 cups and 'flour'; '200g' works too.
export function splitQuantity(text: string): [Quantity | null, string] {
  const line = text.trim(), pinch = /^(a pinch( of)?|한 꼬집)\s*/i.exec(line);
  if (pinch) return [{ amount: 1, unit: 'pinch' }, line.slice(pinch[0].length)];
  const words = line.replace(/^([\d.,\/½⅓⅔¼¾]+)(?=[^\d\s.,\/½⅓⅔¼¾])/, '$1 ').split(/\s+/);
  let amount = readAmount(words[0]), used = 1;
  if (Number.isNaN(amount)) return [null, line];
  if (/^(\d+\/\d+|[½⅓⅔¼¾])$/.test(words[1] || '')) amount += readAmount(words[used++]);
  const unit = UNITS[(words[used] || '').toLowerCase()];
  return [{ amount, unit: unit || 'count' }, words.slice(unit ? used + 1 : used).join(' ')];
}

// Reads '1 1/2 cups' or '200g'; unit names in English and Korean.
export function parseQuantity(text: string): Quantity | null {
  return splitQuantity(text)[0];
}

// Writes a quantity as a cook reads it: '1 ½ cups', '200 g', 'a pinch'.
export function formatQuantity(q: Quantity): string {
  if (q.unit === 'pinch') return 'a pinch';
  const whole = Math.floor(q.amount), fraction = Object.keys(FRACTIONS).find((f) => Math.abs(FRACTIONS[f] - (q.amount - whole)) < 0.02);
  const amount = fraction ? [whole || '', fraction].filter(Boolean).join(' ') : String(Math.round(q.amount * 10) / 10);
  return q.unit === 'count' ? amount : `${amount} ${q.unit}${q.unit === 'cup' && q.amount > 1 ? 's' : ''}`;
}

// Grams or millilitres for every unit that has a metric size, so two lines of one ingredient add up.
export function toMetric(q: Quantity): Quantity {
  const to = METRIC[q.unit];
  return to ? { amount: q.amount * to[0], unit: to[1] } : q;
}
