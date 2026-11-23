/**
 * The side panel for one step: everything the node could not fit, and the controls that change it.
 *
 * The tier comparison table at the bottom is the point of this panel. Under standard overclocking
 * a higher tier costs the same energy per item but doubles the power per machine, so it buys fewer
 * machines at a higher instantaneous draw; under perfect overclocking it genuinely gets cheaper.
 * Seeing both columns side by side is how you decide.
 */
import { COILS } from '../../data/coils';
import { tier as tierAt, tierForEut } from '../../data/tiers';
import { formatDuration, formatEut, formatNumber, formatRate } from '../../core/format';
import { escapeHtml } from '../../core/html';
import { itemNameHtml } from '../../core/item-names';
import { expectedAmount } from '../../core/recipe';
import type { OverclockMode, RecipeIO } from '../../core/types';
import { stepTitleHtml } from '../../solver/step-title';
import type { SolvedStep } from '../../solver/solve';
import { tierComparison, type TierOption } from '../../solver/tier-comparison';
import type { App } from '../app';
import { itemDot, machineIcon, tierBadge, tierOptions } from '../badges';
import { bindChoiceControls, choiceControl } from '../choice-control';
import { all } from '../dom';

const OVERCLOCK_LABELS: Record<OverclockMode, string> = {
  standard: 'Standard (×4 EU, ÷2 time)',
  perfect: 'Perfect (×4 EU, ÷4 time)',
  none: 'No overclocking',
};

export function stepDrawerHtml(app: App, step: SolvedStep): string {
  return step.instant ? instantDrawer(app, step) : poweredDrawer(app, step);
}

/* ------------------------------ instant recipes ------------------------------ */

/** A crafting-table style step: no machine, no power, just a rate to keep up with. */
function instantDrawer(app: App, step: SolvedStep): string {
  const recipe = step.recipe;
  return `
    <h2 class="d-title">${stepTitleHtml(step)}</h2>
    <div class="d-sub">${escapeHtml(recipe.machine)} · instant recipe${gameRecipeNote(step)}</div>
    ${spareNote(step)}
    <dl class="kv"><dt>Crafts needed</dt><dd>${formatRate(step.rate)}</dd><dt>Power</dt><dd>none</dd></dl>
    <p class="hint">No processing time, so there is no machine count. Use an autocrafter (or craft by hand) at this rate.</p>
    <div class="d-section"><h3>Inputs</h3>${ioList(app, step, recipe.inputs, true)}</div>
    <div class="d-section"><h3>Outputs</h3>${ioList(app, step, recipe.outputs, false)}</div>
    ${actions(step, { reset: false })}`;
}

/* ------------------------------ powered recipes ------------------------------ */

function poweredDrawer(app: App, step: SolvedStep): string {
  const { recipe, settings, oc } = step;
  const minTier = Math.max(1, tierForEut(recipe.eut));

  return `
    <h2 class="d-title">${stepTitleHtml(step)}</h2>
    <div class="d-sub">${subtitle(step)}</div>
    ${spareNote(step)}

    <div class="big-machines">
      <div><div class="l">Needed</div><div class="n">${formatNumber(step.machines, 2)}</div></div>
      <div><div class="l">Build</div><div class="n" style="color:var(--accent)">${step.built}</div></div>
      <div><div class="l">Utilization</div><div class="n">${Math.round(step.utilization * 100)}%</div></div>
    </div>

    <div class="d-section">
      <h3>Machine setup</h3>
      <div class="field-grid">
        <label>Tier<select id="dTier">${tierOptions(settings.tier, Math.min(minTier, settings.tier))}</select></label>
        <label>Overclock<select id="dOc">${overclockOptions(settings.ocMode)}</select></label>
        ${step.useCoil ? `<label>Coils<select id="dCoil">${coilSelectOptions(settings.coil)}</select></label>` : ''}
        <label>Parallel<input id="dPar" type="number" min="1" step="1" value="${settings.parallel}"></label>
      </div>
      <ul class="oc-notes">${setupNotes(app, step)}</ul>
    </div>

    <div class="d-section">
      <h3>Per machine</h3>
      <dl class="kv">
        <dt>Time per craft</dt><dd>${oc.dur} t (${formatDuration(oc.dur)})</dd>
        <dt>Power draw</dt><dd>${formatEut(oc.eut)}</dd>
        <dt>Amperage</dt><dd>${formatNumber(step.amps, 2)}A @ ${tierAt(settings.tier).name}</dd>
        <dt>Crafts</dt><dd>${formatRate(oc.craftsPerSec)}</dd>
        <dt>Energy per craft</dt><dd>${formatNumber(oc.euPerCraft)} EU</dd>
      </dl>
    </div>

    <div class="d-section">
      <h3>This step in total</h3>
      <dl class="kv">
        <dt>Crafts needed</dt><dd>${formatRate(step.rate)}</dd>
        <dt>Average power</dt><dd>${formatEut(step.avgEut)}</dd>
        <dt>Peak (${step.built} running)</dt><dd>${formatEut(step.peakEut)}</dd>
      </dl>
    </div>

    <div class="d-section"><h3>Inputs</h3>${ioList(app, step, recipe.inputs, true)}</div>
    <div class="d-section"><h3>Outputs</h3>${ioList(app, step, recipe.outputs, false)}</div>

    <div class="d-section">
      <h3>Compare tiers</h3>
      ${comparisonTable(tierComparison(step), settings.tier)}
      <p class="hint">Standard overclocks keep the same EU per item but double the power per machine; perfect overclocks make each item cheaper. Click a row to switch.</p>
    </div>

    ${actions(step, { reset: true })}`;
}

