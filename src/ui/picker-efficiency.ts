/**
 * The cost model behind the recipe picker, cached.
 *
 * Building it means a shortest-path pass over every recipe in the game, which takes long enough
 * that doing it per keystroke would be felt. Nothing about it changes while you filter or re-sort,
 * and it only depends on a handful of things — the library, the plan's recipe choices, its default
 * tier, and how byproducts are costed — so it is rebuilt only when one of those changes.
 */
import type { ByproductMode, ItemKey } from '../core/types';
import { Efficiency } from '../efficiency/recipe-stats';
import type { Store } from '../state/store';

interface Cached {
  key: string;
  efficiency: Efficiency;
}

let cached: Cached | null = null;

export function pickerEfficiency(store: Store): Efficiency {
  const project = store.project;
  const mode: ByproductMode = store.state.byproductMode ?? 'split';
  const planUses = itemsThePlanUses(store);

  const key = [
    store.index.byId.size,
    project.id,
    project.defaultTier,
    mode,
    JSON.stringify(project.choices),
    // Only part of the key when the mode actually depends on it.
    mode === 'plan' ? [...planUses].sort().join(',') : '',
  ].join('|');

  if (cached?.key !== key) {
    cached = {
      key,
      efficiency: new Efficiency(store.index, project.choices, {
        byproducts: mode,
        planUses,
        defaultTier: project.defaultTier,
      }),
    };
  }
  return cached.efficiency;
}

/** Drop the cache, e.g. when the game recipe set is replaced. */
export function clearPickerEfficiency(): void {
  cached = null;
}

/**
 * Everything the plan consumes or asks for, which is what "only byproducts this plan uses" means:
 * a byproduct nothing wants should not make its recipe look cheaper.
 */
function itemsThePlanUses(store: Store): Set<ItemKey> {
  const used = new Set<ItemKey>();
  for (const step of store.solution.steps) {
    for (const input of step.recipe.inputs) used.add(input.item);
  }
  for (const target of store.solution.targets) used.add(target.item);
  return used;
}
