/**
 * What does one of each item cost?
 *
 * The recipe picker needs to compare "make titanium ingots this way" against "make them that
 * way", and the honest answer involves the whole tree underneath: liquid titanium should carry
 * the cost of the ingot it was melted from, plus the EU to melt it.
 *
 * So we do one shortest-path pass over every recipe at once. Raw materials cost nothing but
 * themselves; every craftable item starts unreachable and repeatedly takes the cheapest of its
 * recipes until nothing improves. Two things make this better than walking each tree on demand:
 * every item ends up with one consistent cost, and a loop can never look free, because a loop
 * never beats a real path out of raw materials.
 */
import { netOutput } from '../core/recipe';
import type { ByproductMode, ItemKey, Recipe } from '../core/types';
import type { RecipeIndex } from '../solver/recipe-index';
import { materialForm, materialUnits } from './material-forms';

export interface ItemCost {
  /** EU to make one unit from raw materials. */
  eu: number;
  /** Raw material units consumed to make one unit. */
  raw: number;
  /** The recipe this cost came from, or null for a raw material. */
  recipe: Recipe | null;
  /** The cost had to be estimated — the item is only reachable through a loop. */
  approx: boolean;
}

/** One recipe's cost for making a particular item, ingredients included. */
export interface ChainCost {
  eu: number;
  raw: number;
  /** Some ingredient's cost was an estimate. */
  cut: boolean;
  /** Making the ingredients needs the item itself — a chemistry loop. */
  loops: boolean;
  /** Fraction of the recipe's cost this item pays; the rest goes to byproducts. */
  share: number;
}

export interface CostModelOptions {
  byproducts?: ByproductMode;
  /** For `byproducts: 'plan'`: the byproducts the current plan actually consumes. */
  planUses?: ReadonlySet<ItemKey>;
}

/** A bucket is 1000 mB, and raw materials are counted one per item or one per bucket. */
const MB_PER_BUCKET = 1000;

/** Safety valve on the relaxation loop, so a pathological library cannot hang the tab. */
const MAX_RELAXATIONS = 3_000_000;
/** Rounds of estimating loop-only items and re-relaxing. */
const ESTIMATE_ROUNDS = 3;
/** Cap on the ingredient walk in `needs`. */
const MAX_NEEDS_VISITS = 4000;

const RELATIVE_TIE = 1e-9;

export class CostModel {
  private readonly byproductMode: ByproductMode;
  private readonly planUses: ReadonlySet<ItemKey>;
  private table: Map<ItemKey, ItemCost> | null = null;
  private buildMillis: number | null = null;

  constructor(
    private readonly index: RecipeIndex,
    /** The plan's choices (item -> recipe id or `'raw'`), which the costing respects. */
    private readonly choices: Record<ItemKey, string> | undefined,
    options: CostModelOptions = {},
  ) {
    this.byproductMode = options.byproducts ?? 'split';
    this.planUses = options.planUses ?? new Set();
  }

  /** How long the cost table took to build, for the picker's debug line. */
  get buildMs(): number | null {
    return this.buildMillis;
  }

  /** Cheapest cost of one unit of an item. Unknown items are treated as raw. */
  cost(item: ItemKey): ItemCost {
    return this.costs().get(item) ?? this.asRawMaterial(item);
  }

  /** Cost of making one unit of `item` specifically via `recipe`. Null if it cannot make it. */
  recipeChain(recipe: Recipe, item: ItemKey): ChainCost | null {
    const makes = netOutput(recipe, item);
    if (!(makes > 0)) return null;

    let eu = this.stepEu(recipe);
    let raw = 0;
    let approx = false;
    for (const input of recipe.inputs) {
      if (input.item === item) continue;
      const amount = Number(input.amount) || 0;
      const c = this.cost(input.item);
      eu += c.eu * amount;
      raw += c.raw * amount;
      approx = approx || c.approx;
    }

    const share = this.costShare(recipe, item, makes);
    const otherInputs = recipe.inputs.map((i) => i.item).filter((i) => i !== item);
    return {
      eu: (eu * share) / makes,
      raw: (raw * share) / makes,
      cut: approx,
      loops: this.needs(otherInputs, item),
      share,
    };
  }

