import { parseQuantity } from '../../shared/units';

// The one thing the API asks of a database: a parameterized query whose rows come back with camelCase keys.
// Tests pass an in-memory one.
export type Db = { query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]> };

// A recipe as the app gets it: ingredient lines as written, nutrition per serving.
export type Recipe = {
  id: string; householdId: string; title: string; photo: string | null; servings: number; minutes: number;
  ingredients: string[]; steps: string[]; kcal: number; protein: number; createdAt: number;
};

// Every recipe of a household, newest first.
export function selectRecipes(db: Db, householdId: string): Promise<Recipe[]> {
  return db.query<Recipe>('SELECT * FROM recipes WHERE household_id = $1 ORDER BY created_at DESC', [householdId]);
}

// One recipe, only when it is the household's: an id from another household reads as missing.
export async function selectRecipe(db: Db, householdId: string, id: string): Promise<Recipe | null> {
  const rows = await db.query<Recipe>('SELECT * FROM recipes WHERE household_id = $1 AND id = $2', [householdId, id]);
  return rows[0] || null;
}

// Saves a recipe, and one ingredients row per line with the amount and unit read from it, so a shopping list adds up
// one ingredient across recipes without parsing again.
export async function insertRecipe(db: Db, r: Recipe): Promise<void> {
  await db.query(
    'INSERT INTO recipes (id, household_id, title, photo, servings, minutes, ingredients, steps, kcal, protein, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)',
    [r.id, r.householdId, r.title, r.photo, r.servings, r.minutes, r.ingredients, r.steps, r.kcal, r.protein, new Date(r.createdAt)],
  );
  for (const [position, line] of r.ingredients.entries()) {
    const q = parseQuantity(line);
    await db.query('INSERT INTO ingredients (recipe_id, position, line, amount, unit) VALUES ($1, $2, $3, $4, $5)',
      [r.id, position, line, q ? q.amount : null, q ? q.unit : null]);
  }
}
