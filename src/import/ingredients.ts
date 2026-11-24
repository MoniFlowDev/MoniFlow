/**
 * Digging item and fluid references out of the exported recipe JSON.
 *
 * GregTech, Forge and KubeJS each wrap ingredients differently, and the wrappers nest: an
 * ingredient can be a bare id string, a `{item}` or `{tag}` object, a list of alternatives, or
 * any of those behind an `ingredient`/`inner`/`values` key with a count provider alongside. The
 * functions here walk through whatever they are given and pull out the first concrete id, or
 * `null` when there is nothing usable (a GregTech circuit marker, say, which is a config value
 * rather than an item).
 */

/** Anything that came out of `JSON.parse`. */
type Unknown = Record<string, unknown> | unknown[] | string | number | boolean | null | undefined;

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function num(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/**
 * The average value of a vanilla "int provider", which is how recipes express a random output
 * count. Constant, uniform and binomial providers are all reduced to their mean.
 */
export function averageOf(provider: unknown): number | null {
  if (provider == null) return null;
  if (typeof provider === 'number') return provider;

  const rec = asRecord(provider);
  if (!rec) return null;

  const type = String(rec['type'] ?? '');
  if (/uniform/.test(type)) {
    const v = asRecord(rec['value']) ?? rec;
    const lo = num(v['min_inclusive'] ?? v['min']) ?? 0;
    const hi = num(v['max_inclusive'] ?? v['max']) ?? lo;
    return (lo + hi) / 2;
  }
  if (/constant/.test(type)) return num(rec['value']) ?? 0;
  if (/binomial/.test(type)) return (num(rec['n']) ?? 0) * (num(rec['p']) ?? 0);
  if (typeof rec['value'] === 'number') return rec['value'];
  return null;
}

/** Keys that hold a nested ingredient, in the order worth trying. */
const NESTED_KEYS = [
  'ingredient',
  'inner',
  'children',
  'values',
  'value',
  'items',
  'base',
] as const;

/** The first concrete id inside a (possibly deeply nested) ingredient. */
export function ingredientKey(ingredient: Unknown): string | null {
  if (ingredient == null) return null;

  if (Array.isArray(ingredient)) {
    for (const option of ingredient) {
      const key = ingredientKey(option as Unknown);
      if (key) return key;
    }
    return null;
  }

  if (typeof ingredient === 'string') return ingredient;

  const rec = asRecord(ingredient);
  if (!rec) return null;

  // A circuit marker configures a machine rather than naming an item.
  if (rec['type'] === 'gtceu:circuit') return null;

  if (rec['item']) return String(rec['item']);
  if (rec['tag']) return `#${String(rec['tag'])}`;
  if (rec['fluid']) return String(rec['fluid']);

  for (const key of NESTED_KEYS) {
    if (key in rec) {
      const nested = ingredientKey(rec[key] as Unknown);
      if (nested) return nested;
    }
  }

  if (rec['id']) return String(rec['id']);
  return null;
}

export interface ItemContent {
  key: string;
  count: number;
}

/** One GregTech item slot: an ingredient plus however its count is expressed. */
export function parseItemContent(content: unknown): ItemContent | null {
  const rec = asRecord(content);
  if (content == null) return null;
  if (!rec) {
    const key = ingredientKey(content as Unknown);
    return key ? { key, count: 1 } : null;
  }

  const nested = asRecord(rec['ingredient']);
  if (rec['type'] === 'gtceu:circuit' || nested?.['type'] === 'gtceu:circuit') return null;

  let count = 1;
  const provider = rec['count_provider'] ?? rec['countProvider'];
  if (provider != null) {
    count = averageOf(provider) ?? count;
  } else if (rec['count'] != null) {
    count = Number(rec['count']);
  } else if (rec['amount'] != null) {
    count = Number(rec['amount']);
  }

  let ingredient: unknown = rec['ingredient'] ?? rec['inner'] ?? rec;

  // An int-provider wrapper can also sit one level in, around the real ingredient.
  const inner = asRecord(ingredient);
  const innerProvider = inner?.['count_provider'] ?? inner?.['countProvider'];
  if (inner && innerProvider != null && (inner['inner'] ?? inner['ingredient'])) {
    count = averageOf(innerProvider) ?? count;
    ingredient = inner['inner'] ?? inner['ingredient'];
  }

  const unwrapped = asRecord(ingredient);
  if (unwrapped && unwrapped !== rec && unwrapped['count'] != null && count === 1) {
    count = Number(unwrapped['count']);
  }

  const key = ingredientKey(ingredient as Unknown);
  if (!key) return null;
  return { key, count: count || 0 };
}

export interface FluidContent {
  key: string;
  /** mB. */
  amount: number;
}

/** A bucket, used when a fluid slot gives no amount at all. */
const DEFAULT_FLUID_AMOUNT = 1000;

/** One GregTech fluid slot. */
export function parseFluidContent(content: unknown): FluidContent | null {
  const rec = asRecord(content);
  if (!rec) return null;

  let amount = rec['amount'] ?? rec['Amount'] ?? rec['count'];
  if (rec['count_provider'] != null) {
    amount = averageOf(rec['count_provider']) ?? amount;
  }

  let key: string | null = null;
  if (rec['value'] != null) key = ingredientKey(rec['value'] as Unknown);
  if (!key && rec['fluid']) key = String(rec['fluid']);
  if (!key && rec['FluidName']) key = String(rec['FluidName']);
  if (!key && rec['ingredient'] != null) {
    const nested = parseFluidContent(rec['ingredient']);
    if (nested) {
      key = nested.key;
      if (amount == null) amount = nested.amount;
    }
  }
  if (!key && rec['tag']) key = `#${String(rec['tag'])}`;
  if (!key) return null;

  return { key, amount: Number(amount ?? DEFAULT_FLUID_AMOUNT) };
}

/** The entries of one capability group, e.g. the `item` list inside `inputs`. */
export function contentList(group: unknown, capability: string): Record<string, unknown>[] {
  const rec = asRecord(group);
  const list = rec?.[capability];
  return Array.isArray(list) ? (list.filter((e) => asRecord(e)) as Record<string, unknown>[]) : [];
}

/** An entry's chance as a fraction of 1. Zero means the slot is not consumed or not produced. */
export function chanceOf(entry: Record<string, unknown>): number {
  const max = Number(entry['maxChance'] ?? 10000) || 10000;
  const chance = entry['chance'] == null ? max : Number(entry['chance']);
  return chance / max;
}

/** Total EU/t a recipe draws, summing voltage times amperage over its per-tick EU inputs. */
export function parseEut(tickInputs: unknown): number {
  let eut = 0;
  for (const entry of contentList(tickInputs, 'eu')) {
    const content = entry['content'];
    if (typeof content === 'number') {
      eut += content;
    } else if (typeof content === 'string') {
      eut += Number(content) || 0;
    } else {
      const rec = asRecord(content);
      if (rec)
        eut +=
          (Number(rec['voltage'] ?? rec['eu'] ?? 0) || 0) * (Number(rec['amperage'] ?? 1) || 1);
    }
  }
  return eut;
}