  /**
   * True when a recipe just turns a derived shape back into the base form of the same material
   * (nuggets, a block, the molten fluid -> the ingot). Those shapes are themselves made from the
   * base form, so the recipe is a round trip rather than a way to produce anything.
   */
  isSelfConversion(recipe: Recipe, item: ItemKey): boolean {
    const target = this.formOf(item);
    if (!target.material) return false;
    if (target.form !== 'main' && target.form !== 'upstream') return false;
    return recipe.inputs.some((input) => {
      const f = this.formOf(input.item);
      return f.material === target.material && f.form === 'derived';
    });
  }

  /** EU one craft of this recipe spends on itself, ignoring its ingredients. */
  stepEu(recipe: Recipe): number {
    return (Number(recipe.eut) || 0) * (recipe.duration > 0 ? Number(recipe.duration) : 0);
  }

  /**
   * The fraction of a recipe's cost `item` should pay when the recipe makes other things too.
   * Split by quantity, counting an item as one and a bucket of fluid as one.
   */
  costShare(recipe: Recipe, item: ItemKey, makes: number): number {
    if (this.byproductMode === 'none') return 1;

    const mine = makes * this.unit(item);
    let total = mine;
    const seen = new Set<ItemKey>([item]);
    for (const out of recipe.outputs) {
      if (seen.has(out.item)) continue;
      seen.add(out.item);
      if (this.byproductMode === 'plan' && !this.planUses.has(out.item)) continue;
      const net = netOutput(recipe, out.item);
      if (net > 0) total += net * this.unit(out.item);
    }
    return total > 0 ? mine / total : 1;
  }

  /** Does making any of `items` (by their cheapest recipes) end up needing `target`? */
  needs(items: readonly ItemKey[], target: ItemKey): boolean {
    const table = this.costs();
    const seen = new Set<ItemKey>();
    const stack = [...items];
    while (stack.length && seen.size < MAX_NEEDS_VISITS) {
      const item = stack.pop()!;
      if (item === target) return true;
      if (seen.has(item)) continue;
      seen.add(item);
      const via = table.get(item)?.recipe;
      if (via) for (const input of via.inputs) stack.push(input.item);
    }
    return false;
  }

  /* ------------------------------ internals ------------------------------ */

  /** One raw material unit per item, or per bucket of fluid. */
  private unit(item: ItemKey): number {
    return this.index.fluids.has(item) ? 1 / MB_PER_BUCKET : 1;
  }

  private formOf(item: ItemKey) {
    return materialForm(item, this.index.fluids.has(item));
  }

  private asRawMaterial(item: ItemKey, approx = false): ItemCost {
    return { eu: 0, raw: this.unit(item), recipe: null, approx };
  }

  /**
   * Recipes allowed to make an item. Your explicit choice wins; otherwise anything that nets some
   * of the item and is not a round trip. Recycling is a last resort.
   */
  private eligibleRecipes(item: ItemKey): Recipe[] {
    const choice = this.choices?.[item];
    if (choice === 'raw') return [];
    if (choice && this.index.byId.has(choice)) return [this.index.byId.get(choice)!];

    const candidates = (this.index.producers.get(item) ?? [])
      .map((p) => p.recipe)
      .filter(
        (r) => r.inputs.length > 0 && netOutput(r, item) > 0 && !this.isSelfConversion(r, item),
      );

    const normal = candidates.filter((r) => !r.recycling);
    if (normal.length) return normal;

    // Only recycling makes it (liquid titanium, say). Allow melting or grinding plain shapes of
    // the same material, but never composite parts: recycling a part hands back the material of
    // every component, which would let a loop conjure material out of nothing.
    const material = this.formOf(item).material;
    if (!material) return [];
    return candidates.filter((r) =>
      r.inputs.every((i) => this.formOf(i.item).material === material),
    );
  }

  private costs(): Map<ItemKey, ItemCost> {
    if (!this.table) this.table = this.buildCostTable();
    return this.table;
  }

