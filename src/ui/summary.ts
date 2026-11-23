/** The row of headline numbers above the tabs. */
import { formatEut, formatNumber } from '../core/format';
import { ampsLabel } from '../core/power';
import { tier as tierAt } from '../data/tiers';
import type { App } from './app';
import { need } from './dom';

interface Stat {
  /** CSS custom property driving the card's accent colour. */
  color: string;
  label: string;
  value: string;
  sub: string;
  title?: string;
}

export function renderSummary(app: App): void {
  need('#summary').innerHTML = stats(app).map(card).join('');
}

function stats(app: App): Stat[] {
  const solution = app.store.solution;
  const totals = solution.totals;
  const grid = app.store.project.gridTier;
  const steps = solution.steps.length;

  // Headroom is a ratio (1 = no slack), shown as the percentage you could still grow by.
  const spare = steps ? Math.max(0, totals.headroom - 1) : 0;

  return [
    {
      color: 'var(--accent)',
      label: 'Average power',
      value: formatEut(totals.avgEut),
      sub: ampsLabel(totals.avgEut, grid),
    },
    {
      color: 'var(--accent-2)',
      label: 'Peak power',
      value: formatEut(totals.peakEut),
      sub: `${ampsLabel(totals.peakEut, grid)} · all machines on`,
    },
    {
      color: 'var(--good)',
      label: 'Machines to build',
      value: String(totals.machines),
      sub: `${steps} recipe step${steps === 1 ? '' : 's'}${
        steps ? ` · up to ${tierAt(totals.maxTier).name}` : ''
      }`,
    },
    {
      color: 'var(--raw)',
      label: 'Raw inputs',
      value: String(solution.raw.length),
      sub: `${solution.surplus.length} byproduct${solution.surplus.length === 1 ? '' : 's'}`,
    },
    {
      color: 'var(--sur)',
      label: 'Spare capacity',
      value: `+${formatNumber(spare * 100, 0)}%`,
      sub: 'before the first step maxes out',
      title:
        'How much you could raise every target before any built machine group runs at 100%',
    },
  ];
}

function card(stat: Stat): string {
  const title = stat.title ? ` title="${stat.title}"` : '';
  return `
    <div class="stat" style="--c:${stat.color}">
      <div class="label">${stat.label}</div>
      <div class="value">${stat.value}</div>
      <div class="sub"${title}>${stat.sub}</div>
    </div>`;
}
