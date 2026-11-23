import type { ItemKey, Recipe, RecipeIO } from './types';

/** What an output is worth on average, after its chance. Inputs are always their full amount. */
export function expectedAmount(io: RecipeIO): number {
  const chance = io.chance == null ? 100 : Number(io.chance);
  return (Number(io.amount) || 0) * (chance / 100);
}

/** How much of `item` one craft nets: everything it produces minus everything it consumes. */
export function netOutput(recipe: Recipe, item: ItemKey): number {
  let net = 0;
  for (const out of recipe.outputs) {
    if (out.item === item) net += expectedAmount(out);
  }
  for (const input of recipe.inputs) {
    if (input.item === item) net -= Number(input.amount) || 0;
  }
  return net;
}
