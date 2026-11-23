/**
 * The small pieces of markup that appear all over the UI: a tier badge, an item icon, a recipe's
 * timing line. They are plain HTML-returning functions so view code can drop them into a template
 * string, which is how every panel here is built.
 */
import { COILS } from '../data/coils';
import { TIERS, tier as tierAt, tierForEut } from '../data/tiers';
import { formatDuration, formatEut, formatNumber } from '../core/format';
import { itemColor } from '../core/item-color';
import type { ItemKey, Recipe } from '../core/types';
import { icons } from '../icons/icon-store';
import { fluidColor } from '../icons/line-color';

/** Coloured tier name, e.g. a cyan "MV". */
export function tierBadge(index: number): string {
  const tier = tierAt(index);
  return `<span class="tier" style="color:${tier.color}">${tier.name}</span>`;
}

/** The same slot for a recipe, with stand-in labels for recipes that have no voltage tier. */
export function recipeBadge(recipe: Recipe): string {
  if (recipe.eut > 0) return tierBadge(tierForEut(recipe.eut));
  const label = recipe.duration > 0 ? 'NO EU' : 'CRAFT';
  return `<span class="tier" style="color:#8fa8c0">${label}</span>`;
}

/** "120 EU/t · 25 s", or how it differs for unpowered and instant recipes. */
export function recipeTiming(recipe: Recipe): string {
  if (!(recipe.duration > 0)) return 'instant';
  const duration = formatDuration(recipe.duration);
  return recipe.eut > 0 ? `${formatEut(recipe.eut)} · ${duration}` : `no power · ${duration}`;
}

/** `<option>`s for a tier `<select>`, optionally starting above ULV. */
export function tierOptions(selected: number, from = 0): string {
  return TIERS.map((tier, i) =>
    i < from
      ? ''
      : `<option value="${i}" ${i === selected ? 'selected' : ''}>${tier.name} (${formatNumber(tier.v)} V)</option>`,
  ).join('');
}

export function coilOptions(selected: number): string {
  return COILS.map(
    (coil, i) =>
      `<option value="${i}" ${i === selected ? 'selected' : ''}>${coil.name} (${formatNumber(coil.temp)}K)</option>`,
  ).join('');
}

/** The icon of the machine that runs a recipe, tier-specific where the game has one. */
export function machineIcon(
  recipe: Recipe | null | undefined,
  tierIndex: number | null,
  px = 16,
): string {
  if (!recipe) return '';
  // Without an explicit tier, show the lowest one that can run it.
  const resolved = tierIndex ?? (recipe.eut > 0 ? Math.max(1, tierForEut(recipe.eut)) : null);
  const key = icons.machineKey(recipe, resolved);
  return key ? (icons.html(key, px, 'm-ico') ?? '') : '';
}

/** An item's icon, or a coloured dot when the atlas has none. */
export function itemDot(item: ItemKey, fluid: boolean, className = 'dot'): string {
  const px = className === 'chip-dot' ? 14 : 16;
  const icon = icons.html(item, px);
  // Fluids sit on a disc of their colour, so a pale gas texture stays visible.
  if (icon && fluid) {
    return `<span class="fl-wrap" style="width:${px}px;height:${px}px;background:${fluidColor(item)}">${icon}</span>`;
  }
  if (icon) return icon;
  return `<span class="${className}${fluid ? ' fluid' : ''}" style="background:${itemColor(item, fluid)}"></span>`;
}
