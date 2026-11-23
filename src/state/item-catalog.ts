/**
 * The searchable list of every item the app knows about.
 *
 * Rebuilt whenever the recipe library changes, alongside the recipe index. Fuzzy matching and
 * ranking is delegated to fzf; the only thing layered on top is pushing unmakeable items to the
 * bottom when the caller wants that (e.g. "find an item to make"). Matching only ever runs
 * against the short display name, so even with tens of thousands of items this stays well under
 * a frame's worth of work and can run synchronously on every keystroke.
 */
import { Fzf } from 'fzf';
import { itemName } from '../core/item-names';
import type { ItemKey } from '../core/types';
import type { RecipeIndex } from '../solver/recipe-index';

export interface CatalogEntry {
  key: ItemKey;
  name: string;
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

export class ItemCatalog {
  private entries: CatalogEntry[] = [];
  /** Lowercased display name -> item key, so typed text can be resolved back to a key. */
  private byName = new Map<string, ItemKey>();
  private finder = new Fzf<CatalogEntry[]>([], { selector: (entry) => entry.name });

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
        fluid: index.fluids.has(key),
        makeable: index.producers.has(key),
      });
    }

    this.finder = new Fzf(this.entries, { selector: (entry) => entry.name });
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
    const results = this.finder.find(query).map((result) => result.item);
    if (!options.preferMakeable) return results.slice(0, limit);

    // fzf already ranked each group by match quality; just keep makeable ones ahead of the rest.
    const makeable = results.filter((entry) => entry.makeable);
    const rest = results.filter((entry) => !entry.makeable);
    return [...makeable, ...rest].slice(0, limit);
  }
}
