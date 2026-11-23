/**
 * The searchable list of every item the app knows about.
 *
 * Rebuilt whenever the recipe library changes, alongside the recipe index. Two things are
 * precomputed because search runs on every keystroke over tens of thousands of items: the
 * lowercased name to match against, and whether anything can make the item (so "find an item to
 * make" can rank craftable things first).
 */
import { itemName } from '../core/item-names';
import type { ItemKey } from '../core/types';
import type { RecipeIndex } from '../solver/recipe-index';

export interface CatalogEntry {
  key: ItemKey;
  name: string;
  /** Lowercased name, for matching. */
  search: string;
  fluid: boolean;
  /** Some recipe outputs it. */
  makeable: boolean;
}

export interface SearchOptions {
  limit?: number;
  /** Push items nothing can make to the bottom. */
  preferMakeable?: boolean;
}

const DEFAULT_LIMIT = 40;

/** Match quality, lowest first: a prefix beats a word start beats a substring beats an id match. */
const MATCH_AT_START = 0;
const MATCH_AT_WORD = 1;
const MATCH_INSIDE = 2;
const MATCH_ID_ONLY = 3;
/** Added to the score for an item nothing can make. */
const NOT_MAKEABLE_PENALTY = 4;

/** Characters that mark the start of a word, so "iron" matches "Block of Iron" well. */
const WORD_BREAK = /[\s(-]/;

export class ItemCatalog {
  private entries: CatalogEntry[] = [];
  /** Lowercased display name -> item key, so typed text can be resolved back to a key. */
  private byName = new Map<string, ItemKey>();

  rebuild(index: RecipeIndex): void {
    this.entries = [];
    this.byName.clear();

    for (const key of index.items) {
      const name = itemName(key);
      const lower = name.toLowerCase();
      // First one wins, so a GregTech item keeps the name over a later duplicate.
      if (!this.byName.has(lower)) this.byName.set(lower, key);
      this.entries.push({
        key,
        name,
        search: lower,
        fluid: index.fluids.has(key),
        makeable: index.producers.has(key),
      });
    }
  }

  /** Resolve typed text — a display name or a raw id — to an item key. */
  keyFromText(text: string, index: RecipeIndex): ItemKey {
    const trimmed = String(text ?? '').trim();
    if (!trimmed) return '';
    if (index.items.has(trimmed)) return trimmed;
    // Unknown text is used as-is: your own recipes key items by whatever you typed.
    return this.byName.get(trimmed.toLowerCase()) ?? trimmed;
  }

  search(query: string, options: SearchOptions = {}): CatalogEntry[] {
    const limit = options.limit ?? DEFAULT_LIMIT;
    const scored: [score: number, length: number, entry: CatalogEntry][] = [];

    for (const entry of this.entries) {
      const at = entry.search.indexOf(query);
      if (at < 0 && !entry.key.includes(query)) continue;

      let score =
        at === 0
          ? MATCH_AT_START
          : at > 0 && WORD_BREAK.test(entry.search[at - 1]!)
            ? MATCH_AT_WORD
            : at > 0
              ? MATCH_INSIDE
              : MATCH_ID_ONLY;
      if (options.preferMakeable && !entry.makeable) score += NOT_MAKEABLE_PENALTY;

      // Shorter names first within a score: "Iron Ingot" before "Double Iron Ingot Plate".
      scored.push([score, entry.name.length, entry]);
    }

    scored.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    return scored.slice(0, limit).map(([, , entry]) => entry);
  }
}