  private buildCostTable(): Map<ItemKey, ItemCost> {
    const startedAt = Date.now();
    const cost = new Map<ItemKey, ItemCost>();

    // Which recipes may make each item, and which recipes each item feeds.
    const makers = new Map<ItemKey, Set<Recipe>>();
    const involved = new Set<Recipe>();
    for (const item of this.index.producers.keys()) {
      const eligible = this.eligibleRecipes(item);
      makers.set(item, new Set(eligible));
      for (const r of eligible) involved.add(r);
    }
    const consumers = new Map<ItemKey, Recipe[]>();
    for (const recipe of involved) {
      for (const input of recipe.inputs) {
        let list = consumers.get(input.item);
        if (!list) consumers.set(input.item, (list = []));
        list.push(recipe);
      }
    }

    /** A known cost, a free raw material, or null for "craftable but not reached yet". */
    const valueOf = (item: ItemKey): ItemCost | null => {
      const known = cost.get(item);
      if (known) return known;
      return makers.get(item)?.size ? null : this.asRawMaterial(item);
    };

    const queue = [...involved];
    const queued = new Set(queue);
    const enqueueConsumers = (item: ItemKey): void => {
      for (const r of consumers.get(item) ?? []) {
        if (queued.has(r)) continue;
        queued.add(r);
        queue.push(r);
      }
    };

    const relax = (): void => {
      let steps = 0;
      while (queue.length && steps++ < MAX_RELAXATIONS) {
        const recipe = queue.pop()!;
        queued.delete(recipe);

        // Price the ingredients. If any is still unreached, this recipe has to wait.
        let eu = this.stepEu(recipe);
        let raw = 0;
        let approx = false;
        let priced = true;
        for (const input of recipe.inputs) {
          const c = valueOf(input.item);
          if (!c) {
            priced = false;
            break;
          }
          const amount = Number(input.amount) || 0;
          eu += c.eu * amount;
          raw += c.raw * amount;
          approx = approx || c.approx;
        }
        if (!priced) continue;

        const seen = new Set<ItemKey>();
        for (const out of recipe.outputs) {
          if (seen.has(out.item)) continue;
          seen.add(out.item);
          if (!makers.get(out.item)?.has(recipe)) continue;

          const makes = netOutput(recipe, out.item);
          if (!(makes > 0)) continue;

          const share = this.costShare(recipe, out.item, makes);
          const candidate: ItemCost = {
            eu: (eu * share) / makes,
            raw: (raw * share) / makes,
            recipe,
            approx,
          };
          if (!improves(candidate, cost.get(out.item))) continue;
          cost.set(out.item, candidate);
          enqueueConsumers(out.item);
        }
      }
    };

    relax();

    // Items only reachable through a loop never get priced above. Estimate them from the base
    // form of their material, or fall back to treating them as raw, then let costs settle again.
    for (let round = 0; round < ESTIMATE_ROUNDS; round++) {
      let estimated = 0;
      for (const [item, recipes] of makers) {
        if (cost.has(item) || !recipes.size) continue;
        cost.set(item, this.estimateFromMaterial(item, cost) ?? this.asRawMaterial(item, true));
        estimated++;
        enqueueConsumers(item);
      }
      if (!estimated) break;
      relax();
    }

    this.buildMillis = Date.now() - startedAt;
    return cost;
  }

  /** Price a derived shape (liquid, nugget, plate…) from the base ingot/gem/dust of its material. */
  private estimateFromMaterial(item: ItemKey, cost: Map<ItemKey, ItemCost>): ItemCost | null {
    const form = this.formOf(item);
    if (!form.material || form.form !== 'derived') return null;

    const units = materialUnits(item, this.index.fluids.has(item));
    if (!(units > 0)) return null;

    const namespace = String(item).split(':')[0];
    const bases = [
      `${namespace}:${form.material}_ingot`,
      `${namespace}:${form.material}_gem`,
      `${namespace}:${form.material}_dust`,
      `gtceu:${form.material}_ingot`,
      `gtceu:${form.material}_dust`,
    ];
    for (const id of bases) {
      if (id === item) continue;
      const base = cost.get(id);
      if (base) return { eu: base.eu * units, raw: base.raw * units, recipe: null, approx: true };
    }
    return null;
  }
}

/** Cheaper in EU wins; an EU tie is broken by needing fewer raw materials. */
function improves(candidate: ItemCost, current: ItemCost | undefined): boolean {
  if (!current) return true;
  const tie = Math.abs(candidate.eu - current.eu) <= Math.abs(current.eu) * RELATIVE_TIE + 1e-12;
  if (!tie) return candidate.eu < current.eu;
  return candidate.raw < current.raw * (1 - RELATIVE_TIE);
}
