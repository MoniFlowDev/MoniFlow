/**
 * The recipe editor dialog, for writing your own recipes.
 *
 * Durations are entered in ticks by default because that is what GregTech and EMI show, with a
 * seconds option for convenience. Fluid amounts are mB. Each ingredient row can be toggled between
 * item and fluid by clicking its marker, which is quicker than two sets of buttons.
 */
import { MACHINES, machineUsesCoil } from '../data/machines';
import { tier as tierAt, tierForEut } from '../data/tiers';
import { escapeHtml } from '../core/html';
import { itemName } from '../core/item-names';
import { TICKS_PER_SECOND } from '../core/units';
import type { Recipe, RecipeIO } from '../core/types';
import { uid } from '../state/project';
import type { App } from './app';
import { all, need } from './dom';
import { toast } from './toast';

/**
 * The form's named fields, looked up by `name`. They cannot be typed as properties of
 * `HTMLFormElement` because `name` already means something else on a form element.
 */
interface EditorFields {
  form: HTMLFormElement;
  name: HTMLInputElement;
  machine: HTMLInputElement;
  duration: HTMLInputElement;
  durUnit: HTMLSelectElement;
  eut: HTMLInputElement;
  temp: HTMLInputElement;
  minTier: HTMLOutputElement;
}

function editorFields(): EditorFields {
  const form = need<HTMLFormElement>('#recipeForm');
  const field = <T extends Element>(name: string): T => form.elements.namedItem(name) as T;
  return {
    form,
    name: field('name'),
    machine: field('machine'),
    duration: field('duration'),
    durUnit: field('durUnit'),
    eut: field('eut'),
    temp: field('temp'),
    minTier: field('minTier'),
  };
}

/** The recipe being edited, or null when creating a new one. */
let editingId: string | null = null;

export function openRecipeEditor(recipe: Recipe | null, prefill?: Partial<Recipe>): void {
  editingId = recipe?.id ?? null;

  const draft: Partial<Recipe> = recipe
    ? structuredClone(recipe)
    : { name: '', machine: '', duration: 100, eut: 30, inputs: [], outputs: [], ...prefill };

  const form = editorFields();
  need('#recipeDialogTitle').textContent = recipe ? 'Edit recipe' : 'New recipe';

  // A new recipe for a specific item is named after it.
  const prefillProduct = prefill?.outputs?.[0];
  form.name.value = draft.name || (prefillProduct ? itemName(prefillProduct.item) : '');
  form.machine.value = draft.machine ?? '';
  form.duration.value = String(draft.duration ?? 100);
  form.durUnit.value = 't';
  form.eut.value = String(draft.eut ?? 0);
  form.temp.value = draft.temp ? String(draft.temp) : '';

  need('#ioInputs').innerHTML = '';
  need('#ioOutputs').innerHTML = '';
  for (const io of draft.inputs ?? []) addIoRow('inputs', io);
  for (const io of draft.outputs ?? []) addIoRow('outputs', io);
  // Always leave one output row to fill in, since a recipe needs at least one.
  if (!draft.outputs?.length) addIoRow('outputs', { item: '', amount: 1 });

  refreshDerivedFields();
  need<HTMLDialogElement>('#recipeDialog').showModal();
}

/* ------------------------------ ingredient rows ------------------------------ */

const DEFAULT_ITEM_AMOUNT = 1;
const DEFAULT_FLUID_AMOUNT = 1000;

function addIoRow(kind: 'inputs' | 'outputs', io: Partial<RecipeIO>): HTMLElement {
  const isOutput = kind === 'outputs';
  const fluid = !!io.fluid;

  const row = document.createElement('div');
  row.className = `io-row${isOutput ? '' : ' no-chance'}`;
  row.dataset['fluid'] = fluid ? '1' : '';
  row.innerHTML = `
    <span class="kind${fluid ? ' fluid' : ''}" title="${fluid ? 'Fluid (mB)' : 'Item'}"></span>
    <input class="io-item-name" list="itemList" placeholder="${fluid ? 'Fluid name' : 'Item name'}"
      value="${escapeHtml(io.item ? itemName(io.item) : '')}">
    <input class="io-amt" type="number" min="0" step="any"
      value="${io.amount ?? (fluid ? DEFAULT_FLUID_AMOUNT : DEFAULT_ITEM_AMOUNT)}"
      title="${fluid ? 'mB' : 'count'}">
    ${
      isOutput
        ? `<input class="io-chance" type="number" min="0" max="100" step="any" value="${io.chance ?? 100}" title="Chance %">`
        : ''
    }
    <button type="button" class="icon-btn" title="Remove">×</button>`;

  const marker = row.querySelector<HTMLElement>('.kind')!;
  marker.addEventListener('click', () => {
    const nowFluid = !row.dataset['fluid'];
    row.dataset['fluid'] = nowFluid ? '1' : '';
    marker.classList.toggle('fluid', nowFluid);
  });
  row.querySelector<HTMLButtonElement>('.icon-btn')!.addEventListener('click', () => row.remove());

  need(isOutput ? '#ioOutputs' : '#ioInputs').appendChild(row);
  return row;
}

