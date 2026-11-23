/**
 * The recipe picker: the dialog that opens when you choose how an item should be made.
 *
 * An item in Monifactory can have dozens of recipes, most of them wrong for you — too high a tier,
 * a recycling recipe, or a round trip that just converts a shape of something you already have.
 * So each row carries the numbers that decide it: total energy per item including everything
 * underneath, energy for this step alone, machines for one per second, raw materials, and tier.
 *
 * Building that cost model is not instant, so the dialog opens immediately with a placeholder and
 * fills in a tick later rather than freezing on the click.
 */
import { formatFluid, formatNumber, plural } from '../core/format';
import { escapeHtml } from '../core/html';
import { itemName, itemNameHtml } from '../core/item-names';
import { expectedAmount } from '../core/recipe';
import { tier as tierAt } from '../data/tiers';
import type { ByproductMode, ItemKey, Recipe } from '../core/types';
import { isPickSort, PICK_SORTS, rankRecipes, type PickSort } from '../efficiency/ranking';
import type { Efficiency, RecipeStats } from '../efficiency/recipe-stats';
import type { App } from './app';
import { itemDot, machineIcon, recipeBadge, recipeTiming } from './badges';
import { need } from './dom';
import { ioChips } from './io-chips';
import { pickerEfficiency } from './picker-efficiency';
import { recipeSearchText } from './recipe-text';
import { toast } from './toast';

/** Rows rendered at most; the filters are there for narrowing further. */
const LIMIT = 150;
/** Delay before the first ranking, so the dialog paints first. */
const RANK_DELAY_MS = 30;
/** Byproduct shares below this are noise and not worth a chip. */
const MIN_BYPRODUCT_SHARE = 0.005;

const MB_PER_BUCKET = 1000;

interface PickerSession {
  item: ItemKey;
  efficiency: Efficiency;
  /** The cost model has been built, so rows can be ranked. */
  ready: boolean;
}

let session: PickerSession | null = null;

export function openPicker(app: App, item: ItemKey): void {
  const producers = app.store.producersOf(item);
  const fluid = app.store.isFluid(item);

  need('#pickTitle').innerHTML =
    `${itemDot(item, fluid, 'chip-dot')} How should <b>${itemNameHtml(item)}</b> be made?`;
  need('#pickSub').textContent =
    `${plural(producers.length, 'recipe')} make this. Pick one to add it to the tree; ` +
    'its ingredients appear as new inputs you can expand next.';

  fillMachineFilter(producers);
  need<HTMLInputElement>('#pickSearch').value = '';
  need<HTMLSelectElement>('#pickByproducts').value = app.store.state.byproductMode ?? 'split';
  need<HTMLSelectElement>('#pickSort').innerHTML = sortOptions(app.store.state.pickSort);
  fillRecyclingToggle(producers);

  // Efficiency is judged against the plan as it stands, including the choices already made.
  session = { item, efficiency: pickerEfficiency(app.store), ready: false };

  need('#pickList').innerHTML =
    `<p class="hint">Working out the most efficient recipes for ${plural(producers.length, 'recipe')}…</p>`;

  const dialog = need<HTMLDialogElement>('#pickDialog');
  if (!dialog.open) dialog.showModal();
  need<HTMLInputElement>('#pickSearch').focus();

  setTimeout(() => {
    // Guard against the dialog having moved on to another item while we waited.
    if (session?.item !== item) return;
    session.ready = true;
    renderPickList(app);
  }, RANK_DELAY_MS);
}

function fillMachineFilter(producers: readonly Recipe[]): void {
  const counts = new Map<string, number>();
  for (const recipe of producers) {
    counts.set(recipe.machine, (counts.get(recipe.machine) ?? 0) + 1);
  }
  const options = [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([machine, count]) => `<option value="${escapeHtml(machine)}">${escapeHtml(machine)} (${count})</option>`)
    .join('');

  need<HTMLSelectElement>('#pickMachine').innerHTML =
    `<option value="">All machines</option>${options}`;
}

function fillRecyclingToggle(producers: readonly Recipe[]): void {
  const recycling = producers.filter((r) => r.recycling).length;
  need<HTMLInputElement>('#pickRecycle').checked = false;
  need('#pickRecycleWrap').hidden = !recycling;
  need('#pickRecycleLabel').textContent = `Show recycling (${recycling})`;
}

function sortOptions(selected: string | undefined): string {
  const current = isPickSort(selected) ? selected : 'best';
  return Object.entries(PICK_SORTS)
    .map(
      ([key, label]) =>
        `<option value="${key}" ${key === current ? 'selected' : ''}>Sort: ${label}</option>`,
    )
    .join('');
}

