/**
 * Display names for item keys.
 *
 * Your own recipes use display names as keys, so they need no lookup. Imported recipes use
 * game ids (`gtceu:steel_ingot`), whose names come from the export and are registered here.
 * Anything unknown is prettified from the id, which keeps the UI readable even for an item
 * the export missed.
 */
import { stripFormatting, toHtml } from './mc-text';
import type { ItemKey } from './types';

const names = new Map<ItemKey, string>();

/** Looks like a resource location, optionally a `#tag`. */
const RESOURCE_ID = /^#?[a-z0-9_.-]+:[a-z0-9_./-]+$/;

export function registerItemNames(entries: Record<ItemKey, string>): void {
  names.clear();
  for (const [key, name] of Object.entries(entries)) {
    if (name) names.set(key, name);
  }
}

/**
 * Add names without replacing the registry, and without overwriting a name already known.
 * Used by shared links, whose names must never displace those from a real import.
 */
export function addItemNames(entries: Record<ItemKey, string>): void {
  for (const [key, name] of Object.entries(entries)) {
    if (name && !names.has(key)) names.set(key, name);
  }
}

const TIER_WORDS: Record<string, string> = {
  ulv: 'ULV',
  lv: 'LV',
  mv: 'MV',
  hv: 'HV',
  ev: 'EV',
  iv: 'IV',
  luv: 'LuV',
  zpm: 'ZPM',
  uv: 'UV',
  uhv: 'UHV',
  uev: 'UEV',
  uiv: 'UIV',
  uxv: 'UXV',
  opv: 'OpV',
  max: 'MAX',
};

/** `dusts` -> `dust`, `batteries` -> `battery`, `boxes` -> `box`. */
function singularize(word: string): string {
  return word
    .replace(/ies$/, 'y')
    .replace(/(ches|shes|xes|sses)$/, (m) => m.slice(0, -2))
    .replace(/s$/, '');
}

/**
 * Turn an id into something readable: `gtceu:steel_ingot` -> "Steel Ingot",
 * `#forge:dusts/sulfur` -> "Sulfur Dust (any)".
 */
export function prettifyId(id: ItemKey): string {
  let rest = String(id);
  const isTag = rest.startsWith('#');
  if (isTag) rest = rest.slice(1);

  const path = rest.includes(':') ? rest.slice(rest.indexOf(':') + 1) : rest;

  let words: string;
  if (isTag && path.includes('/')) {
    // Tag paths read category-first, so flip them: `dusts/sulfur` -> "sulfur dust".
    const [category, ...name] = path.split('/');
    words = `${name.join(' ')} ${singularize(category!)}`;
  } else {
    words = path.replace(/\//g, ' ');
  }

  const titled = words
    .replace(/_/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .map((w) => TIER_WORDS[w.toLowerCase()] ?? w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');

  return isTag ? `${titled} (any)` : titled;
}

/** The name as the game gives it, `§` codes included. */
export function itemNameRaw(key: ItemKey | null | undefined): string {
  if (key == null) return '';
  const known = names.get(key);
  if (known) return known;
  return RESOURCE_ID.test(key) ? prettifyId(key) : key;
}

/** Plain text name, safe to compare, sort and measure. */
export function itemName(key: ItemKey | null | undefined): string {
  return stripFormatting(itemNameRaw(key));
}

/** Escaped HTML name, with the game's colours preserved. */
export function itemNameHtml(key: ItemKey | null | undefined): string {
  return toHtml(itemNameRaw(key));
}