function readIoRows(container: HTMLElement, isOutput: boolean, app: App): RecipeIO[] {
  return all('.io-row', container)
    .map((row) => {
      const io: RecipeIO = {
        item: app.store.keyFromText(row.querySelector<HTMLInputElement>('.io-item-name')!.value),
        amount: Number(row.querySelector<HTMLInputElement>('.io-amt')!.value) || 0,
      };
      if (row.dataset['fluid']) io.fluid = true;
      if (isOutput) {
        const chance = Number(row.querySelector<HTMLInputElement>('.io-chance')!.value);
        // 100% is the default, so leave it off.
        if (isFinite(chance) && chance !== 100) io.chance = chance;
      }
      return io;
    })
    .filter((io) => io.item && io.amount > 0);
}

/* ------------------------------ derived fields ------------------------------ */

/** Minimum tier follows the EU/t; the heat field only appears for machines that use coils. */
function refreshDerivedFields(): void {
  const form = editorFields();
  const tier = tierAt(tierForEut(Number(form.eut.value) || 0));
  form.minTier.value = tier.name;
  form.minTier.style.color = tier.color;

  const needsHeat = machineUsesCoil(form.machine.value) || !!form.temp.value;
  need('#tempField').style.display = needsHeat ? '' : 'none';
}

/* ------------------------------ saving ------------------------------ */

function save(app: App): boolean {
  const form = editorFields();
  const duration = Number(form.duration.value) || 1;

  const recipe: Recipe = {
    id: editingId ?? uid('r_'),
    name: form.name.value.trim(),
    machine: form.machine.value.trim(),
    duration: Math.max(
      1,
      Math.round(form.durUnit.value === 's' ? duration * TICKS_PER_SECOND : duration),
    ),
    eut: Math.max(0, Number(form.eut.value) || 0),
    inputs: readIoRows(need('#ioInputs'), false, app),
    outputs: readIoRows(need('#ioOutputs'), true, app),
  };
  if (Number(form.temp.value) > 0) recipe.temp = Number(form.temp.value);

  if (!recipe.outputs.length) {
    toast('A recipe needs at least one output');
    return false;
  }

  const library = app.store.state.library;
  const existing = library.findIndex((r) => r.id === recipe.id);
  if (existing >= 0) library[existing] = recipe;
  else library.push(recipe);

  app.store.markLibraryDirty();
  app.renderStatic();
  app.update();
  toast(`Saved "${recipe.name}"`);
  return true;
}

export function wireRecipeEditor(app: App): void {
  const form = editorFields();

  form.eut.addEventListener('input', refreshDerivedFields);
  form.machine.addEventListener('input', refreshDerivedFields);

  for (const button of all<HTMLButtonElement>('[data-add]')) {
    button.addEventListener('click', () => {
      const kind = button.dataset['add'] as 'inputs' | 'outputs';
      const row = addIoRow(kind, { item: '', fluid: !!button.dataset['fluid'] });
      row.querySelector<HTMLInputElement>('.io-item-name')!.focus();
    });
  }

  need<HTMLButtonElement>('#recipeCancel').addEventListener('click', () => {
    need<HTMLDialogElement>('#recipeDialog').close();
  });

  form.form.addEventListener('submit', (event) => {
    event.preventDefault();
    if (save(app)) need<HTMLDialogElement>('#recipeDialog').close();
  });
}

/** The item and machine suggestion lists, rebuilt when the library changes. */
export function renderDatalists(app: App): void {
  const machines = new Set<string>();
  for (const spec of MACHINES) machines.add(spec.name);
  for (const recipe of app.store.state.library) machines.add(recipe.machine);
  need('#machineList').innerHTML = [...machines]
    .sort()
    .map((name) => `<option value="${escapeHtml(name)}">`)
    .join('');

  // Only your own recipes' items: the whole game list would be far too long for a datalist.
  const items = new Set<string>();
  for (const recipe of app.store.state.library) {
    for (const io of [...recipe.inputs, ...recipe.outputs]) items.add(itemName(io.item));
  }
  need('#itemList').innerHTML = [...items]
    .sort()
    .map((name) => `<option value="${escapeHtml(name)}">`)
    .join('');
}
