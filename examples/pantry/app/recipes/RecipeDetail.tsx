import type { Recipe } from '../../api/db/recipes';
import { h, text } from '../../shared/ui';
import { formatQuantity } from '../../shared/units';
import { readIngredients, scaleIngredients, type Ingredient } from './ingredients';

type Props = { recipe: Recipe; servings: number };

// "1 ½ cups flour" with the note after its comma ("sifted") in a lighter weight
function IngredientLine(i: Ingredient): string {
  return h('li', {},
    i.quantity ? h('span', { class: 'amount' }, text(formatQuantity(i.quantity))) : null,
    text(i.name),
    i.note ? h('span', { class: 'muted' }, text(`, ${i.note}`)) : null);
}

// Minus and plus around the number of servings; the screen draws again with the new number.
function ServingsStepper(servings: number): string {
  return h('div', { class: 'stepper' },
    h('button', { 'data-servings': String(Math.max(1, servings - 1)), 'aria-label': 'Fewer servings' }, '−'),
    h('span', {}, text(`${servings} servings`)),
    h('button', { 'data-servings': String(servings + 1), 'aria-label': 'More servings' }, '+'));
}

// Ingredients scaled to the chosen servings, then the steps. Nutrition is per serving.
export function RecipeDetail({ recipe, servings }: Props): string {
  const ingredients = scaleIngredients(readIngredients(recipe.ingredients), servings / recipe.servings);
  return h('article', { class: 'recipe' },
    h('h1', {}, text(recipe.title)),
    ServingsStepper(servings),
    h('ul', { class: 'ingredients' }, ingredients.map(IngredientLine)),
    h('ol', { class: 'steps' }, recipe.steps.map((step) => h('li', {}, text(step)))),
    h('p', { class: 'muted' }, text(`Per serving: ${recipe.kcal} kcal, ${recipe.protein} g protein`)));
}
