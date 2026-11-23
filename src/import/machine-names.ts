/**
 * Turning a recipe type id into the name of the thing that runs it.
 *
 * GregTech types map straight onto machine names (`gtceu:macerator` -> "Macerator"). Vanilla and
 * other mods need help: every flavour of crafting recipe is really just a crafting table, and a
 * recipe from another mod gets its mod's name appended so "Smelter (Thermal)" is not confused
 * with GregTech's own.
 */

const VANILLA_MACHINES: Record<string, string> = {
  'minecraft:crafting': 'Crafting Table',
  'minecraft:smelting': 'Furnace',
  'minecraft:blasting': 'Blast Furnace (vanilla)',
  'minecraft:smoking': 'Smoker',
  'minecraft:campfire_cooking': 'Campfire',
  'minecraft:stonecutting': 'Stonecutter',
  'minecraft:smithing': 'Smithing Table',
};

/** Mods whose namespace does not title-case into something recognisable. */
const MOD_NAMES: Record<string, string> = {
  enderio: 'EnderIO',
  ae2: 'AE2',
  extendedcrafting: 'Extended Crafting',
  thermal: 'Thermal',
  create: 'Create',
  mekanism: 'Mekanism',
  botania: 'Botania',
  ad_astra: 'Ad Astra',
  sophisticatedbackpacks: 'Sophisticated Backpacks',
  kubejs: 'KubeJS',
  systeams: 'Systeams',
  laserio: 'LaserIO',
  functionalstorage: 'Functional Storage',
};

/** `crafting_shaped`, `impostor_shapeless`, `shaped_strict`, plain `shaped` from KubeJS… */
const CRAFTING_TYPE = /^((crafting|impostor)_)?(shaped|shapeless)(_strict)?$/;

/** Namespaces whose machine names stand on their own without a mod suffix. */
const UNSUFFIXED = new Set(['', 'gtceu', 'minecraft']);

export function titleCase(text: string): string {
  return String(text)
    .replace(/[_/]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

export function machineFromType(type: string | undefined | null): string {
  const id = String(type ?? 'unknown');
  if (VANILLA_MACHINES[id]) return VANILLA_MACHINES[id];

  const colon = id.indexOf(':');
  const namespace = colon === -1 ? '' : id.slice(0, colon);
  const path = colon === -1 ? id : id.slice(colon + 1);

  if (CRAFTING_TYPE.test(path)) return 'Crafting Table';

  const name = titleCase(path);
  if (UNSUFFIXED.has(namespace)) return name;
  return `${name} (${MOD_NAMES[namespace] ?? titleCase(namespace)})`;
}
