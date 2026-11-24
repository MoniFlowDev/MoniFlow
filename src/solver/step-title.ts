/**
 * Naming a step.
 *
 * Your own recipes have names you chose, so they are used as-is. Imported recipes don't —
 * their "name" is just their first product — so a step is named after whatever the plan
 * actually takes from it: a Distillation Tower feeding two different lines is
 * "Sulfuric Heavy Fuel + Sulfuric Light Fuel", not "Sulfuric Heavy Fuel".
 */
import { escapeHtml } from '../core/html';
import { itemName, itemNameHtml, itemNameRaw } from '../core/item-names';
import type { ItemKey, Recipe } from '../core/types';

/** The part of a step the titling needs. */
export interface TitleableStep {
  recipe: Recipe;
  /** Outputs some other step or target consumes. */
  usedOutputs: ItemKey[];
}

/**
 * Ways to name a step, longest first, so a caller with limited room can take the first that fits:
 * "Sulfuric Heavy Fuel + Sulfuric Light Fuel" -> "Sulfuric Heavy + Light Fuel"
 * -> "Sulfuric Heavy Fuel + 1 more".
 */
export function stepTitleOptions(step: TitleableStep, raw = false): string[] {
  const nameOf = raw ? itemNameRaw : itemName;
  const { recipe } = step;
  const used = step.usedOutputs;

  if (recipe.src !== 'game' && used.length <= 1) return [recipe.name];
  if (!used.length) {
    const first = recipe.outputs[0];
    return [first ? nameOf(first.item) : recipe.name];
  }

  const names = used.map(nameOf);
  if (names.length === 1) return names;

  const options: string[] = [];
  if (names.length === 2) {
    options.push(names.join(' + '));
    const merged = mergeNames(names[0]!, names[1]!);
    if (merged) options.push(merged);
  }
  options.push(`${names[0]} + ${names.length - 1} more`);
  return options;
}

export function stepTitle(step: TitleableStep, raw = false): string {
  return stepTitleOptions(step, raw)[0]!;
}

/** The same thing as escaped HTML, keeping the game's name colours. */
export function stepTitleHtml(step: TitleableStep): string {
  const { recipe } = step;
  const used = step.usedOutputs;
  if (recipe.src !== 'game' && used.length <= 1) return escapeHtml(recipe.name);
  if (!used.length) return recipeNameHtml(recipe);
  if (used.length <= 2) return used.map(itemNameHtml).join(' + ');
  return `${itemNameHtml(used[0]!)} + ${used.length - 1} more`;
}

/** Imported recipes are named after their product, so show the product's formatted name. */
export function recipeNameHtml(recipe: Recipe): string {
  const first = recipe.outputs[0];
  return recipe.src === 'game' && first ? itemNameHtml(first.item) : escapeHtml(recipe.name);
}

/**
 * Fold two names that share a start and an end into one:
 * ("Sulfuric Heavy Fuel", "Sulfuric Light Fuel") -> "Sulfuric Heavy + Light Fuel".
 * Returns null when they share nothing and folding would only confuse.
 */
export function mergeNames(a: string, b: string): string | null {
  const left = a.split(' ');
  const right = b.split(' ');

  let prefix = 0;
  while (prefix < left.length - 1 && prefix < right.length - 1 && left[prefix] === right[prefix]) {
    prefix++;
  }

  let suffix = 0;
  while (
    suffix < left.length - prefix - 1 &&
    suffix < right.length - prefix - 1 &&
    left[left.length - 1 - suffix] === right[right.length - 1 - suffix]
  ) {
    suffix++;
  }

  if (!prefix && !suffix) return null;
  const middle = (words: string[]): string => words.slice(prefix, words.length - suffix).join(' ');
  return [
    ...left.slice(0, prefix),
    `${middle(left)} + ${middle(right)}`,
    ...left.slice(left.length - suffix),
  ].join(' ');
}
