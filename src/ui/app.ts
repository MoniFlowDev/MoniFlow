/**
 * The composition root.
 *
 * `App` holds the store and the graph view, wires the markup up once, and owns the handful of
 * commands that several views need to reach (add a target, hide a chain, open the picker). Views
 * themselves are plain functions that take the app and render; none of them talk to each other.
 *
 * The render path is deliberately coarse: any change calls `update()`, which re-solves and redraws
 * the sidebar, the summary, the active tab and the drawer. The plan is small enough that this is
 * cheaper than tracking what changed, and it means a view can never show a stale number.
 */
import { itemName, registerItemNames } from '../core/item-names';
import type { ItemKey, Recipe } from '../core/types';
import { GraphView } from '../graph/view';
import { icons } from '../icons/icon-store';
import { clearLineColorCache, setIconMaterialData } from '../icons/line-color';
import { loadGameData, saveGameData } from '../import/game-store';
import { normalizeTools } from '../import/leftovers';
import { parseGameDump, type ImportedGame } from '../import/parse-dump';
import { STARTER_RECIPES } from '../data/starter-recipes';
import { deepClone, uid } from '../state/project';
import { Store, type TabName } from '../state/store';
import { confirmAction } from './ask';
import { all, need, setActive } from './dom';
import { renderDrawer } from './drawer';
import { renderFlow, wireFlowTab } from './flow-tab';
import { wireIconDialog } from './icon-dialog';
import { attachItemSearch } from './item-search';
import { renderMachines } from './machines-tab';
import { clearPickerEfficiency } from './picker-efficiency';
import { renderPower } from './power-tab';
import { openPicker, wirePicker } from './recipe-picker';
import { openRecipeEditor, renderDatalists, wireRecipeEditor } from './recipe-editor';
import { wireRecipesTab, type RecipeSource } from './recipes-tab';
import { renderDefaults, renderSidebarLists, renderTargets, wireSidebar } from './sidebar';
import { applySettingsVisibility, renderSettingsPage, wireSettings, type SettingsPage } from './settings';
import { renderSummary } from './summary';
import { toast } from './toast';
import { openSharedPlan, wireTransfer } from './transfer-bar';
import { renderProjectSelect, wireTopBar } from './top-bar';

/** How long the import result message stays up. */
const IMPORT_TOAST_MS = 6000;
/** A long-lived "working" message, cancelled by the next toast. */
const WORKING_TOAST_MS = 60_000;
/** Yield to the browser so the "reading" message paints before parsing blocks. */
const PAINT_DELAY_MS = 30;

export class App {
  readonly store = new Store();
  readonly graph = new GraphView();

  /** Which half of the Settings > Recipes page is showing. */
  recipeSource: RecipeSource = 'game';

  /** Whether the Settings area is showing instead of the main layout, and which page. */
  settingsOpen = false;
  settingsPage: SettingsPage = 'icons';

  /* ------------------------------ lifecycle ------------------------------ */

  start(): void {
    openSharedPlan(this);

    wireTopBar(this);
    wireSidebar(this);
    wireFlowTab(this);
    wireTabs(this);
    wireRecipesTab(this);
    wireRecipeEditor(this);
    wirePicker(this);
    wireIconDialog(this);
    wireTransfer(this);
    wireSettings(this);
    wireDrawerClose(this);

    attachItemSearch(this, need<HTMLInputElement>('#targetSearch'), (key) => this.addTarget(key, 1), {
      preferMakeable: true,
    });
    attachItemSearch(this, need<HTMLInputElement>('#rawAddInput'), (key) => this.supplyAsRaw(key), {
      allowFree: true,
    });

    // Redraw whenever the atlas changes, so icons and line colours appear once they are ready.
    icons.onChange(() => {
      clearLineColorCache();
      if (this.store.activeTab === 'flow') renderFlow(this);
      if (this.settingsOpen) renderSettingsPage(this);
    });

    this.renderStatic();
    this.render();

    void this.loadStoredIcons();
    void this.loadStoredGameData();
  }

  /** Re-solve, save, and redraw everything that depends on the solution. */
  update(): void {
    this.store.update();
    this.render();
  }

  /** Redraw from the current solution, without re-solving. */
  render(): void {
    renderSidebarLists(this);
    renderSummary(this);
    this.renderActiveTab();
    renderDrawer(this);
    if (this.settingsOpen) renderSettingsPage(this);
  }

  /** Redraw the parts that only change when the plan or library does, not on every solve. */
  renderStatic(): void {
    renderProjectSelect(this);
    renderTargets(this);
    renderDefaults(this);
    renderDatalists(this);
  }

