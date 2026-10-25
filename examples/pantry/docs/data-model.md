# Data model
The tables are in `api/db/schema.sql`; only the files beside it write SQL.

## 1. Recipes and ingredients
A recipe keeps its ingredient lines as written. `insertRecipe()` in `api/db/recipes.ts` also stores each line's amount
and unit, read by `parseQuantity()`. Nutrition is per serving.

## 2. Households and members
A household is the `household_id` its members share; whoever made it is its owner, and members see the same recipes
and lists. `findOrCreateUser()` makes a person and their household on a first sign-in; `sign_ins` holds link tokens.

## 3. Shopping items
`shopping_items` holds `ShoppingItem` from `app/shopping/list.ts`. Its `updated_at` is the phone's clock and decides
conflicts (`docs/sync.md`).
