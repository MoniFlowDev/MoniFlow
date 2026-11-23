/**
 * The power tab: where the EU goes, what the grid has to carry, and how many generators that is.
 *
 * Two numbers matter and they are easy to confuse. Average draw is what the line consumes over
 * time, which is what generation has to match. Peak draw is every built machine running at once,
 * which is what the cables and the grid tier have to survive. The gap between them is what a
 * battery buffer is for.
 */
import { GENERATOR_PRESETS } from '../data/generators';
import { TIERS, tier as tierAt } from '../data/tiers';
import { formatEut, formatNumber } from '../core/format';
import { escapeHtml } from '../core/html';
import { itemNameHtml } from '../core/item-names';
import { ampsLabel } from '../core/power';
import { EPSILON, TICKS_PER_SECOND } from '../core/units';
import { stepTitle, stepTitleHtml } from '../solver/step-title';
import type { SolutionTotals, SolvedStep } from '../solver/solve';
import type { App } from './app';
import { tierBadge } from './badges';
import { all, need } from './dom';

/** Ticks in an hour, for the energy-per-hour figure. */
const TICKS_PER_HOUR = TICKS_PER_SECOND * 3600;
/** Ticks in a minute, for the buffer suggestion. */
const TICKS_PER_MINUTE = TICKS_PER_SECOND * 60;
const MB_PER_BUCKET = 1000;

interface TierUsage {
  avg: number;
  peak: number;
  machines: number;
}

export function renderPower(app: App): void {
  const view = need('#powerView');
  const { store } = app;
  const solution = store.solution;

  if (!solution.steps.length) {
    view.innerHTML = '<p class="muted">No power use yet — add a target.</p>';
    return;
  }

  const powered = solution.steps.filter((step) => !step.instant);
  const generator = currentGenerator(app);

  view.innerHTML = `
    <div class="power-grid">
      <div class="card-box">
        <h3>Power by step</h3>
        <p class="hint" style="margin:-4px 0 10px">Bar = average draw, dashed line = peak with every built machine running.</p>
        ${stepBars(powered)}
        <div class="section-title"><h3>By voltage tier</h3></div>
        ${tierTable(powered)}
      </div>
      <div style="display:flex;flex-direction:column;gap:12px">
        ${totalsCard(app, solution.totals)}
        ${generatorCard(solution.totals, generator)}
      </div>
    </div>`;

  for (const row of all<HTMLElement>('.bar-row[data-id]', view)) {
    row.addEventListener('click', () => app.selectById(row.dataset['id']!));
  }
  wireGeneratorControls(app, view, generator);
}

/* ------------------------------ per step ------------------------------ */

function stepBars(powered: readonly SolvedStep[]): string {
  // Everything is scaled against the single biggest peak, so the bars are comparable.
  const scale = Math.max(...powered.map((step) => step.peakEut), 1);

  return powered
    .map((step) => {
      const tier = tierAt(step.settings.tier);
      return `
      <div class="bar-row clickable" data-id="${escapeHtml(step.id)}" style="cursor:pointer">
        <div class="bl" title="${escapeHtml(stepTitle(step))}">${tierBadge(step.settings.tier)} ${stepTitleHtml(step)}</div>
        <div class="bar-track">
          <div class="bar-fill" style="width:${percent(step.avgEut, scale)};background:${tier.color};opacity:.85"></div>
          <div class="bar-peak" style="width:${percent(step.peakEut, scale)}"></div>
        </div>
        <div class="bv">${formatNumber(step.avgEut)}</div>
      </div>`;
    })
    .join('');
}

function percent(value: number, of: number): string {
  return `${((value / of) * 100).toFixed(2)}%`;
}

