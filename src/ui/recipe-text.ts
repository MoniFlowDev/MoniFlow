/**
 * Searchable text for a recipe — its name, machine, and every ingredient and product.
 *
 * Cached per recipe object, because the recipes tab and the picker both filter tens of thousands
 * of them on every keystroke, and building this string is the expensive part.
 */
import { itemName } from '../core/item-names';
import type { Recipe } from '../core/types';

const cache = new WeakMap<Recipe, string>();

export function recipeSearchText(recipe: Recipe): string {
  let text = cache.get(recipe);
  if (text === undefined) {
    text = [
      recipe.name,
      recipe.machine,
      ...recipe.inputs.map((io) => itemName(io.item)),
      ...recipe.outputs.map((io) => itemName(io.item)),
    ]
      .join(' ')
      .toLowerCase();
    cache.set(recipe, text);
  }
  return text;
}
