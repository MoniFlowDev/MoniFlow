/**
 * The left column: what you want to make, the defaults new steps inherit, what you have to supply,
 * and what is left over.
 *
 * The raw inputs list separates two very different things that both come out of the solver as
 * "raw": base resources the chain genuinely bottoms out at, and items you chose to supply so their
 * chain would be hidden. The second group gets a way back.
 */
import { formatRate, rateUnitLabel, rateUnitMultiplier } from '../core/format';
import { escapeHtml } from '../core/html';
import { itemNameHtml } from '../core/item-names';
import type { ItemKey } from '../core/types';
import type { Byproduct, RawInput } from '../solver/solve';
import type { App } from './app';
import { coilOptions, itemDot, tierOptions } from './badges';
import { bindChoiceControls, choiceControl } from './choice-control';
import { all, need } from './dom';

export function renderTargets(app: App): void {
  const project = app.store.project;
  const list = need('#targetList');
  const multiplier = rateUnitMultiplier();

  if (!project.targets.length) {
    list.innerHTML =
      '<div class="io-empty" style="margin-bottom:8px">No targets yet — search for an item below.</div>';
    return;
  }

  list.innerHTML = project.targets
    .map((target, i) => {
      const fluid = app.store.isFluid(target.item);
      // Rates are stored per second; show them in whichever unit is selected.
      const shown = +(target.rate * multiplier).toPrecision(6);
      return `
      <div class="target-row" data-i="${i}">
        <span class="t-name" title="${escapeHtml(target.item)}">${itemDot(target.item, fluid)}<span>${itemNameHtml(target.item)}</span></span>
        <input class="t-rate" type="number" min="0" step="any" value="${shown}">
        <span class="unit">${fluid ? 'mB' : 'items'}${rateUnitLabel()}</span>
        <button class="icon-btn t-del" title="Remove target">×</button>
      </div>`;
    })
    .join('');

  for (const row of all('.target-row', list)) {
    const index = Number(row.dataset['i']);

    row.querySelector<HTMLInputElement>('.t-rate')!.addEventListener('input', (event) => {
      const value = parseFloat((event.target as HTMLInputElement).value);
      project.targets[index]!.rate = isFinite(value) && value > 0 ? value / multiplier : 0;
      app.update();
    });

    row.querySelector<HTMLButtonElement>('.t-del')!.addEventListener('click', () => {
      project.targets.splice(index, 1);
      renderTargets(app);
      app.update();
    });
  }
}

export function renderDefaults(app: App): void {
  const project = app.store.project;
  need<HTMLSelectElement>('#defaultTier').innerHTML = tierOptions(project.defaultTier, 1);
  need<HTMLSelectElement>('#gridTier').innerHTML = tierOptions(project.gridTier, 0);
  need<HTMLSelectElement>('#defaultCoil').innerHTML = coilOptions(project.defaultCoil);
  need<HTMLInputElement>('#autoExpand').checked = project.autoExpand !== false;
  need<HTMLInputElement>('#autoPerfectTier').checked = project.autoPerfectTier !== false;
}

export function renderSidebarLists(app: App): void {
  renderRawInputs(app);
  renderByproducts(app);
  renderWarnings(app);
}

function renderRawInputs(app: App): void {
  const { store } = app;
  const container = need('#rawList');
  const solution = store.solution;

  // Items you marked raw yourself, including ones the plan no longer needs.
  const suppliedKeys = Object.keys(store.project.choices).filter(
    (item) => store.project.choices[item] === 'raw',
  );
  const supplied = suppliedKeys
    .map(
      (item): RawInput =>
        solution.raw.find((r) => r.item === item) ?? {
          item,
          rate: 0,
          fluid: store.isFluid(item),
          manual: true,
          expandable: store.producersOf(item).length > 0,
          unused: true,
        },
    )
    .sort((a, b) => b.rate - a.rate);

  const chosen = new Set(suppliedKeys);
  const base = solution.raw.filter((r) => !chosen.has(r.item));

  let html = '';
  if (supplied.length) {
    html +=
      `<div class="io-sub"><span>Supplied by you · chain hidden</span><span>${supplied.length}</span></div>` +
      supplied.map((raw) => rawRow(app, raw, true)).join('');
  }
  if (base.length) {
    if (supplied.length) html += '<div class="io-sub"><span>Base resources</span></div>';
    html += base.map((raw) => rawRow(app, raw, false)).join('');
  }
  container.innerHTML = html || '<div class="io-empty">None</div>';

  bindChoiceControls(app, container);
  for (const button of all<HTMLButtonElement>('[data-show]', container)) {
    button.addEventListener('click', () => app.showChain(button.dataset['show']!));
  }
}