/* ------------------------------ the list ------------------------------ */

export function renderPickList(app: App): void {
  if (!session?.ready) return;
  const { item, efficiency } = session;
  const { store } = app;

  const query = need<HTMLInputElement>('#pickSearch').value.trim().toLowerCase();
  const machine = need<HTMLSelectElement>('#pickMachine').value;
  const showRecycling = need<HTMLInputElement>('#pickRecycle').checked;
  const mode: PickSort = isPickSort(store.state.pickSort) ? store.state.pickSort : 'best';

  const candidates = store.producersOf(item).filter(
    (recipe) =>
      (showRecycling || !recipe.recycling) &&
      (!machine || recipe.machine === machine) &&
      (!query || recipeSearchText(recipe).includes(query)),
  );
  const ranked = rankRecipes(candidates, item, efficiency, mode, store.project.defaultTier || 1);

  const current = store.currentChoice(item);
  need('#pickRaw').classList.toggle('active', store.project.choices[item] === 'raw');

  const rows = ranked
    .slice(0, LIMIT)
    .map((row, index) =>
      pickRow(app, item, row.recipe, row.stats, {
        current,
        mode,
        isTop: index === 0 && ranked.length > 1,
      }),
    )
    .join('');

  const note = ranked.length
    ? ranked.length > LIMIT
      ? `<p class="hint">Showing ${LIMIT} of ${ranked.length} — filter to narrow it down.</p>`
      : ''
    : '<p class="muted">No recipes match that filter.</p>';

  need('#pickList').innerHTML = rows + note;
}

interface RowContext {
  current: string;
  mode: PickSort;
  isTop: boolean;
}

function pickRow(
  app: App,
  item: ItemKey,
  recipe: Recipe,
  stats: RecipeStats,
  context: RowContext,
): string {
  const fluid = app.store.isFluid(item);
  const makes = recipe.outputs
    .filter((output) => output.item === item)
    .reduce((sum, output) => sum + expectedAmount(output), 0);

  const isCurrent = recipe.id === context.current;
  return `<button class="pick-row${isCurrent ? ' current' : ''}" data-id="${escapeHtml(recipe.id)}">
    <div class="pr-head">
      ${recipeBadge(recipe)}
      ${machineIcon(recipe, null, 18)}<b>${escapeHtml(recipe.machine)}</b>
      <span class="muted num">${recipeTiming(recipe)}</span>
      ${recipe.temp ? `<span class="muted num">${formatNumber(recipe.temp)}K</span>` : ''}
      ${recipe.cond ? `<span class="cond">${escapeHtml(recipe.cond)}</span>` : ''}
      ${recipe.src !== 'game' ? '<span class="mine-tag">my recipe</span>' : ''}
      <span class="pr-makes">makes ${fluid ? formatFluid(makes) : formatNumber(makes)}</span>
      ${
        context.isTop && !stats.loops
          ? `<span class="best-tag" title="Top of the current sort">★ ${
              context.mode === 'best' ? 'Best' : 'Top'
            }</span>`
          : ''
      }
      ${stats.loops ? loopTag() : ''}
      ${isCurrent ? '<span class="cur-tag">current</span>' : ''}
    </div>
    <div class="pr-stats">${statChips(stats, context.mode, fluid)}</div>
    <div class="pr-io">
      <div class="chips">${ioChips(recipe.inputs) || '<span class="muted">nothing</span>'}</div>
      <div class="arrow">→</div>
      <div class="chips">${ioChips(recipe.outputs, item)}</div>
    </div>
  </button>`;
}

function loopTag(): string {
  return (
    '<span class="loop-tag" title="Its ingredients are made from the item itself (for example ' +
    'nuggets or liquid back into ingots), so it only converts what you already have">' +
    '↻ made from itself</span>'
  );
}

