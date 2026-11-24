/**
 * One lookup table over every recipe the app knows — yours plus the imported game set.
 * Rebuilt whenever the library changes; the solver, the picker and item search all read it.
 */
import type { ItemKey, Project, Recipe } from '../core/types';

export interface Producer {
  recipe: Recipe;
  /** This is the recipe's first output, i.e. what it exists to make. */
  primary: boolean;
}

export interface RecipeIndex {
  recipes: readonly Recipe[];
  byId: Map<string, Recipe>;
  /** item -> every recipe that outputs it. */
  producers: Map<ItemKey, Producer[]>;
  /** Every item that appears anywhere, as an input or an output. */
  items: Set<ItemKey>;
  /** The subset of `items` that are fluids. */
  fluids: Set<ItemKey>;
}

export function buildRecipeIndex(recipes: readonly Recipe[]): RecipeIndex {
  const byId = new Map<string, Recipe>();
  const producers = new Map<ItemKey, Producer[]>();
  const items = new Set<ItemKey>();
  const fluids = new Set<ItemKey>();

  for (const recipe of recipes) {
    byId.set(recipe.id, recipe);
    recipe.outputs.forEach((out, i) => {
      let list = producers.get(out.item);
      if (!list) producers.set(out.item, (list = []));
      list.push({ recipe, primary: i === 0 });
      items.add(out.item);
      if (out.fluid) fluids.add(out.item);
    });
    for (const input of recipe.inputs) {
      items.add(input.item);
      if (input.fluid) fluids.add(input.item);
    }
  }

  return { recipes, byId, producers, items, fluids };
}

export function producersOf(index: RecipeIndex, item: ItemKey): Recipe[] {
  return (index.producers.get(item) ?? []).map((p) => p.recipe);
}

/**
 * Which recipe makes `item` in this plan? `null` means you supply it yourself.
 *
 * Auto-expansion deliberately only follows your own recipes: the game has dozens of recipes
 * (and plenty of loops) per item, so an imported recipe is used only once you pick it.
 */
export function resolveChoice(project: Project, index: RecipeIndex, item: ItemKey): Recipe | null {
  const choice = project.choices[item];
  if (choice === 'raw') return null;
  if (choice && index.byId.has(choice)) return index.byId.get(choice)!;
  if (project.autoExpand === false) return null;
  const primary = index.producers.get(item)?.find((p) => p.primary && p.recipe.src !== 'game');
  return primary?.recipe ?? null;
}
