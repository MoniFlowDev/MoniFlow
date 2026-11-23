/**
 * Crafting ingredients that are not really consumed.
 *
 * A crafting recipe's ingredient list says "one wrench", but the wrench comes back: a GregTech
 * tool loses a single use out of its durability, a water bucket hands back the empty bucket, and
 * some items are not touched at all. Pricing those at one whole item per craft makes an assembler
 * chain look absurd, so the export tells us what each one does (`itemInfo`) and we fold that in.
 */
import type { Recipe, RecipeIO } from '../core/types';

/** Durability for a tool whose real value the export did not include. */
const ESTIMATED_TOOL_USES = 256;

/**
 * Fold `itemInfo` into one recipe's ingredient list:
 *   `d:<n>` a tool with `n` uses, so one craft costs `1/n` of it,
 *   `k`     kept entirely, so it costs nothing,
 *   `r:<id>` handed back as `<id>`, which becomes an output.
 */
export function applyLeftovers(
  inputs: RecipeIO[],
  outputs: RecipeIO[],
  itemInfo: Record<string, string>,
): { tools: number } {
  let tools = 0;

  for (const input of inputs) {
    const info = itemInfo[input.item];
    if (!info) continue;

    if (info.startsWith('d:')) {
      const uses = Number(info.slice(2));
      if (uses > 0) {
        input.uses = uses;
        input.amount /= uses;
        tools++;
      }
    } else if (info === 'k') {
      input.kept = true;
      input.amount = 0;
    } else if (info.startsWith('r:')) {
      const returned = info.slice(2);
      if (!returned || returned === input.item) continue;
      const existing = outputs.find((o) => o.item === returned);
      if (existing) existing.amount += input.amount;
      else outputs.push({ item: returned, amount: input.amount, returned: true });
    }
  }

  return { tools };
}

/* ------------------------------ tool normalisation ------------------------------ */

const TOOL_TIER_PREFIX = /^(ulv|lv|mv|hv|ev|iv|luv|zpm|uv|uhv|uev|uiv|uxv|opv)_/;
/** Tools that are interchangeable for recipe purposes. */
const TOOL_TYPE_ALIASES: Record<string, string> = {
  wirecutter: 'wire_cutter',
  chainsaw: 'saw',
  buzzsaw: 'saw',
};
/** Preference order for the plain version of a tool: cheap and early first. */
const BASIC_TOOL_MATERIALS = ['iron', 'steel', 'wrought_iron', 'bronze', 'rubber', 'wood'];

export interface ToolContext {
  /** Item id -> icon recipe; a `tool|…` value is how we recognise a GregTech tool. */
  gtIcons: Record<string, string>;
  itemInfo: Record<string, string>;
  names: Record<string, string>;
}

/**
 * Crafting recipes ask for "any wrench", and the export picks an arbitrary member of that tag —
 * often an electric or late-game one, which would make an early recipe look unaffordable. Swap
 * GregTech tools for a basic version and charge one use per craft. Durability comes from the
 * export where known, otherwise it is estimated.
 *
 * Safe to run more than once: already-normalised ingredients are left alone.
 */
export function normalizeTools(recipes: readonly Recipe[], context: ToolContext): number {
  const { gtIcons, itemInfo, names } = context;

  const toolTypeOf = (id: string): string | null => {
    const icon = gtIcons[id];
    if (!icon?.startsWith('tool|')) return null;
    const type = icon.split('|')[1]!.split('/').pop()!.replace(TOOL_TIER_PREFIX, '');
    return TOOL_TYPE_ALIASES[type] ?? type;
  };

  const basicVersions = new Map<string, string | null>();
  const basicVersionOf = (type: string): string | null => {
    const cached = basicVersions.get(type);
    if (cached !== undefined) return cached;
    let found: string | null = null;
    for (const material of BASIC_TOOL_MATERIALS) {
      const id = `gtceu:${material}_${type}`;
      if (names[id] || gtIcons[id]) {
        found = id;
        break;
      }
    }
    basicVersions.set(type, found);
    return found;
  };

  const knownUses = (id: string): number => {
    const info = itemInfo[id];
    return info?.startsWith('d:') ? Number(info.slice(2)) : 0;
  };

  let changed = 0;
  for (const recipe of recipes) {
    // Only crafting-style recipes (which carry a `mod`) use tools this way.
    if (recipe.mod == null) continue;

    for (const input of recipe.inputs) {
      if (input.toolNormalized) continue;
      const type = toolTypeOf(input.item);
      if (!type) continue;

      // Tools per craft, normally one, before the per-use split is applied.
      const toolsPerCraft = input.uses ? input.amount * input.uses : input.amount;
      const basic = basicVersionOf(type) ?? input.item;
      const uses = knownUses(basic);

      input.item = basic;
      input.uses = uses || ESTIMATED_TOOL_USES;
      if (!uses) input.usesEstimated = true;
      input.amount = toolsPerCraft / input.uses;
      input.toolNormalized = true;
      changed++;
    }
  }
  return changed;
}
