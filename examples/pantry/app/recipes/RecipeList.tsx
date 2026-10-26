import type { Recipe } from '../../api/db/recipes';
import { h, listOr, text } from '../../shared/ui';
import { RecipeDetail } from './RecipeDetail';
import { readIngredients } from './ingredients';

type Props = { recipes: Recipe[]; query?: string; open?: Recipe; wide?: boolean };

// One recipe as a card: its photo, title, time and servings. The whole card is the link to its detail.
function RecipeCard(recipe: Recipe): string {
  return h('li', { class: 'card' },
    h('a', { href: `#/recipes/${recipe.id}` },
      recipe.photo ? h('img', { src: recipe.photo, alt: '', loading: 'lazy' }) : null,
      h('h2', {}, text(recipe.title)),
      h('p', { class: 'muted' }, text(`${recipe.minutes} min · serves ${recipe.servings}`))));
}

// a search matches a title or an ingredient's name, never its amount: "cup" should not find every recipe
const matches = (recipe: Recipe, wanted: string) =>
  [recipe.title, ...readIngredients(recipe.ingredients).map((i) => i.name)].some((s) => s.toLowerCase().includes(wanted));

// Every recipe in the household, newest first; a tap opens its detail. On a wide screen the open recipe sits beside
// the list instead of replacing it.
export function RecipeList({ recipes, query = '', open, wide = false }: Props): string {
  const wanted = query.trim().toLowerCase();
  const shown = recipes.filter((r) => !wanted || matches(r, wanted)).sort((a, b) => b.createdAt - a.createdAt);
  return h('main', { class: wide ? 'recipes split' : 'recipes' },
    h('input', { type: 'search', placeholder: 'Search recipes', value: query }),
    listOr(shown, RecipeCard, wanted ? 'No recipe matches that.' : 'No recipes yet. Import one from a link to start.'),
    wide && open ? RecipeDetail({ recipe: open, servings: open.servings }) : null);
}