/** The numbers on a row. Fluid costs are shown per bucket, which is the comparable unit. */
function statChips(stats: RecipeStats, mode: PickSort, fluid: boolean): string {
  const scale = fluid ? MB_PER_BUCKET : 1;
  const perUnit = fluid ? '/B' : '/item';
  // The chip matching the active sort is highlighted, so it is clear what the order is by.
  const on = (key: PickSort): string => (mode === key ? ' hl' : '');

  const chips: string[] = [];

  const chainNote = stats.approx
    ? '. Approximate: the ingredient tree loops or goes very deep'
    : '';
  chips.push(
    `<span class="st${on('chain')}" title="Total energy per item, including making its ingredients ` +
      `(following the cheapest recipes, or the ones already in your plan)${chainNote}">` +
      `Σ ${formatNumber(stats.chainEu * scale)} EU${perUnit}${stats.approx ? '*' : ''}</span>`,
  );
  chips.push(
    `<span class="st${on('step')}" title="Energy for this step only">⚡ ${formatNumber(
      stats.stepEu * scale,
    )} EU${perUnit}</span>`,
  );

  if (stats.machines) {
    const tierName = tierAt(stats.runTier!).name;
    chips.push(
      `<span class="st${on('machines')}" title="Machines needed to make 1${
        fluid ? ' bucket' : ''
      } per second at ${tierName}, with overclocking">⚙ ${formatNumber(
        stats.machines * scale,
        2,
      )} machines @ ${tierName}</span>`,
    );
  } else {
    chips.push(`<span class="st${on('machines')}">⚙ instant</span>`);
  }

  chips.push(
    `<span class="st${on('raw')}" title="Raw materials per item, following the ingredient tree ` +
      `(items count 1, fluids count 1 per bucket)">⛏ ${formatNumber(stats.raw * scale)} raw</span>`,
  );
  chips.push(
    `<span class="st${on('tier')}" title="Lowest voltage tier that can run it">${
      stats.tier ? tierAt(stats.tier).name : 'no power'
    }</span>`,
  );

  if (stats.byproductShare > MIN_BYPRODUCT_SHARE) {
    chips.push(
      `<span class="st" title="Share of this recipe's cost carried by its other outputs ` +
        `(split by quantity: items 1 each, fluids 1 per bucket)">♻ ${Math.round(
          stats.byproductShare * 100,
        )}% to byproducts</span>`,
    );
  }

  for (const tool of stats.tools) {
    const about = tool.estimated ? 'about ' : '';
    const caveat = tool.estimated ? ' (estimated; exporter v8 records the exact durability)' : '';
    chips.push(
      `<span class="tool-tag" title="A tool is used, not consumed: it lasts ${about}` +
        `${tool.uses.toLocaleString()} crafts${caveat}">🔨 ${escapeHtml(itemName(tool.item))}: ` +
        `${tool.estimated ? '~' : ''}${tool.uses.toLocaleString()} uses</span>`,
    );
  }

  return chips.join('');
}

/* ------------------------------ choosing ------------------------------ */

function choose(app: App, value: string): void {
  const item = session?.item;
  if (!item) return;

  app.store.project.choices[item] = value;
  need<HTMLDialogElement>('#pickDialog').close();
  app.update();

  if (value === 'raw') {
    toast(`${itemName(item)} is supplied as a raw input`);
    return;
  }

  // Nudge toward the next step: say how many of the new ingredients can be expanded in turn.
  const recipe = app.store.index.byId.get(value);
  const expandable =
    recipe?.inputs.filter(
      (input) =>
        app.store.producersOf(input.item).length &&
        app.store.currentChoice(input.item) === 'raw' &&
        app.store.project.choices[input.item] !== 'raw',
    ).length ?? 0;

  const suffix = expandable
    ? ` · ${plural(expandable, 'ingredient')} can be expanded (＋ on the graph)`
    : '';
  toast(`${itemName(item)} → ${recipe?.machine ?? 'recipe'}${suffix}`, 4000);
}

export function wirePicker(app: App): void {
  need<HTMLInputElement>('#pickSearch').addEventListener('input', () => renderPickList(app));
  need<HTMLSelectElement>('#pickMachine').addEventListener('change', () => renderPickList(app));
  need<HTMLInputElement>('#pickRecycle').addEventListener('change', () => renderPickList(app));

  need<HTMLSelectElement>('#pickSort').addEventListener('change', (event) => {
    app.store.state.pickSort = (event.target as HTMLSelectElement).value;
    app.store.save();
    renderPickList(app);
  });

  need<HTMLSelectElement>('#pickByproducts').addEventListener('change', (event) => {
    app.store.state.byproductMode = (event.target as HTMLSelectElement).value as ByproductMode;
    app.store.save();
    // Costing changed, so the model has to be rebuilt before re-ranking.
    if (session) session.efficiency = pickerEfficiency(app.store);
    renderPickList(app);
  });

  need<HTMLButtonElement>('#pickClose').addEventListener('click', () => {
    need<HTMLDialogElement>('#pickDialog').close();
  });
  need<HTMLButtonElement>('#pickRaw').addEventListener('click', () => choose(app, 'raw'));

  need('#pickList').addEventListener('click', (event) => {
    const row = (event.target as Element).closest<HTMLElement>('.pick-row');
    if (row) choose(app, row.dataset['id']!);
  });
}
