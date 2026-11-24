/**
 * Ordering the recipe picker.
 *
 * "Best overall" is a weighted blend rather than a single number, because the cheapest recipe in
 * EU is often the one that needs twenty machines or a tier you have not built yet. Each candidate
 * is scored on its rank within the candidate set (0 = best, 1 = worst) so the weights stay
 * meaningful whatever the absolute numbers look like.
 *
 * Round trips and recycling are never mixed in with real production recipes: they are ranked
 * separately and always listed below, so a nugget-to-ingot recipe can't win just by being cheap.
 */
import type { ItemKey, Recipe } from '../core/types';
import type { Efficiency, RecipeStats } from './recipe-stats';

export interface RankedRecipe {
  recipe: Recipe;
  stats: RecipeStats;
  /** Lower is better. */
  score: number;
}

export const PICK_SORTS = {
  best: 'Best overall',
  chain: 'Least total power',
  step: 'Least power (this step)',
  machines: 'Fewest machines',
  raw: 'Fewest raw materials',
  tier: 'Lowest tier',
} as const;

export type PickSort = keyof typeof PICK_SORTS;

export function isPickSort(value: unknown): value is PickSort {
  return typeof value === 'string' && value in PICK_SORTS;
}

/** How much each factor counts towards "Best overall". */
const WEIGHTS = {
  chainEu: 2.5,
  tier: 3,
  machines: 2.5,
  raw: 1,
  ingredients: 0.5,
} as const;

/** Added to the score so these sort into their own band, below everything better. */
const BANDS = {
  loops: 100,
  recycling: 50,
  /** A recipe with no ingredients at all is a cheat (a debug or creative recipe). */
  noInputs: 20,
} as const;

/** Being a tier above what you build at hurts; being below it only mildly (older, slower tech). */
const BELOW_TIER_WEIGHT = 0.35;

/** Explicit-sort penalties, large enough to push a whole class to the bottom but still ordered. */
const SORT_PENALTY = { recycling: 1e290, loops: 1e280 } as const;

/** Stand-in for Infinity so comparisons and arithmetic stay finite. */
const HUGE = 1e300;

const finite = (v: number): number => (isFinite(v) ? v : HUGE);

const SORT_KEYS: Record<Exclude<PickSort, 'best'>, (row: RankedRecipe) => number> = {
  chain: (row) => finite(row.stats.chainEu),
  step: (row) => finite(row.stats.stepEu),
  machines: (row) => finite(row.stats.machines),
  raw: (row) => finite(row.stats.raw),
  tier: (row) => row.stats.tier,
};

/** Rank recipes for making `item`, best first. */
export function rankRecipes(
  recipes: readonly Recipe[],
  item: ItemKey,
  efficiency: Efficiency,
  mode: PickSort = 'best',
  playerTier = 1,
): RankedRecipe[] {
  const rows: RankedRecipe[] = recipes.map((recipe) => ({
    recipe,
    stats: efficiency.stats(recipe, item),
    score: 0,
  }));
  if (!rows.length) return rows;

  if (mode === 'best') scoreByBalance(rows, playerTier);
  else scoreBySingleKey(rows, mode);

  rows.sort((a, b) => a.score - b.score || a.stats.chainEu - b.stats.chainEu);
  return rows;
}

function scoreBySingleKey(rows: RankedRecipe[], mode: Exclude<PickSort, 'best'>): void {
  const key = SORT_KEYS[mode];
  for (const row of rows) {
    row.score =
      key(row) +
      (row.recipe.recycling ? SORT_PENALTY.recycling : 0) +
      (row.stats.loops ? SORT_PENALTY.loops : 0);
  }
}

function scoreByBalance(rows: RankedRecipe[], playerTier: number): void {
  // Score each band against itself, so a band's internal order is about merit, not its penalty.
  const bands = new Map<number, RankedRecipe[]>();
  for (const row of rows) {
    const band = bandOf(row);
    let group = bands.get(band);
    if (!group) bands.set(band, (group = []));
    group.push(row);
  }

  for (const [band, group] of bands) {
    const byChainEu = rankWithin(group, (r) => finite(r.stats.chainEu));
    const byTier = rankWithin(group, (r) => tierDistance(r, playerTier));
    const byMachines = rankWithin(group, (r) => finite(r.stats.machines));
    const byRaw = rankWithin(group, (r) => finite(r.stats.raw));
    const byIngredients = rankWithin(group, (r) => r.stats.ingredients);

    group.forEach((row, i) => {
      // Crafting-table style recipes need no machine, just an autocrafter: neither best nor worst.
      const machines = row.recipe.duration > 0 ? byMachines[i]! : 0.5;
      row.score =
        WEIGHTS.chainEu * byChainEu[i]! +
        WEIGHTS.tier * byTier[i]! +
        WEIGHTS.machines * machines +
        WEIGHTS.raw * byRaw[i]! +
        WEIGHTS.ingredients * byIngredients[i]! +
        band;
    });
  }
}

function bandOf(row: RankedRecipe): number {
  return (
    (row.stats.loops ? BANDS.loops : 0) +
    (row.recipe.recycling ? BANDS.recycling : 0) +
    (row.recipe.inputs.length ? 0 : BANDS.noInputs)
  );
}

function tierDistance(row: RankedRecipe, playerTier: number): number {
  const above = Math.max(0, row.stats.tier - playerTier);
  const below = Math.max(0, playerTier - row.stats.tier);
  // Instant recipes have no meaningful tier, so only count the "above" side for them.
  return above + (row.recipe.duration > 0 ? BELOW_TIER_WEIGHT * below : 0);
}

/**
 * Position of each row within the group on one measure, normalised to 0 (best) to 1 (worst).
 * Equal values share a position, so near-identical recipes don't get split apart arbitrarily.
 */
function rankWithin(
  group: readonly RankedRecipe[],
  measure: (row: RankedRecipe) => number,
): number[] {
  const values = group.map(measure);
  const distinct = [...new Set(values)].sort((a, b) => a - b);
  const positionOf = new Map(distinct.map((v, i) => [v, i]));
  const span = Math.max(1, distinct.length - 1);
  return values.map((v) => positionOf.get(v)! / span);
}
