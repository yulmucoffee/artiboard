# Parsing ingredient lines
Imported recipes write amounts many ways: "1 1/2 cups", "1½ cups", "200g", "2 큰술", "a pinch". `shared/units.ts`
reads them all into a `Quantity`, an amount and one unit.

## Functions
- `parseQuantity(text)`: the amount and unit a line starts with, or null when it starts with a word.
- `splitQuantity(text)`: the same and the words after it. `readIngredients()` in `app/recipes/ingredients.ts` uses it.
- `formatQuantity(q)` writes an amount back as a cook reads it; `toMetric(q)` turns it into grams or millilitres so
  the shopping list can add up one ingredient from several recipes.

## Tests
`shared/units.test.ts` holds lines from real imported recipes. Add the line that broke before fixing the parser.
