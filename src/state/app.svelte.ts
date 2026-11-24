import { itemName, registerItemNames } from '../core/item-names';
import { createFormatter } from '../core/format';
import type {
  AppState,
  ItemKey,
  Project,
  Recipe,
  NodeOverrides,
  GraphDirection,
  Point,
} from '../core/types';
import { buildRecipeIndex, producersOf, resolveChoice } from '../solver/recipe-index';
import { solve } from '../solver/solve';
import { loadState, saveState } from './persistence';
import { defaultState, newProject, uid } from './project';
import { ItemCatalog } from './item-catalog';
import { RecipeSearchIndex } from './recipe-search';
import {
  applySharePayload,
  buildShareUrl,
  importProject,
  mergeRecipes,
  parseShareHash,
  type BackupFile,
} from './transfer';
import { loadGameData, saveGameData } from '../import/game-store';
import { normalizeTools } from '../import/leftovers';
import { parseGameDump, type ImportedGame } from '../import/parse-dump';
import { STARTER_RECIPES } from '../data/starter-recipes';
import { icons } from '../icons/icon-store';
import { clearLineColorCache, setIconMaterialData } from '../icons/line-color';

export type Selection =
  | { type: 'step'; id: string }
  | { type: 'item'; item: ItemKey; kind: 'raw' | 'out' | 'sur' };
export interface AskOptions {
  title: string;
  message?: string;
  input?: string;
  okLabel?: string;
  danger?: boolean;
}
export interface EditorSession {
  recipe: Recipe;
  existing: boolean;
}

/** One model per mounted application. UI writes state through actions; calculations stay pure TS. */
export class AppModel {
  state = $state<AppState>(loadState() ?? defaultState());
  gameData = $state.raw<ImportedGame | null>(null);
  selection = $state<Selection | null>(null);
  picker = $state<{ item: ItemKey; projectId: string } | null>(null);
  editor = $state.raw<EditorSession | null>(null);
  iconDialog = $state(false);
  iconRevision = $state(0);
  nameRevision = $state(0);
  recipeSource = $state<'mine' | 'game'>('game');
  toast = $state('');
  askRequest = $state.raw<(AskOptions & { resolve: (value: string | true | null) => void }) | null>(
    null,
  );
  ready = $state(false);
  layoutRevision = $state(0);
  private toastTimer: ReturnType<typeof setTimeout> | undefined;
  private gameOperation = 0;
  private disposed = false;

  project = $derived(
    this.state.projects.find((p) => p.id === this.state.activeId) ?? this.state.projects[0]!,
  );
  private recipes = $derived.by(() => [
    ...$state.snapshot(this.state.library),
    ...(this.gameData?.recipes ?? []),
  ]);
  index = $derived(buildRecipeIndex(this.recipes));
  catalog = $derived.by(() => {
    this.nameRevision;
    const catalog = new ItemCatalog();
    catalog.rebuild(this.index);
    return catalog;
  });
  librarySearch = $derived.by(() => {
    this.nameRevision;
    const search = new RecipeSearchIndex();
    search.rebuild($state.snapshot(this.state.library));
    return search;
  });
  gameSearch = $derived.by(() => {
    this.nameRevision;
    const search = new RecipeSearchIndex();
    search.rebuild(this.gameData?.recipes ?? []);
    return search;
  });
  // Exclude layout, generator and display preferences from solver dependencies.
  private solveProject = $derived.by((): Project => {
    const p = this.project;
    return $state.snapshot({
      id: p.id,
      name: '',
      targets: p.targets,
      choices: p.choices,
      nodes: p.nodes,
      defaultTier: p.defaultTier,
      defaultCoil: p.defaultCoil,
      gridTier: p.gridTier,
      autoExpand: p.autoExpand,
      autoPerfectTier: p.autoPerfectTier,
      gen: { preset: 0, eut: 32 },
    });
  });
  solution = $derived(solve(this.solveProject, this.index));
  format = $derived(createFormatter(this.state.unit, this.state.fluidUnits ?? 'auto'));
  selectedId = $derived(
    this.selection?.type === 'step'
      ? this.selection.id
      : this.selection
        ? `${this.selection.kind}:${this.selection.item}`
        : null,
  );

