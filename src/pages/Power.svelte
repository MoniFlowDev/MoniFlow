<script lang="ts">
  import { useApp } from '../state/context';
  import { GENERATOR_PRESETS } from '../data/generators';
  import { TIERS, tier as tierAt } from '../data/tiers';
  import { formatEut, formatNumber } from '../core/format';
  import { ampsLabel } from '../core/power';
  import { stepTitle } from '../solver/step-title';
  import TierBadge from '../components/TierBadge.svelte';
  import ItemName from '../components/ItemName.svelte';
  const app = useApp();
  const totals = $derived(app.solution.totals);
  const powered = $derived(app.solution.steps.filter((s) => !s.instant));
  const scale = $derived(Math.max(...powered.map((s) => s.peakEut), 1));
  const byTier = $derived.by(() => {
    const result = new Map<number, { avg: number; peak: number; machines: number }>();
    for (const step of powered) {
      const group = result.get(step.settings.tier) ?? {
        avg: 0,
        peak: 0,
        machines: 0,
      };
      group.avg += step.avgEut;
      group.peak += step.peakEut;
      group.machines += step.built;
      result.set(step.settings.tier, group);
    }
    return [...result].sort((a, b) => a[0] - b[0]);
  });
  const preset = $derived(GENERATOR_PRESETS[app.project.gen.preset] ?? GENERATOR_PRESETS[0]!);
  const generatorEut = $derived(preset.eut || app.project.gen.eut || 0);
  const only = $derived(app.solution.targets.length === 1 ? app.solution.targets[0] : null);
  const grid = $derived(app.project.gridTier);
  const count = (draw: number) => (generatorEut ? Math.ceil(draw / generatorEut - 1e-9) : '—');
</script>

<svelte:head><title>Power · MoniFlow</title></svelte:head>
<div>
  {#if !app.solution.steps.length}
    <p class="text-muted">No power use yet — add a target.</p>
  {:else}
    <div class="grid gap-3 xl:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
      <section class="card-box">
        <h3>Power by step</h3>
        <p class="hint -mt-1 mb-[10px]">
          Bar = average draw, dashed line = peak with every built machine running.
        </p>
        {#each powered as step (step.id)}
          <button
            class="bar-row"
            onclick={() => app.selectById(step.id)}
          >
            <span class="truncate">
              <TierBadge tier={step.settings.tier} />
              <ItemName text={stepTitle(step, true)} />
            </span>
            <span class="relative block h-4 overflow-hidden rounded bg-surface">
              <span
                class="absolute inset-y-0 left-0 rounded opacity-85"
                style:width="{(step.avgEut / scale) * 100}%"
                style:background={tierAt(step.settings.tier).color}
              ></span><span
                class="absolute inset-y-0 left-0 border-r-2 border-dashed border-white/33"
                style:width="{(step.peakEut / scale) * 100}%"
              ></span>
            </span>
            <span class="text-right font-mono text-xs">
              {formatNumber(step.avgEut)}
            </span>
          </button>
        {/each}
        <div class="section-title"><h3>By voltage tier</h3></div>
        <div class="table-wrap">
          <table
            class="[&_th:not(:first-child)]:text-right [&_td:not(:first-child)]:text-right [&_td:not(:first-child)]:font-mono"
          >
            <thead>
              <tr>
                <th>Tier</th>
                <th>Machines</th>
                <th>Avg EU/t</th>
                <th>Peak EU/t</th>
                <th>Peak amps @ tier</th>
              </tr>
            </thead>
            <tbody>
              {#each byTier as [tier, usage]}
                <tr>
                  <td><TierBadge {tier} /></td>
                  <td>{usage.machines}</td>
                  <td>
                    {formatNumber(usage.avg)}
                  </td>
                  <td>{formatNumber(usage.peak)}</td>
                  <td>{formatNumber(usage.peak / TIERS[tier]!.v, 2)}A</td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
      </section>
      <div class="space-y-3">
        <section class="card-box">
          <h3>Totals</h3>
          <dl class="kv">
            <dt>Average draw</dt>
            <dd>{formatEut(totals.avgEut)}</dd>
            <dt>Peak draw</dt>
            <dd>{formatEut(totals.peakEut)}</dd>
            <dt>Average @ grid ({tierAt(grid).name})</dt>
            <dd>{ampsLabel(totals.avgEut, grid)}</dd>
            <dt>Peak @ grid ({tierAt(grid).name})</dt>
            <dd>{ampsLabel(totals.peakEut, grid)}</dd>
            <dt>Highest machine tier</dt>
            <dd>{tierAt(totals.maxTier).name}</dd>
            <dt>Energy per hour</dt>
            <dd>{formatNumber(totals.avgEut * 72000)} EU</dd>
            {#if only}
              <dt>
                Energy per {app.isFluid(only.item) ? 'bucket' : 'item'} of
                <ItemName item={only.item} />
              </dt>
              <dd>
                {formatNumber(
                  ((totals.avgEut * 20) / only.rate) * (app.isFluid(only.item) ? 1000 : 1),
                )}
                EU
              </dd>
            {/if}
          </dl>
          {#if totals.maxTier > grid}
            <p class="text-xs text-danger">
              Some machines are above your grid tier ({tierAt(grid).name}); they need a transformer
              or a higher-tier line.
            </p>
          {/if}
          <p class="hint mt-[10px]">
            Wire for peak: at {tierAt(grid).name} you need cables rated for
            <b> {Math.ceil(totals.peakEut / TIERS[grid]!.v)}A </b> (before cable loss).
          </p>
        </section>
        <section class="card-box">
          <h3>Generators needed</h3>
          <div class="mb-[10px] flex flex-wrap gap-2">
            <select
              class="min-w-0 flex-1"
              aria-label="Generator preset"
              value={app.project.gen.preset}
              onchange={(event) => {
                const index = Number(event.currentTarget.value);
                app.project.gen = {
                  preset: index,
                  eut: GENERATOR_PRESETS[index]!.eut || generatorEut || 32,
                };
              }}
            >
              {#each GENERATOR_PRESETS as generator, i}
                <option value={i}>
                  {generator.name}{generator.eut ? ` — ${formatNumber(generator.eut)} EU/t` : ''}
                </option>
              {/each}
            </select><input
              class="w-[110px]"
              aria-label="EU/t per generator"
              type="number"
              min="1"
              disabled={preset.eut > 0}
              value={generatorEut}
              onchange={(event) =>
                (app.project.gen.eut = Math.max(1, event.currentTarget.valueAsNumber || 1))}
            >
          </div>
          <div class="big-answer">
            <div>
              <p class="hint">For average draw</p>
              <p class="value">
                {count(totals.avgEut)}
              </p>
              <p class="hint">with a battery buffer</p>
            </div>
            <div>
              <p class="hint">For peak draw</p>
              <p class="value">
                {count(totals.peakEut)}
              </p>
              <p class="hint">no buffer needed</p>
            </div>
          </div>
          <p class="hint mt-[10px]">
            To ride out a full minute at peak with only average-rated generation, store about
            <b> {formatNumber((totals.peakEut - totals.avgEut) * 1200)} EU </b>. Turbine output
            depends on rotor and fuel — use Custom for exact numbers.
          </p>
        </section>
      </div>
    </div>
  {/if}
</div>
