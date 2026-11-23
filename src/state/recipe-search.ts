/**
 * Fuzzy search over a pool of recipes, weighted so a match on the name beats a match on the
 * machine, which beats a match on an ingredient. Without that weighting, searching "crafting
 * table" buries the Crafting Table recipe itself under every other recipe merely made in one.
 *
 * Only the name and machine go through fzf's fuzzy matching — both are short strings, cheap to
 * score even across the game's tens of thousands of recipes. Ingredients are matched with a plain
 * substring check instead: fuzzy-scoring the long concatenated ingredient list for every recipe on
 * every keystroke is the one pass expensive enough to visibly stall typing, and a substring check
 * is the one thing in this file whose cost does not depend on a scoring algorithm, so it stays fast
 * no matter how large the pool is.
 */
import { Fzf } from 'fzf';
import { itemName } from '../core/item-names';
import type { Recipe } from '../core/types';

/** Added to a match's own fzf score, so matches never cross tiers regardless of how strong or
 * weak the individual fuzzy score is. */
const NAME_TIER = 2_000;
const MACHINE_TIER = 1_000;
const INGREDIENT_TIER = 0;

function buildIngredientText(recipe: Recipe): string {
  return [...recipe.inputs, ...recipe.outputs].map((io) => itemName(io.item)).join(' ').toLowerCase();
}

export class RecipeSearchIndex {
  private pool: readonly Recipe[] = [];
  private ingredientTextByRecipe = new Map<Recipe, string>();
  private byName = new Fzf<readonly Recipe[]>([], { selector: (r) => r.name });
  private byMachine = new Fzf<readonly Recipe[]>([], { selector: (r) => r.machine });

  rebuild(pool: readonly Recipe[]): void {
    this.pool = pool;
    this.ingredientTextByRecipe = new Map(pool.map((recipe) => [recipe, buildIngredientText(recipe)]));
    this.byName = new Fzf(pool, { selector: (r) => r.name });
    this.byMachine = new Fzf(pool, { selector: (r) => r.machine });
  }

  search(query: string, limit = Infinity): Recipe[] {
    if (!query) return this.pool.slice(0, limit);

    const scored = new Map<Recipe, number>();

    const lower = query.toLowerCase();
    for (const [recipe, text] of this.ingredientTextByRecipe) {
      if (text.includes(lower)) scored.set(recipe, INGREDIENT_TIER);
    }
    for (const result of this.byMachine.find(query)) {
      scored.set(result.item, MACHINE_TIER + result.score);
    }
    for (const result of this.byName.find(query)) {
      scored.set(result.item, NAME_TIER + result.score);
    }

    return [...scored.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, limit)
      .map(([recipe]) => recipe);
  }
}
