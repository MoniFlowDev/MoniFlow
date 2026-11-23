/**
 * Everything the app knows, in one place.
 *
 * The store holds the persisted state (plans and your recipe library), the imported game recipes,
 * and the two things derived from them: the recipe index and the current solution. Anything that
 * changes state calls `update()`, which re-solves and saves; the app then redraws. Views never
 * recompute any of this themselves.
 */
import { setFluidUnitMode, setRateUnit } from '../core/format';
import type { AppState, FluidUnitMode, ItemKey, Project, RateUnit, Recipe } from '../core/types';
import type { ImportedGame } from '../import/parse-dump';
import { buildRecipeIndex, producersOf, resolveChoice, type RecipeIndex } from '../solver/recipe-index';
import { solve, type Solution } from '../solver/solve';
import { ItemCatalog } from './item-catalog';
import { loadState, saveState } from './persistence';
import { defaultState } from './project';

export type TabName = 'flow' | 'machines' | 'power';

/** What the drawer is showing. */
export type Selection =
  | { type: 'step'; id: string }
  | { type: 'item'; item: ItemKey; kind: 'raw' | 'out' | 'sur' };

export class Store {
  state: AppState;
  gameData: ImportedGame | null = null;
  activeTab: TabName = 'flow';
  selection: Selection | null = null;

  readonly catalog = new ItemCatalog();

  private indexCache: RecipeIndex = buildRecipeIndex([]);
  private solutionCache: Solution;
  /** The library changed and the index needs rebuilding. */
  private libraryDirty = true;
  /** Identity and length of the library the index was built from, to catch in-place edits. */
  private indexedLibrary: Recipe[] | null = null;
  private indexedLength = -1;

  constructor() {
    this.state = loadState() ?? defaultState();
    this.applyDisplayUnits();
    this.rebuildIndex();
    this.solutionCache = solve(this.project, this.indexCache);
  }

  /* ------------------------------ derived data ------------------------------ */

  get project(): Project {
    return this.state.projects.find((p) => p.id === this.state.activeId) ?? this.state.projects[0]!;
  }

  get index(): RecipeIndex {
    return this.indexCache;
  }

  get solution(): Solution {
    return this.solutionCache;
  }

  /** Every recipe that outputs an item, yours and the game's. */
  producersOf(item: ItemKey): Recipe[] {
    return producersOf(this.indexCache, item);
  }

  /** The recipe currently chosen to make an item, or `'raw'` if you supply it. */
  currentChoice(item: ItemKey): string {
    return resolveChoice(this.project, this.indexCache, item)?.id ?? 'raw';
  }

  isFluid(item: ItemKey): boolean {
    return this.indexCache.fluids.has(item);
  }

  keyFromText(text: string): ItemKey {
    return this.catalog.keyFromText(text, this.indexCache);
  }

  /* ------------------------------ mutation ------------------------------ */

  /** Call after changing the recipe library, so the index is rebuilt before the next solve. */
  markLibraryDirty(): void {
    this.libraryDirty = true;
  }

  /**
   * Change a display unit. These take effect immediately rather than on the next `update()`,
   * because the views that read them — the target rate inputs especially — may be redrawn first.
   */
  setRateUnit(unit: RateUnit): void {
    this.state.unit = unit;
    this.applyDisplayUnits();
  }

  setFluidUnits(mode: FluidUnitMode): void {
    this.state.fluidUnits = mode;
    this.applyDisplayUnits();
  }

  /** Re-solve, save and redraw. Every change to state ends here. */
  update(): void {
    if (
      this.libraryDirty ||
      this.indexedLibrary !== this.state.library ||
      this.indexedLength !== this.state.library.length
    ) {
      this.rebuildIndex();
    }
    this.applyDisplayUnits();
    this.solutionCache = solve(this.project, this.indexCache);
    this.save();
  }

  save(): void {
    saveState(this.state);
  }

  switchProject(id: string): void {
    this.state.activeId = id;
    this.selection = null;
  }

  select(selection: Selection | null): void {
    this.selection = selection;
  }

  /** Resolve a graph node id into a selection: `raw:`/`out:`/`sur:` prefixes mean an item. */
  selectById(id: string | null): void {
    if (!id) {
      this.selection = null;
      return;
    }
    const prefix = id.slice(0, 4);
    if (prefix === 'raw:' || prefix === 'out:' || prefix === 'sur:') {
      this.selection = { type: 'item', item: id.slice(4), kind: id.slice(0, 3) as 'raw' | 'out' | 'sur' };
    } else {
      this.selection = { type: 'step', id };
    }
  }

  /* ------------------------------ internals ------------------------------ */

  private rebuildIndex(): void {
    this.libraryDirty = false;
    this.indexedLibrary = this.state.library;
    this.indexedLength = this.state.library.length;

    const all = this.gameData
      ? [...this.state.library, ...this.gameData.recipes]
      : this.state.library;
    this.indexCache = buildRecipeIndex(all);
    this.catalog.rebuild(this.indexCache);
  }

  private applyDisplayUnits(): void {
    setRateUnit(this.state.unit ?? 's');
    setFluidUnitMode(this.state.fluidUnits ?? 'auto');
  }
}
