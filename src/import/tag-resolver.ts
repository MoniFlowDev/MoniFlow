/**
 * Picking a concrete item for a tag.
 *
 * Recipes often accept "any copper plate" rather than a specific item. The exporter writes out
 * the members of each tag it saw, so most tags resolve by lookup — preferring GregTech's own item
 * when several match, since that is what a GregTech chain will actually have. For tags the
 * exporter missed, the name itself is usually enough to guess from: `forge:plates/tungsten_carbide`
 * is almost certainly `gtceu:tungsten_carbide_plate`.
 */

export interface TagResolverStats {
  guesses: number;
  unresolved: number;
}

const GREGTECH = 'gtceu:';

/** Index ids by their path, preferring GregTech's when two mods use the same path. */
function byPath(ids: Iterable<string>): Map<string, string> {
  const index = new Map<string, string>();
  for (const id of ids) {
    const path = id.split(':').pop()!;
    if (!index.has(path) || id.startsWith(GREGTECH)) index.set(path, id);
  }
  return index;
}

/** `dusts` -> `dust`, `batteries` -> `battery`, `boxes` -> `box`. */
function singularize(word: string): string {
  return word
    .replace(/ies$/, 'y')
    .replace(/(ches|shes|xes|sses)$/, (m) => m.slice(0, -2))
    .replace(/s$/, '');
}

export class TagResolver {
  readonly stats: TagResolverStats = { guesses: 0, unresolved: 0 };

  private readonly itemsByPath: Map<string, string>;
  private readonly fluidsByPath: Map<string, string>;
  private readonly cache = new Map<string, string>();

  constructor(
    private readonly tags: Record<string, string | string[]>,
    items: Record<string, string>,
    fluids: Record<string, string>,
  ) {
    this.itemsByPath = byPath(Object.keys(items));
    this.fluidsByPath = byPath(Object.keys(fluids));
  }

  /** Resolve an item key, which may be a `#tag`. Unresolvable tags come back unchanged. */
  item(key: string): string {
    if (!key.startsWith('#')) return key;

    const cached = this.cache.get(key);
    if (cached) return cached;

    const path = key.slice(1);
    const members = this.membersOf(path);

    let resolved: string;
    if (members.length) {
      resolved = members.find((id) => id.startsWith(GREGTECH)) ?? members[0]!;
    } else {
      const guess = this.guessFromName(path);
      if (guess) {
        resolved = guess;
        this.stats.guesses++;
      } else {
        resolved = key;
        this.stats.unresolved++;
      }
    }

    this.cache.set(key, resolved);
    return resolved;
  }

  /** Resolve a fluid key. Fluid tags are shallow enough that the path alone is a safe lookup. */
  fluid(key: string): string {
    if (!key.startsWith('#')) return key;
    const path = key.slice(1).split(':').pop()!.split('/').pop()!;
    return this.fluidsByPath.get(path) ?? key;
  }

  private membersOf(path: string): string[] {
    const entry = this.tags[path];
    if (!entry) return [];
    // The exporter packs members as "id1|id2" to keep the dump small.
    return typeof entry === 'string' ? entry.split('|') : entry;
  }

  /**
   * Guess an item from a tag path. Tag paths are `category/material`, and the matching item id is
   * usually those two words joined in one of a few conventional orders.
   */
  private guessFromName(path: string): string | null {
    const parts = path.split(':').pop()!.split('/');
    if (parts.length < 2) return this.itemsByPath.get(parts[0]!) ?? null;

    const [category, ...rest] = parts;
    const material = rest.join('_');
    const shape = singularize(category!);

    const candidates = [`${material}_${shape}`, `${shape}_${material}`, material];

    // Compound shapes put the material in the middle: `fine_wires/copper` -> `fine_copper_wire`.
    const underscore = shape.indexOf('_');
    if (underscore !== -1) {
      candidates.push(`${shape.slice(0, underscore)}_${material}_${shape.slice(underscore + 1)}`);
    }

    // A few categories have their own naming entirely.
    if (category === 'storage_blocks') candidates.unshift(`${material}_block`);
    if (category === 'raw_materials') candidates.unshift(`raw_${material}`);
    if (category === 'gems') candidates.unshift(`${material}_gem`, material);

    for (const candidate of candidates) {
      const id = this.itemsByPath.get(candidate);
      if (id) return id;
    }
    return null;
  }
}