  producersOf(item: ItemKey): Recipe[] {
    return producersOf(this.index, item);
  }
  currentChoice(item: ItemKey): string {
    return resolveChoice(this.project, this.index, item)?.id ?? 'raw';
  }
  isFluid(item: ItemKey): boolean {
    return this.index.fluids.has(item);
  }
  keyFromText(text: string): ItemKey {
    return this.catalog.keyFromText(text, this.index);
  }
  searchRecipes(source: 'mine' | 'game', query: string): Recipe[] {
    return (source === 'game' ? this.gameSearch : this.librarySearch).search(query);
  }
  notify(message: string, ms = 3000): void {
    clearTimeout(this.toastTimer);
    this.toast = message;
    this.toastTimer = setTimeout(() => (this.toast = ''), ms);
  }
  ask(options: AskOptions): Promise<string | true | null> {
    this.askRequest?.resolve(null);
    return new Promise((resolve) => (this.askRequest = { ...options, resolve }));
  }
  answer(value: string | true | null): void {
    const request = this.askRequest;
    this.askRequest = null;
    request?.resolve(value);
  }
  selectById(id: string | null): void {
    if (!id) {
      this.selection = null;
      return;
    }
    const prefix = id.slice(0, 4);
    this.selection = ['raw:', 'out:', 'sur:'].includes(prefix)
      ? {
          type: 'item',
          item: id.slice(4),
          kind: id.slice(0, 3) as 'raw' | 'out' | 'sur',
        }
      : { type: 'step', id };
  }
  switchProject(id: string): void {
    if (!this.state.projects.some((p) => p.id === id)) return;
    this.state.activeId = id;
    this.selection = null;
    this.picker = null;
  }
  async createProject(): Promise<void> {
    const name = await this.ask({
      title: 'New plan',
      input: 'New plan',
      okLabel: 'Create',
    });
    if (typeof name !== 'string') return;
    const project = newProject({
      name: name.trim() || 'New plan',
      defaultTier: this.project.defaultTier,
      gridTier: this.project.gridTier,
    });
    this.state.projects.push(project);
    this.switchProject(project.id);
  }
  async renameProject(): Promise<void> {
    const project = this.project;
    const name = await this.ask({
      title: 'Rename plan',
      input: project.name,
      okLabel: 'Rename',
    });
    if (typeof name === 'string' && name.trim()) project.name = name.trim();
  }
  duplicateProject(): void {
    const copy = newProject($state.snapshot(this.project));
    copy.name += ' (copy)';
    this.state.projects.push(copy);
    this.switchProject(copy.id);
  }
  async deleteProject(): Promise<void> {
    const project = this.project;
    if (
      (await this.ask({
        title: 'Delete plan?',
        message: `“${project.name}” will be deleted. Your recipe library is kept.`,
        danger: true,
        okLabel: 'Delete',
      })) !== true
    )
      return;
    this.state.projects = this.state.projects.filter((p) => p.id !== project.id);
    if (!this.state.projects.length) this.state.projects.push(newProject());
    if (this.state.activeId === project.id) this.switchProject(this.state.projects[0]!.id);
  }
  addTarget(item: ItemKey, rate = 1): void {
    if (!item) return;
    if (this.project.targets.some((t) => t.item === item)) {
      this.notify(`${itemName(item)} is already a target`);
      return;
    }
    this.project.targets.push({ item, rate });
    if (
      this.producersOf(item).length &&
      this.currentChoice(item) === 'raw' &&
      this.project.choices[item] !== 'raw'
    )
      this.openPicker(item);
  }
  setTargetRate(item: ItemKey, shown: number): void {
    const target = this.project.targets.find((t) => t.item === item);
    if (target)
      target.rate = Number.isFinite(shown) && shown > 0 ? shown / this.format.multiplier : 0;
  }
  removeTarget(item: ItemKey): void {
    this.project.targets = this.project.targets.filter((t) => t.item !== item);
  }
  supplyAsRaw(text: string): void {
    const item = this.keyFromText(text);
    if (!item) return;
    this.project.choices[item] = 'raw';
    this.notify(`${itemName(item)} is now supplied as a raw input`);
  }
  showChain(item: ItemKey): void {
    delete this.project.choices[item];
    if (this.currentChoice(item) !== 'raw') return;
    const producers = this.producersOf(item);
    if (producers.length === 1) this.project.choices[item] = producers[0]!.id;
    else if (producers.length > 1) this.openPicker(item);
  }
  hideChain(id: string): void {
    const recipe = this.index.byId.get(id);
    if (!recipe) return;
    for (const output of recipe.outputs)
      if (this.currentChoice(output.item) === id) this.project.choices[output.item] = 'raw';
    this.selection = null;
    this.notify('Chain hidden. Use Show chain in Raw inputs to bring it back.');
  }
  openPicker(item: ItemKey): void {
    this.picker = { item, projectId: this.project.id };
  }
  chooseRecipe(value: string): void {
    const picker = this.picker;
    if (!picker || picker.projectId !== this.project.id) return;
    this.project.choices[picker.item] = value;
    this.picker = null;
    this.notify(
      value === 'raw'
        ? `${itemName(picker.item)} is supplied as a raw input`
        : `${itemName(picker.item)} → ${this.index.byId.get(value)?.machine ?? 'recipe'}`,
    );
  }
  overrideNode(id: string, settings: NodeOverrides): void {
    this.project.nodes[id] = { ...this.project.nodes[id], ...settings };
  }
  saveNodePosition(id: string, point: Point, dir: GraphDirection): void {
    this.project.graphPos ??= {};
    this.project.graphPos[dir] ??= {};
    this.project.graphPos[dir]![id] = {
      x: Math.round(point.x),
      y: Math.round(point.y),
    };
  }
  resetLayout(): void {
    delete this.project.graphPos?.[this.project.graphDir ?? 'lr'];
    this.layoutRevision++;
  }
  openEditor(recipe?: Recipe, prefill: Partial<Recipe> = {}): void {
    this.editor = {
      existing: !!recipe,
      recipe: structuredClone(
        $state.snapshot(
          recipe ?? {
            id: uid('r_'),
            name: '',
            machine: '',
            duration: 100,
            eut: 30,
            inputs: [],
            outputs: [{ item: '', amount: 1 }],
            ...prefill,
          },
        ),
      ),
    };
  }
  editOrCopy(recipe: Recipe): void {
    if (recipe.src !== 'game') {
      this.openEditor(recipe);
      return;
    }
    const copy = structuredClone($state.snapshot(recipe));
    delete copy.src;
    copy.id = uid('r_');
    copy.name += ' (custom)';
    this.openEditor(undefined, copy);
  }
  saveRecipe(recipe: Recipe): void {
    const copy = $state.snapshot(recipe);
    const index = this.state.library.findIndex((r) => r.id === copy.id);
    if (index < 0) this.state.library.push(copy);
    else this.state.library[index] = copy;
    this.editor = null;
    this.notify(`Saved “${copy.name}”`);
  }
  duplicateRecipe(recipe: Recipe): void {
    const copy = structuredClone($state.snapshot(recipe));
    copy.id = uid('r_');
    copy.name += ' (copy)';
    delete copy.src;
    this.state.library.push(copy);
  }
  async deleteRecipe(recipe: Recipe): Promise<void> {
    if (
      (await this.ask({
        title: 'Delete recipe?',
        message: `“${recipe.name}” will be removed from your library and any plan that uses it.`,
        danger: true,
        okLabel: 'Delete',
      })) !== true
    )
      return;
    this.state.library = this.state.library.filter((r) => r.id !== recipe.id);
    for (const project of this.state.projects)
      for (const item of Object.keys(project.choices))
        if (project.choices[item] === recipe.id) delete project.choices[item];
  }
  makeRecipe(recipe: Recipe): void {
    const item = recipe.outputs[0]?.item;
    if (!item) return;
    this.project.choices[item] = recipe.id;
    if (!this.project.targets.some((t) => t.item === item))
      this.project.targets.push({ item, rate: 1 });
  }
  restoreStarters(): void {
    for (const recipe of STARTER_RECIPES)
      if (!this.state.library.some((r) => r.id === recipe.id))
        this.state.library.push(structuredClone(recipe) as Recipe);
    this.notify('Starter recipes restored');
  }
  importBackup(data: BackupFile | unknown[], libraryOnly = false): void {
    if (!data || typeof data !== 'object') throw new Error('Not a MoniFlow backup');
    const backup = Array.isArray(data) ? { library: data } : data;
    if (libraryOnly && !Array.isArray(backup.library))
      throw new Error('No recipes found in that file');
    if (Array.isArray(backup.library)) mergeRecipes(this.state, backup.library);
    if (!libraryOnly) {
      let last: Project | undefined;
      if (Array.isArray(backup.projects)) {
        for (const project of backup.projects) {
          if (project && typeof project === 'object') last = importProject(this.state, project);
        }
      }
      if (backup.project && typeof backup.project === 'object')
        last = importProject(this.state, backup.project);
      if (last) this.switchProject(last.id);
    }
    this.notify('Import complete');
  }
  openSharedPlan(): void {
    const payload = parseShareHash(location.hash);
    if (!payload) return;
    const project = applySharePayload(
      this.state,
      payload,
      (id) =>
        this.state.library.some((r) => r.id === id) ||
        !!this.gameData?.recipes.some((r) => r.id === id),
    );
    this.nameRevision++;
    if (project) {
      this.switchProject(project.id);
      this.notify(`Opened shared plan “${project.name}”`);
    }
    history.replaceState(null, '', location.href.split('#')[0]!);
  }
  async share(): Promise<void> {
    const ids = new Set(this.solution.steps.map((s) => s.id));
    for (const choice of Object.values(this.project.choices)) if (choice !== 'raw') ids.add(choice);
    const recipes = [...ids].map((id) => this.index.byId.get(id)).filter((r): r is Recipe => !!r);
    const url = buildShareUrl($state.snapshot(this.project), recipes);
    try {
      await navigator.clipboard.writeText(url);
      this.notify('Share link copied to clipboard');
    } catch {
      await this.ask({ title: 'Copy this link', input: url, okLabel: 'Done' });
    }
  }
  private adoptGame(game: ImportedGame | null): void {
    registerItemNames(game?.names ?? {});
    setIconMaterialData(game?.icons.gtIcons ?? {}, game?.icons.gtMaterials ?? {});
    clearLineColorCache();
    this.gameData = game;
    this.nameRevision++;
    this.iconRevision++;
  }
  async start(): Promise<void> {
    const operation = this.gameOperation;
    const stored = await loadGameData();
    if (this.disposed) return;
    if (operation === this.gameOperation && stored?.recipes) {
      normalizeTools(stored.recipes, {
        gtIcons: stored.icons?.gtIcons ?? {},
        itemInfo: stored.itemInfo ?? {},
        names: stored.names ?? {},
      });
      this.adoptGame(stored);
    }
    this.openSharedPlan();
    this.ready = true;
    await icons.load();
  }
  async importGame(file: File): Promise<void> {
    const operation = ++this.gameOperation;
    this.notify(`Reading ${file.name}…`, 60_000);
    try {
      const dump = JSON.parse(await file.text());
      await new Promise((resolve) => setTimeout(resolve, 30));
      if (operation !== this.gameOperation || this.disposed) return;
      const game = parseGameDump(dump);
      if (!game.recipes.length) throw new Error('No GregTech recipes found in that file');
      this.adoptGame(game);
      this.recipeSource = 'game';
      let saved = true;
      try {
        await saveGameData(game);
      } catch {
        saved = false;
      }
      if (operation !== this.gameOperation || this.disposed) return;
      this.notify(
        `Imported ${game.stats.parsed.toLocaleString()} recipes (${game.stats.skipped + game.stats.errors} skipped)${saved ? '' : ' — could not save; re-import next time'}`,
        6000,
      );
      const ids = new Set(STARTER_RECIPES.map((r) => r.id));
      if (
        this.state.library.some((r) => ids.has(r.id)) &&
        (await this.ask({
          title: 'Remove the example recipes?',
          message: 'Keep only real game recipes and your own recipes?',
          okLabel: 'Remove examples',
        })) === true &&
        operation === this.gameOperation
      )
        this.state.library = this.state.library.filter((r) => !ids.has(r.id));
    } catch (error) {
      if (operation === this.gameOperation && !this.disposed)
        this.notify(error instanceof Error ? error.message : String(error), 6000);
    }
  }
  async removeGame(): Promise<void> {
    if (
      (await this.ask({
        title: 'Remove game recipes?',
        message: 'Plans using them will show raw inputs until you import again.',
        danger: true,
        okLabel: 'Remove',
      })) !== true
    )
      return;
    ++this.gameOperation;
    this.adoptGame(null);
    this.recipeSource = 'mine';
    try {
      await saveGameData(null);
    } catch {
      this.notify('Game recipes removed, but browser storage could not be updated');
    }
  }
  persist(): void {
    saveState($state.snapshot(this.state));
  }
  dispose(): void {
    this.disposed = true;
    ++this.gameOperation;
    clearTimeout(this.toastTimer);
    this.answer(null);
  }
}