function tierTable(powered: readonly SolvedStep[]): string {
  const byTier = new Map<number, TierUsage>();
  for (const step of powered) {
    const usage = byTier.get(step.settings.tier) ?? { avg: 0, peak: 0, machines: 0 };
    usage.avg += step.avgEut;
    usage.peak += step.peakEut;
    usage.machines += step.built;
    byTier.set(step.settings.tier, usage);
  }

  const rows = [...byTier.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(
      ([tier, usage]) => `
      <tr>
        <td>${tierBadge(tier)}</td>
        <td class="r num">${usage.machines}</td>
        <td class="r num">${formatNumber(usage.avg)}</td>
        <td class="r num">${formatNumber(usage.peak)}</td>
        <td class="r num">${formatNumber(usage.peak / TIERS[tier]!.v, 2)}A</td>
      </tr>`,
    )
    .join('');

  return `
    <div class="table-wrap"><table>
      <thead><tr>
        <th>Tier</th><th class="r">Machines</th><th class="r">Avg EU/t</th>
        <th class="r">Peak EU/t</th><th class="r">Peak amps @ tier</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table></div>`;
}

/* ------------------------------ totals ------------------------------ */

function totalsCard(app: App, totals: SolutionTotals): string {
  const { store } = app;
  const grid = store.project.gridTier;
  const gridName = tierAt(grid).name;
  const targets = store.solution.targets;

  // Energy per item only makes sense with a single target to divide by.
  const only = targets.length === 1 ? targets[0]! : null;
  const onlyIsFluid = only ? store.isFluid(only.item) : false;
  const perUnit = only
    ? (totals.avgEut * TICKS_PER_SECOND) / only.rate * (onlyIsFluid ? MB_PER_BUCKET : 1)
    : 0;

  const aboveGrid =
    totals.maxTier > grid
      ? `<p class="hint bad" style="margin-top:10px">Some machines are above your grid tier (${gridName}); they need a transformer up or a higher-tier line.</p>`
      : '';

  return `
    <div class="card-box">
      <h3>Totals</h3>
      <dl class="kv">
        <dt>Average draw</dt><dd>${formatEut(totals.avgEut)}</dd>
        <dt>Peak draw</dt><dd>${formatEut(totals.peakEut)}</dd>
        <dt>Average @ grid (${gridName})</dt><dd>${ampsLabel(totals.avgEut, grid)}</dd>
        <dt>Peak @ grid (${gridName})</dt><dd>${ampsLabel(totals.peakEut, grid)}</dd>
        <dt>Highest machine tier</dt><dd>${tierAt(totals.maxTier).name}</dd>
        <dt>Energy per hour</dt><dd>${formatNumber(totals.avgEut * TICKS_PER_HOUR)} EU</dd>
        ${
          only
            ? `<dt>Energy per ${onlyIsFluid ? 'bucket' : 'item'} of ${itemNameHtml(only.item)}</dt>` +
              `<dd>${formatNumber(perUnit)} EU</dd>`
            : ''
        }
      </dl>
      ${aboveGrid}
      <p class="hint" style="margin-top:10px">Wire for peak: at ${gridName} you need cables rated for <b>${Math.ceil(
        totals.peakEut / TIERS[grid]!.v,
      )}A</b> (before cable loss).</p>
    </div>`;
}

/* ------------------------------ generators ------------------------------ */

interface GeneratorChoice {
  presetIndex: number;
  /** EU/t per generator: the preset's value, or your own for "Custom…". */
  eut: number;
  /** The preset has a fixed output, so the number field is read-only. */
  fixed: boolean;
}

function currentGenerator(app: App): GeneratorChoice {
  const stored = app.store.project.gen ?? { preset: 0, eut: 32 };
  const preset = GENERATOR_PRESETS[stored.preset] ?? GENERATOR_PRESETS[0]!;
  return {
    presetIndex: stored.preset,
    eut: preset.eut || stored.eut || 0,
    fixed: preset.eut > 0,
  };
}

function generatorCard(totals: SolutionTotals, generator: GeneratorChoice): string {
  const countFor = (draw: number): string =>
    generator.eut ? String(Math.ceil(draw / generator.eut - EPSILON)) : '—';

  const options = GENERATOR_PRESETS.map(
    (preset, i) =>
      `<option value="${i}" ${i === generator.presetIndex ? 'selected' : ''}>${escapeHtml(preset.name)}${
        preset.eut ? ` — ${formatNumber(preset.eut)} EU/t` : ''
      }</option>`,
  ).join('');

  const buffer = (totals.peakEut - totals.avgEut) * TICKS_PER_MINUTE;

  return `
    <div class="card-box">
      <h3>Generators needed</h3>
      <div class="gen-row">
        <select id="genPreset">${options}</select>
        <input id="genEut" type="number" min="1" step="any" value="${generator.eut}" ${
          generator.fixed ? 'disabled' : ''
        } title="EU/t per generator">
      </div>
      <div class="big-answer">
        <div>
          <div class="hint">For average draw</div>
          <div class="n">${countFor(totals.avgEut)}</div>
          <div class="hint">with a battery buffer</div>
        </div>
        <div>
          <div class="hint">For peak draw</div>
          <div class="n">${countFor(totals.peakEut)}</div>
          <div class="hint">no buffer needed</div>
        </div>
      </div>
      <p class="hint" style="margin-top:10px">To ride out a full minute at peak with only average-rated generation, store about <b>${formatNumber(
        buffer,
      )} EU</b>. Turbine output depends on rotor and fuel — use Custom for exact numbers.</p>
    </div>`;
}

function wireGeneratorControls(app: App, view: HTMLElement, generator: GeneratorChoice): void {
  view.querySelector<HTMLSelectElement>('#genPreset')!.addEventListener('change', (event) => {
    const index = Number((event.target as HTMLSelectElement).value);
    app.store.project.gen = {
      preset: index,
      // Keep your custom figure when switching to "Custom…".
      eut: GENERATOR_PRESETS[index]!.eut || generator.eut || 32,
    };
    app.update();
  });

  view.querySelector<HTMLInputElement>('#genEut')!.addEventListener('change', (event) => {
    const value = Number((event.target as HTMLInputElement).value);
    app.store.project.gen = {
      preset: generator.presetIndex,
      eut: Math.max(1, value || 1),
    };
    app.update();
  });
}
