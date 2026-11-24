<script lang="ts">
  import { useApp } from '../state/context';
  import { formatNumber } from '../core/format';
  import { stepTitle } from '../solver/step-title';
  import type { Recipe } from '../core/types';
  import TierBadge from '../components/TierBadge.svelte';
  import ItemIcon from '../components/ItemIcon.svelte';
  import ItemName from '../components/ItemName.svelte';
  const app = useApp();
  const groups = $derived.by(() => {
    const result = new Map<
      string,
      { tier: number; machine: string; recipe: Recipe; count: number }
    >();
    for (const step of app.solution.steps) {
      if (step.instant) continue;
      const key = `${step.settings.tier}|${step.recipe.machine}`;
      const group = result.get(key) ?? {
        tier: step.settings.tier,
        machine: step.recipe.machine,
        recipe: step.recipe,
        count: 0,
      };
      group.count += step.built;
      result.set(key, group);
    }
    return [...result.values()].sort((a, b) => b.tier - a.tier || b.count - a.count);
  });
</script>

<svelte:head><title>Machines · MoniFlow</title></svelte:head>
<div class="machines-view">
  {#if !app.solution.steps.length}
    <p class="text-muted">No machines yet — add a target.</p>
  {:else}
    <h3 class="section-title">
      Build list <span class="hint font-normal"> Machines rounded up, grouped by tier </span>
    </h3>
    <div class="build-list">
      {#each groups as group}
        <div class="build-card">
          <b
            class="min-w-10 text-right font-mono text-[20px] leading-[normal] font-bold text-accent"
          >
            {group.count}×
          </b><ItemIcon
            recipe={group.recipe}
            tier={group.tier}
            size={28}
          />
          <div><TierBadge tier={group.tier} /> {group.machine}</div>
        </div>
      {/each}
    </div>
    <h3 class="section-title">
      Every step
      <span class="hint font-normal"> Select a recipe for details and tier comparison </span>
    </h3>
    <div class="table-wrap">
      <table
        class="[&_th:nth-child(4)]:text-right [&_th:nth-child(5)]:text-right [&_th:nth-child(n+7):not(:last-child)]:text-right"
      >
        <thead>
          <tr>
            {#each [
              'Tier',
              'Machine',
              'Recipe',
              'Needed',
              'Build',
              'Utilization',
              'Craft time',
              'EU/t each',
              'Avg EU/t',
              'Peak EU/t',
              'Notes',
            ] as label}
              <th>
                {label}
              </th>
            {/each}
          </tr>
        </thead>
        <tbody>
          {#each app.solution.steps as step (step.id)}
            <tr
              class="hover:bg-[#1f2c3a]"
              class:bg-raised={app.selectedId === step.id}
            >
              <td>
                {#if !step.instant}
                  <TierBadge tier={step.settings.tier} />
                {:else}
                  —
                {/if}
              </td>
              <td>
                <span class="flex items-center gap-1">
                  <ItemIcon
                    recipe={step.recipe}
                    tier={step.settings.tier}
                  />{step.recipe.machine}
                </span>
              </td>
              <td>
                <button
                  class="text-left text-foreground"
                  onclick={() => app.selectById(step.id)}
                >
                  <ItemName text={stepTitle(step, true)} />
                </button>
                {#if step.spareOutputs.length}
                  <span
                    class="ml-1 rounded border border-surplus/40 px-1 text-[10.5px] text-surplus"
                  >
                    +{step.spareOutputs.length}
                  </span>
                {/if}
              </td>
              <td class="text-right font-mono">
                {step.instant ? app.format.rate(step.rate) : formatNumber(step.machines, 2)}
              </td>
              <td class="text-right font-mono font-bold">
                {step.instant ? '—' : step.built}
              </td>
              <td>
                <span
                  class="mr-[6px] inline-block h-[6px] w-[70px] overflow-hidden rounded-[3px] bg-surface align-middle"
                >
                  <span
                    class="block h-full"
                    style:width="{Math.round(step.utilization * 100)}%"
                    style:background={step.utilization > 0.85
                      ? 'var(--good)'
                      : step.utilization > 0.5
                        ? 'var(--warn)'
                        : 'var(--accent-2)'}
                  ></span>
                </span>
                <span class="font-mono text-muted"> {Math.round(step.utilization * 100)}% </span>
              </td>
              <td class="text-right font-mono">{step.oc.dur}t</td>
              <td class="text-right font-mono">
                {formatNumber(step.oc.eut)}
              </td>
              <td class="text-right font-mono">
                {formatNumber(step.avgEut)}
              </td>
              <td class="font-mono">
                {formatNumber(step.peakEut)}
              </td>
              <td
                class="text-[12px] text-subtle"
                class:text-danger={!!step.oc.errors.length}
              >
                {step.oc.errors[0] ?? step.oc.notes.join(' · ')}
              </td>
            </tr>
          {/each}
        </tbody>
        <tfoot>
          <tr>
            <td colspan="4"><b>Total</b></td>
            <td class="font-mono font-bold">
              {app.solution.totals.machines}
            </td>
            <td colspan="3"></td>
            <td class="text-right font-mono">
              {formatNumber(app.solution.totals.avgEut)}
            </td>
            <td class="text-right font-mono">
              {formatNumber(app.solution.totals.peakEut)}
            </td>
            <td></td>
          </tr>
        </tfoot>
      </table>
    </div>
  {/if}
</div>