function rawRow(app: App, raw: RawInput, isManual: boolean): string {
  const rate = raw.unused ? '<span class="muted">not needed</span>' : formatRate(raw.rate, raw.fluid);
  const actions = isManual ? manualActions(app, raw.item) : choiceControl(app, raw.item);

  return `
    <div class="io-item${isManual ? ' manual' : ''}">
      ${itemDot(raw.item, raw.fluid)}
      <span class="name" title="${escapeHtml(raw.item)}">${itemNameHtml(raw.item)}</span>
      <span class="rate">${rate}</span>
      ${actions}
    </div>`;
}

/** For an item you supply: a way to start crafting it again, or just to stop supplying it. */
function manualActions(app: App, item: ItemKey): string {
  const craftable = app.store.producersOf(item).length > 0;
  return `<div class="act">
    <span class="tagline">${craftable ? 'chain hidden' : 'supplied'}</span>
    <button class="link-btn" data-show="${escapeHtml(item)}" title="Craft this in the plan again">${
      craftable ? 'Show chain' : 'Remove'
    }</button>
  </div>`;
}

function renderByproducts(app: App): void {
  const container = need('#surplusList');
  const surplus = app.store.solution.surplus;

  container.innerHTML = surplus.length
    ? surplus.map(byproductRow).join('')
    : '<div class="io-empty">None</div>';
}

function byproductRow(byproduct: Byproduct): string {
  return `
    <div class="io-item">
      ${itemDot(byproduct.item, byproduct.fluid)}
      <span class="name" title="${escapeHtml(byproduct.item)}">${itemNameHtml(byproduct.item)}</span>
      <span class="rate">${formatRate(byproduct.rate, byproduct.fluid)}</span>
    </div>`;
}

function renderWarnings(app: App): void {
  const warnings = app.store.solution.warnings;
  need('#warnPanel').hidden = !warnings.length;
  need('#warnList').innerHTML = warnings.map((w) => `<li>${escapeHtml(w)}</li>`).join('');
}

/** Wire the controls that do not get re-rendered. */
export function wireSidebar(app: App): void {
  need<HTMLSelectElement>('#defaultTier').addEventListener('change', (event) => {
    app.store.project.defaultTier = Number((event.target as HTMLSelectElement).value);
    app.update();
  });
  need<HTMLSelectElement>('#defaultCoil').addEventListener('change', (event) => {
    app.store.project.defaultCoil = Number((event.target as HTMLSelectElement).value);
    app.update();
  });
  need<HTMLSelectElement>('#gridTier').addEventListener('change', (event) => {
    app.store.project.gridTier = Number((event.target as HTMLSelectElement).value);
    app.update();
  });
  need<HTMLInputElement>('#autoExpand').addEventListener('change', (event) => {
    app.store.project.autoExpand = (event.target as HTMLInputElement).checked;
    app.update();
  });
  need<HTMLInputElement>('#autoPerfectTier').addEventListener('change', (event) => {
    app.store.project.autoPerfectTier = (event.target as HTMLInputElement).checked;
    app.update();
  });

  const fluidUnits = need<HTMLSelectElement>('#fluidUnits');
  fluidUnits.value = app.store.state.fluidUnits ?? 'auto';
  fluidUnits.addEventListener('change', (event) => {
    app.store.setFluidUnits((event.target as HTMLSelectElement).value as 'auto' | 'mb');
    app.renderStatic();
    app.update();
  });

  need<HTMLFormElement>('#rawAddForm').addEventListener('submit', (event) => {
    event.preventDefault();
    const input = need<HTMLInputElement>('#rawAddInput');
    app.supplyAsRaw(input.value);
    input.value = '';
  });
}
