/**
 * Guessing which item pictures the machine for a recipe type.
 *
 * A recipe type is `gtceu:macerator`, and the item that looks like a macerator is
 * `gtceu:lv_macerator` — one per voltage tier, so an LV step can show the LV machine. Nothing in
 * the export states that link, but the naming is regular enough to try candidates against the list
 * of items the game actually has.
 */
import { TIER_KEYS } from '../data/tiers';
import { splitResourceLocation } from './asset-fs';

/** Recipe type path -> the vanilla block that performs it. */
const VANILLA_MACHINE_ITEMS: Record<string, string> = {
  crafting: 'minecraft:crafting_table',
  smelting: 'minecraft:furnace',
  blasting: 'minecraft:blast_furnace',
  smoking: 'minecraft:smoker',
  campfire_cooking: 'minecraft:campfire',
  stonecutting: 'minecraft:stonecutter',
  smithing: 'minecraft:smithing_table',
};

const CRAFTING_TYPE = /^((crafting|impostor)_)?(shaped|shapeless)/;

/** Item ids that could picture a machine, keyed by lowercase tier name (`''` for untiered). */
export type MachineCandidates = Record<string, string>;

export function machineCandidates(
  type: string,
  existingItemIds: ReadonlySet<string>,
): MachineCandidates {
  const [namespace, path] = splitResourceLocation(type);
  const found: MachineCandidates = {};

  if (namespace === 'minecraft') {
    const base = path.replace(/_(shaped|shapeless).*$/, '').replace(/^smithing_.*/, 'smithing');
    const item =
      VANILLA_MACHINE_ITEMS[base] ??
      VANILLA_MACHINE_ITEMS[path] ??
      (CRAFTING_TYPE.test(path) || /crafting/.test(path) ? VANILLA_MACHINE_ITEMS['crafting'] : null);
    if (item) found[''] = item;
    return found;
  }

  if (CRAFTING_TYPE.test(path)) {
    found[''] = VANILLA_MACHINE_ITEMS['crafting']!;
    return found;
  }

  // GregTech single-block machines: one item per tier.
  for (const tier of TIER_KEYS) {
    const id = `${namespace}:${tier}_${path}`;
    if (existingItemIds.has(id)) found[tier] = id;
  }

  // Multiblocks and anything untiered, under whichever naming the mod chose.
  for (const id of [
    `${namespace}:${path}`,
    `${namespace}:large_${path}`,
    `${namespace}:machine_${path}`,
    `${namespace}:${path}_machine`,
    `${namespace}:mechanical_${path}`,
    `${namespace}:${path}er`,
    `${namespace}:${path}_table`,
  ]) {
    if (existingItemIds.has(id)) {
      found[''] = id;
      break;
    }
  }

  // No untiered item, but tiered ones exist: use the lowest tier as the generic picture.
  const firstTier = Object.keys(found)[0];
  if (!found[''] && firstTier) found[''] = found[firstTier]!;
  return found;
}
