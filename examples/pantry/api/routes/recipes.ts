import { insertRecipe, selectRecipe, selectRecipes, type Db, type Recipe } from '../db/recipes';
import type { Session } from '../db/users';

// GET /recipes: the household's recipes, newest first.
export function listRecipes(db: Db, session: Session): Promise<Recipe[]> {
  return selectRecipes(db, session.householdId);
}

// GET /recipes/:id
export async function getRecipe(db: Db, session: Session, id: string): Promise<Recipe | { status: 404; error: string }> {
  return (await selectRecipe(db, session.householdId, id)) || { status: 404, error: 'no such recipe' };
}

// The schema.org Recipe that most recipe pages carry in a JSON-LD script, or null.
function readRecipeData(html: string): Record<string, any> | null {
  for (const m of html.matchAll(/<script[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const data = JSON.parse(m[1]), found = [data, data['@graph'] || []].flat(2).find((d) => d?.['@type'] === 'Recipe');
      if (found) return found;
    } catch {
      // a broken block on the page: the next one may hold the recipe
    }
  }
  return null;
}

// a schema.org duration in minutes: 'PT1H30M' is 90
const minutesOf = (iso: unknown) => String(iso).match(/\d+[HM]/g)?.reduce((sum, part) => sum + parseInt(part, 10) * (part.endsWith('H') ? 60 : 1), 0) || 0;

// POST /recipes/import: reads a recipe page and saves it for the household; 422 when the page has no recipe data.
export async function importRecipe(db: Db, session: Session, url: string): Promise<Recipe | { status: 422; error: string }> {
  const data = readRecipeData(await (await fetch(url)).text());
  if (!data) return { status: 422, error: 'that page has no recipe we can read' };
  // schema.org writes an image as a URL, an image object, or a list of either: the first one is the photo
  const image = [data.image].flat()[0];
  const recipe: Recipe = {
    id: crypto.randomUUID(), householdId: session.householdId, title: String(data.name || 'Untitled'),
    photo: typeof image === 'string' ? image : image?.url ?? null,
    servings: parseInt(String(data.recipeYield), 10) || 2, minutes: minutesOf(data.totalTime),
    ingredients: data.recipeIngredient || [], steps: (data.recipeInstructions || []).map((s: any) => s.text || String(s)),
    kcal: parseInt(data.nutrition?.calories, 10) || 0, protein: parseInt(data.nutrition?.proteinContent, 10) || 0, createdAt: Date.now(),
  };
  await insertRecipe(db, recipe);
  return recipe;
}