  private renderActiveTab(): void {
    switch (this.store.activeTab) {
      case 'flow':
        renderFlow(this);
        break;
      case 'machines':
        renderMachines(this);
        break;
      case 'power':
        renderPower(this);
        break;
    }
  }

  setTab(tab: TabName): void {
    this.store.activeTab = tab;
    setActive('#tabs button', 'tab', tab);
    for (const panel of all('.tab-panel', need('#mainLayout'))) {
      panel.classList.toggle('active', panel.id === `tab-${tab}`);
    }
    this.renderActiveTab();
    // The graph could not size itself while its tab was hidden.
    if (tab === 'flow') requestAnimationFrame(() => this.graph.onResize());
  }

  toggleSettings(): void {
    this.settingsOpen = !this.settingsOpen;
    applySettingsVisibility(this);
  }

  /** Switch back to the plan view, e.g. after acting on a recipe from Settings. */
  closeSettings(): void {
    if (!this.settingsOpen) return;
    this.settingsOpen = false;
    applySettingsVisibility(this);
  }

  setSettingsPage(page: SettingsPage): void {
    this.settingsPage = page;
    renderSettingsPage(this);
  }

  switchProject(id: string): void {
    this.store.switchProject(id);
    // Plans have their own saved node positions, so the view has to re-fit.
    this.graph.resetViewMemory();
    this.renderStatic();
    this.update();
  }

  /* ------------------------------ selection ------------------------------ */

  selectById(id: string | null): void {
    this.store.selectById(id);
    this.graph.highlight(id);
    renderDrawer(this);
    if (id && this.store.activeTab === 'flow') {
      requestAnimationFrame(() => this.graph.ensureVisible(id));
    }
  }

  /* ------------------------------ plan commands ------------------------------ */

  addTarget(item: ItemKey, rate = 1): void {
    if (!item) return;
    const project = this.store.project;

    if (project.targets.some((t) => t.item === item)) {
      toast(`${itemName(item)} is already a target`);
      return;
    }
    project.targets.push({ item, rate });
    this.renderStatic();
    this.update();

    // Start building the chain right away, unless the item is already being made or supplied.
    const needsRecipe =
      this.store.producersOf(item).length &&
      this.store.currentChoice(item) === 'raw' &&
      project.choices[item] !== 'raw';
    if (needsRecipe) this.openPicker(item);
  }

  /** Supply an item yourself, hiding whatever would have made it. */
  supplyAsRaw(text: string): void {
    const item = this.store.keyFromText(text);
    if (!item) return;

    const project = this.store.project;
    if (project.choices[item] === 'raw') {
      toast(`${itemName(item)} is already supplied as raw`);
      return;
    }
    project.choices[item] = 'raw';
    this.update();
    toast(`${itemName(item)} is now supplied as a raw input`);
  }

  /** The reverse: craft the item in the plan again. */
  showChain(item: ItemKey): void {
    const project = this.store.project;
    delete project.choices[item];

    // Auto-expansion only follows your own recipes, so a game item needs an explicit choice.
    if (this.store.currentChoice(item) === 'raw') {
      const producers = this.store.producersOf(item);
      if (producers.length === 1) {
        project.choices[item] = producers[0]!.id;
      } else if (producers.length > 1) {
        this.update();
        this.openPicker(item);
        return;
      }
    }
    this.update();
  }

  /** Supply everything a step makes, hiding the whole chain behind it. */
  hideChain(stepId: string): void {
    const recipe = this.store.index.byId.get(stepId);
    if (!recipe) return;

    const project = this.store.project;
    const hidden: ItemKey[] = [];
    for (const output of recipe.outputs) {
      if (this.store.currentChoice(output.item) !== stepId) continue;
      project.choices[output.item] = 'raw';
      hidden.push(output.item);
    }

    // The step is about to disappear, so the drawer cannot keep showing it.
    if (this.store.selection?.type === 'step') this.store.select(null);
    this.update();

    if (hidden.length) {
      toast(
        `${hidden.map(itemName).join(', ')} is now supplied as a raw input. ` +
          'Use "Show chain" in Raw inputs to bring it back.',
      );
    }
  }

  /* ------------------------------ dialogs ------------------------------ */

  openPicker(item: ItemKey): void {
    openPicker(this, item);
  }

  openRecipeEditor(recipe: Recipe | null, prefill?: Partial<Recipe>): void {
    openRecipeEditor(recipe, prefill);
  }