function subtitle(step: SolvedStep): string {
  const { recipe, settings } = step;
  const parts = [
    `${tierBadge(settings.tier)} ${machineIcon(recipe, settings.tier, 16)}${escapeHtml(recipe.machine)}`,
    `base ${formatEut(recipe.eut)} (${tierAt(tierForEut(recipe.eut)).name})`,
    formatDuration(recipe.duration),
  ];
  if (recipe.temp) parts.push(`${formatNumber(recipe.temp)}K`);
  if (recipe.cond) parts.push(`<span class="cond">${escapeHtml(recipe.cond)}</span>`);
  if (recipe.src === 'game') parts.push('<span class="muted">game recipe</span>');
  return parts.join(' · ');
}

function gameRecipeNote(step: SolvedStep): string {
  return step.recipe.src === 'game' ? ' · <span class="muted">game recipe</span>' : '';
}

/** "Also makes …" for a step with outputs the plan does not use. */
function spareNote(step: SolvedStep): string {
  if (!step.spareOutputs.length) return '';
  const names = step.spareOutputs.map(itemNameHtml).join(', ');
  return `<div class="spare-note">Also makes ${names} <span class="muted">(not used in this plan)</span></div>`;
}

function overclockOptions(selected: OverclockMode): string {
  return (Object.keys(OVERCLOCK_LABELS) as OverclockMode[])
    .map(
      (mode) =>
        `<option value="${mode}" ${mode === selected ? 'selected' : ''}>${OVERCLOCK_LABELS[mode]}</option>`,
    )
    .join('');
}

function coilSelectOptions(selected: number): string {
  return COILS.map(
    (coil, i) =>
      `<option value="${i}" ${i === selected ? 'selected' : ''}>${coil.name} (${formatNumber(coil.temp)}K)</option>`,
  ).join('');
}

function setupNotes(app: App, step: SolvedStep): string {
  const { settings, oc, recipe } = step;
  const notes: string[] = [];

  if (settings.autoTier) {
    const gridName = tierAt(app.store.project.gridTier).name;
    notes.push(
      `<li class="auto-note">Tier picked automatically: perfect overclocking gives the same energy ` +
        `per item at any tier, and ${tierAt(settings.tier).name} needs the fewest machines (up to ` +
        `your ${gridName} grid). Choose a tier to override it.</li>`,
    );
  }
  for (const error of oc.errors) notes.push(`<li class="err">${escapeHtml(error)}</li>`);
  for (const note of oc.notes) notes.push(`<li>${escapeHtml(note)}</li>`);
  if (step.useCoil && oc.effTemp) {
    notes.push(
      `<li>Effective coil heat ${formatNumber(oc.effTemp)}K (recipe needs ${formatNumber(recipe.temp!)}K)</li>`,
    );
  }
  return notes.join('');
}

function comparisonTable(options: readonly TierOption[], current: number): string {
  const rows = options
    .map(
      (option) => `
      <tr class="clickable ${option.tier === current ? 'cur' : ''}" data-tier="${option.tier}">
        <td>${tierBadge(option.tier)}</td>
        <td class="r num">${formatNumber(option.machines, 2)} <span class="muted">(${option.built})</span></td>
        <td class="r num">${option.oc.dur}t</td>
        <td class="r num">${formatNumber(option.oc.eut)}</td>
        <td class="r num">${formatNumber(option.avgEut)}</td>
      </tr>`,
    )
    .join('');

  return `
    <div class="table-wrap"><table class="cmp">
      <thead><tr>
        <th>Tier</th><th class="r">Machines</th><th class="r">Time</th>
        <th class="r">EU/t each</th><th class="r">Avg EU/t</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table></div>`;
}

