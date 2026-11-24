<script lang="ts">
  import { useApp } from '../state/context';
  import { formatEut, formatNumber, plural } from '../core/format';
  import { ampsLabel } from '../core/power';
  import { tier as tierAt } from '../data/tiers';
  const app = useApp();
  const stats = $derived([
    [
      'Average power',
      formatEut(app.solution.totals.avgEut),
      ampsLabel(app.solution.totals.avgEut, app.project.gridTier),
      'var(--accent)',
    ],
    [
      'Peak power',
      formatEut(app.solution.totals.peakEut),
      `${ampsLabel(app.solution.totals.peakEut, app.project.gridTier)} · all machines on`,
      'var(--accent-2)',
    ],
    [
      'Machines to build',
      String(app.solution.totals.machines),
      `${plural(app.solution.steps.length, 'recipe step')}${app.solution.steps.length ? ` · up to ${tierAt(app.solution.totals.maxTier).name}` : ''}`,
      'var(--good)',
    ],
    [
      'Raw inputs',
      String(app.solution.raw.length),
      plural(app.solution.surplus.length, 'byproduct'),
      'var(--raw)',
    ],
    [
      'Spare capacity',
      `+${formatNumber(app.solution.steps.length ? Math.max(0, app.solution.totals.headroom - 1) * 100 : 0, 0)}%`,
      'before the first step maxes out',
      'var(--sur)',
    ],
  ]);
</script>

<div
  class="summary"
  aria-label="Plan summary"
>
  {#each stats as [label, value, sub, color]}
    <div
      class="stat"
      style:--stat-color={color}
    >
      <div class="stat-label">{label}</div>
      <div class="stat-value">{value}</div>
      <div class="stat-sub">{sub}</div>
    </div>
  {/each}
</div>
