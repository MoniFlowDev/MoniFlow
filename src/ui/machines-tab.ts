/**
 * The machines tab: a shopping list of what to build, and a row per step with its numbers.
 *
 * The build list groups by tier and machine, because that is how you actually build: twelve LV
 * macerators, not twelve separate steps that each happen to use one.
 */
import { formatNumber, formatRate } from '../core/format';
import { escapeHtml } from '../core/html';
import { itemName } from '../core/item-names';
import type { Recipe } from '../core/types';
import { stepTitleHtml } from '../solver/step-title';
import type { SolvedStep } from '../solver/solve';
import type { App } from './app';
import { machineIcon, tierBadge } from './badges';
import { all, need } from './dom';

/** Utilisation thresholds for the bar colour. */
const BUSY = 0.85;
const HALF_BUSY = 0.5;

interface BuildGroup {
  tier: number;
  machine: string;
  /** A representative recipe, only for its machine icon. */
  recipe: Recipe;
  count: number;
}

export function renderMachines(app: App): void {
  const view = need('#machinesView');
  const solution = app.store.solution;

  if (!solution.steps.length) {
    view.innerHTML = '<p class="muted">No machines yet — add a target.</p>';
    return;
  }

  view.innerHTML = `
    <div class="section-title"><h3>Build list</h3><span class="hint">Machines rounded up, grouped by tier</span></div>
    <div class="build-list">${groupForBuilding(solution.steps).map(buildCard).join('')}</div>
    <div class="section-title"><h3>Every step</h3><span class="hint">Click a row for details and tier comparison</span></div>
    ${stepTable(solution.steps, solution.totals)}`;

  for (const row of all<HTMLTableRowElement>('tr[data-id]', view)) {
    row.addEventListener('click', () => app.selectById(row.dataset['id']!));
  }
}

function groupForBuilding(steps: readonly SolvedStep[]): BuildGroup[] {
  const groups = new Map<string, BuildGroup>();

  for (const step of steps) {
    if (step.instant) continue; // nothing to build for a crafting-table recipe
    const key = `${step.settings.tier}|${step.recipe.machine}`;
    const group = groups.get(key) ?? {
      tier: step.settings.tier,
      machine: step.recipe.machine,
      recipe: step.recipe,
      count: 0,
    };
    group.count += step.built;
    groups.set(key, group);
  }

  return [...groups.values()].sort((a, b) => b.tier - a.tier || b.count - a.count);
}

function buildCard(group: BuildGroup): string {
  return `
    <div class="build-card">
      <div class="count">${group.count}×</div>
      ${machineIcon(group.recipe, group.tier, 28)}
      <div>${tierBadge(group.tier)} <span>${escapeHtml(group.machine)}</span></div>
    </div>`;
}

function stepTable(
  steps: readonly SolvedStep[],
  totals: { machines: number; avgEut: number; peakEut: number },
): string {
  return `
    <div class="table-wrap"><table>
      <thead><tr>
        <th>Tier</th><th>Machine</th><th>Recipe</th>
        <th class="r">Needed</th><th class="r">Build</th><th>Utilization</th>
        <th class="r">Craft time</th><th class="r">EU/t each</th>
        <th class="r">Avg EU/t</th><th class="r">Peak EU/t</th><th>Notes</th>
      </tr></thead>
      <tbody>${steps.map(stepRow).join('')}</tbody>
      <tfoot><tr>
        <td colspan="4"><b>Total</b></td>
        <td class="r num"><b>${totals.machines}</b></td>
        <td colspan="3"></td>
        <td class="r num"><b>${formatNumber(totals.avgEut)}</b></td>
        <td class="r num"><b>${formatNumber(totals.peakEut)}</b></td>
        <td></td>
      </tr></tfoot>
    </table></div>`;
}

function stepRow(step: SolvedStep): string {
  const busy = step.utilization;
  const barColor =
    busy > BUSY ? 'var(--good)' : busy > HALF_BUSY ? 'var(--warn)' : 'var(--accent-2)';

  const spare = step.spareOutputs.length
    ? ` <span class="spare-tag" title="Also makes: ${escapeHtml(
        step.spareOutputs.map(itemName).join(', '),
      )}">+${step.spareOutputs.length}</span>`
    : '';

  const notes = step.oc.errors.length
    ? `<span class="bad">${escapeHtml(step.oc.errors[0]!)}</span>`
    : escapeHtml(step.oc.notes.join(' · '));

  return `
    <tr class="clickable" data-id="${escapeHtml(step.id)}">
      <td>${step.instant ? '<span class="muted">—</span>' : tierBadge(step.settings.tier)}</td>
      <td>${machineIcon(step.recipe, step.instant ? null : step.settings.tier, 16)}${escapeHtml(step.recipe.machine)}</td>
      <td>${stepTitleHtml(step)}${spare}</td>
      <td class="r num">${
        step.instant
          ? `<span class="muted">${formatRate(step.rate)}</span>`
          : formatNumber(step.machines, 2)
      }</td>
      <td class="r num"><b>${step.instant ? '—' : step.built}</b></td>
      <td>
        <span class="util"><i style="width:${Math.round(busy * 100)}%;background:${barColor}"></i></span>
        <span class="num muted">${Math.round(busy * 100)}%</span>
      </td>
      <td class="r num">${step.oc.dur}t</td>
      <td class="r num">${formatNumber(step.oc.eut)}</td>
      <td class="r num">${formatNumber(step.avgEut)}</td>
      <td class="r num">${formatNumber(step.peakEut)}</td>
      <td class="note">${notes}</td>
    </tr>`;
}