/* ------------------------------ shared pieces ------------------------------ */

function ioList(
  app: App,
  step: SolvedStep,
  list: readonly RecipeIO[],
  isInput: boolean,
): string {
  if (!list.length) return '<div class="io-empty">None</div>';
  return list.map((io) => ioRow(app, step, io, isInput)).join('');
}

function ioRow(app: App, step: SolvedStep, io: RecipeIO, isInput: boolean): string {
  const amount = isInput ? Number(io.amount) || 0 : expectedAmount(io);
  const notes: string[] = [];

  if (io.uses) {
    notes.push(
      ` <span class="muted" title="Tool: one use per craft">(tool, ${io.uses.toLocaleString()} uses)</span>`,
    );
  }
  if (io.kept) notes.push(' <span class="muted">(kept)</span>');
  if (io.returned) notes.push(' <span class="muted">(returned)</span>');
  if (!isInput && io.chance != null && Number(io.chance) !== 100) {
    notes.push(` <span class="muted">(${io.chance}%)</span>`);
  }

  return `
    <div class="choice-row">
      ${itemDot(io.item, !!io.fluid)}
      <div style="display:flex;justify-content:space-between;gap:8px">
        <span title="${escapeHtml(io.item)}">${itemNameHtml(io.item)}${notes.join('')}</span>
        <span class="rate">${formatRate(amount * step.rate, io.fluid)}</span>
      </div>
      ${isInput ? choiceControl(app, io.item) : ''}
    </div>`;
}

function actions(step: SolvedStep, options: { reset: boolean }): string {
  const editLabel = step.recipe.src === 'game' ? 'Copy &amp; edit' : 'Edit recipe';
  return `
    <div class="d-section" style="display:flex;gap:8px;flex-wrap:wrap">
      <button class="btn small primary" id="dChange">Change recipe…</button>
      <button class="btn small" id="dEdit">${editLabel}</button>
      ${options.reset ? '<button class="btn small" id="dReset">Reset machine setup</button>' : ''}
      <button class="btn small danger" id="dRemove" title="Supply this step's product yourself and hide everything that feeds it">Hide this chain (supply as raw)</button>
    </div>`;
}

/* ------------------------------ wiring ------------------------------ */

export function bindStepDrawer(app: App, body: HTMLElement, step: SolvedStep): void {
  const project = app.store.project;
  const override = (key: string, value: unknown): void => {
    project.nodes[step.id] = { ...project.nodes[step.id], [key]: value };
    app.update();
  };

  const select = <T extends HTMLElement>(selector: string): T | null =>
    body.querySelector<T>(selector);

  select<HTMLSelectElement>('#dTier')?.addEventListener('change', (event) => {
    override('tier', Number((event.target as HTMLSelectElement).value));
  });
  select<HTMLSelectElement>('#dOc')?.addEventListener('change', (event) => {
    override('ocMode', (event.target as HTMLSelectElement).value);
  });
  select<HTMLSelectElement>('#dCoil')?.addEventListener('change', (event) => {
    override('coil', Number((event.target as HTMLSelectElement).value));
  });
  select<HTMLInputElement>('#dPar')?.addEventListener('change', (event) => {
    const value = Number((event.target as HTMLInputElement).value);
    override('parallel', Math.max(1, Math.floor(value || 1)));
  });

  for (const row of all<HTMLTableRowElement>('tr[data-tier]', body)) {
    row.addEventListener('click', () => override('tier', Number(row.dataset['tier'])));
  }

  select<HTMLButtonElement>('#dEdit')?.addEventListener('click', () => app.editOrCopy(step.recipe));
  select<HTMLButtonElement>('#dChange')?.addEventListener('click', () => {
    app.openPicker(productOf(app, step));
  });
  select<HTMLButtonElement>('#dReset')?.addEventListener('click', () => {
    delete project.nodes[step.id];
    app.update();
  });
  select<HTMLButtonElement>('#dRemove')?.addEventListener('click', () => app.hideChain(step.id));

  bindChoiceControls(app, body);
}

/**
 * Which of a step's outputs to open the picker for: the one this step was actually chosen to
 * make, falling back to its first output.
 */
function productOf(app: App, step: SolvedStep): string {
  const chosenFor = step.recipe.outputs
    .map((output) => output.item)
    .find((item) => app.store.currentChoice(item) === step.id);
  return chosenFor ?? step.recipe.outputs[0]!.item;
}