  /** Game recipes are read-only, so editing one means copying it into your library first. */
  editOrCopy(recipe: Recipe): void {
    if (recipe.src !== 'game') {
      this.openRecipeEditor(recipe);
      return;
    }
    const copy = deepClone(recipe);
    delete copy.src;
    copy.id = uid('r_');
    copy.name = `${recipe.name} (custom)`;
    this.openRecipeEditor(null, copy);
  }

  /* ------------------------------ game data ------------------------------ */

  private async loadStoredIcons(): Promise<void> {
    await icons.load();
    if (icons.loaded) {
      this.renderStatic();
      this.update();
    }
  }

  private async loadStoredGameData(): Promise<void> {
    const stored = await loadGameData();
    if (!stored || !Array.isArray(stored.recipes)) return;

    // An import from an older version may predate tool handling; apply it now rather than
    // making you re-export.
    normalizeTools(stored.recipes, {
      gtIcons: stored.icons?.gtIcons ?? {},
      itemInfo: stored.itemInfo ?? {},
      names: stored.names ?? {},
    });
    this.adoptGameData(stored);
    this.renderStatic();
    this.update();
  }

  async importGameFile(file: File): Promise<void> {
    toast(`Reading ${file.name}…`, WORKING_TOAST_MS);

    let dump: unknown;
    try {
      dump = JSON.parse(await file.text());
    } catch {
      toast('That file is not valid JSON');
      return;
    }
    // Let the message paint; parsing a full export blocks for a moment.
    await new Promise((resolve) => setTimeout(resolve, PAINT_DELAY_MS));

    let imported: ImportedGame;
    try {
      imported = parseGameDump(dump as Parameters<typeof parseGameDump>[0]);
    } catch (error) {
      toast(error instanceof Error ? error.message : String(error), 5000);
      return;
    }
    if (!imported.recipes.length) {
      toast('No GregTech recipes found in that file', 5000);
      return;
    }

    this.adoptGameData(imported);
    this.recipeSource = 'game';

    let saved = true;
    try {
      await saveGameData(imported);
    } catch {
      saved = false;
    }

    this.renderStatic();
    this.update();

    const { parsed, skipped, errors } = imported.stats;
    const dropped = skipped + errors;
    toast(
      `Imported ${parsed.toLocaleString()} recipes` +
        (dropped ? ` (${dropped.toLocaleString()} skipped)` : '') +
        (saved ? '' : ' — could not save them in this browser, re-import next time'),
      IMPORT_TOAST_MS,
    );

    await this.offerToRemoveStarters();
  }

  async removeGameData(): Promise<void> {
    this.store.gameData = null;
    registerItemNames({});
    setIconMaterialData({}, {});
    clearPickerEfficiency();
    this.store.markLibraryDirty();
    this.recipeSource = 'mine';

    try {
      await saveGameData(null);
    } catch {
      // Nothing to do: the in-memory state is already clear.
    }
    this.renderStatic();
    this.update();
  }

  private adoptGameData(game: ImportedGame): void {
    this.store.gameData = game;
    registerItemNames(game.names);
    setIconMaterialData(game.icons.gtIcons, game.icons.gtMaterials);
    clearPickerEfficiency();
    this.store.markLibraryDirty();
  }

  /** The example recipes only confuse things once real ones are in; offer to drop them. */
  private async offerToRemoveStarters(): Promise<void> {
    const starterIds = new Set(STARTER_RECIPES.map((r) => r.id));
    const present = this.store.state.library.filter((r) => starterIds.has(r.id));
    if (!present.length) return;

    const confirmed = await confirmAction({
      title: 'Remove the example recipes?',
      message:
        `Your library still has ${present.length} starter example recipes. ` +
        'Remove them so only real game recipes (and your own) are used?',
      okLabel: 'Remove examples',
    });
    if (!confirmed) return;

    this.store.state.library = this.store.state.library.filter((r) => !starterIds.has(r.id));
    this.store.markLibraryDirty();
    this.renderStatic();
    this.update();
  }
}

/* ------------------------------ wiring that has no view ------------------------------ */

function wireTabs(app: App): void {
  for (const button of all<HTMLButtonElement>('#tabs button')) {
    button.addEventListener('click', () => app.setTab(button.dataset['tab'] as TabName));
  }
}

function wireDrawerClose(app: App): void {
  need<HTMLButtonElement>('#drawerClose').addEventListener('click', () => app.selectById(null));

  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    // A dialog handles its own Escape; only close the drawer when none is open.
    if (need<HTMLDialogElement>('#recipeDialog').open) return;
    if (app.store.selection) app.selectById(null);
  });
}
