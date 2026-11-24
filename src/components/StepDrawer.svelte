<script lang="ts">
  import { useApp } from '../state/context';
  import type { SolvedStep } from '../solver/solve';
  import { stepTitle } from '../solver/step-title';
  import { tierComparison } from '../solver/tier-comparison';
  import { TIERS, tierForEut, tier as tierAt } from '../data/tiers';
  import { COILS } from '../data/coils';
  import { formatDuration, formatEut, formatNumber } from '../core/format';
  import { expectedAmount } from '../core/recipe';
  import type { OverclockMode } from '../core/types';
  import ItemName from './ItemName.svelte';
  import ItemIcon from './ItemIcon.svelte';
  import TierBadge from './TierBadge.svelte';
  import ChoiceControl from './ChoiceControl.svelte';
  let { step }: { step: SolvedStep } = $props();
  const app = useApp();
  const comparisons = $derived(step.instant ? [] : tierComparison(step));
  const product = $derived(
    step.recipe.outputs.find((io) => app.currentChoice(io.item) === step.id)?.item ??
      step.recipe.outputs[0]?.item,
  );
</script>

<h2><ItemName text={stepTitle(step, true)} /></h2>
<div class="mt-[2px] mb-3 text-[13px] text-muted">
  {#if !step.instant}
    <TierBadge tier={step.settings.tier} />{' '}
  {/if}
  <ItemIcon
    recipe={step.recipe}
    tier={step.settings.tier}
  />{step.recipe.machine} ·
  {step.instant
    ? 'instant recipe'
    : `base ${formatEut(step.recipe.eut)} (${tierAt(tierForEut(step.recipe.eut)).name}) · ${formatDuration(step.recipe.duration)}`}{step
    .recipe.src === 'game'
    ? ' · game recipe'
    : ''}{step.recipe.temp ? ` · ${formatNumber(step.recipe.temp)}K` : ''}{step.recipe.cond
    ? ` · ${step.recipe.cond}`
    : ''}
</div>
{#if step.spareOutputs.length}
  <div class="-mt-[6px] mb-[10px] text-[12px] text-surplus">
    Also makes
    {#each step.spareOutputs as item, i}
      {i ? ', ' : ''}<ItemName {item} />
    {/each}
    <span class="text-subtle">(not used in this plan)</span>
  </div>
{/if}
{#if !step.instant}
  <div class="big-machines">
    {#each [
      ['Needed', formatNumber(step.machines, 2)],
      ['Build', step.built],
      ['Utilization', `${Math.round(step.utilization * 100)}%`],
    ] as [label, value]}
      <div>
        <p class="label">{label}</p>
        <p
          class="value"
          style:color={label === 'Build' ? 'var(--accent)' : undefined}
        >
          {value}
        </p>
      </div>
    {/each}
  </div>
  <section class="section">
    <h3>Machine setup</h3>
    <div class="field-grid">
      <label class="field">
        Tier<select
          value={step.settings.tier}
          onchange={(event) =>
            app.overrideNode(step.id, {
              tier: Number(event.currentTarget.value),
            })}
        >
          {#each TIERS as tier, i}
            {#if i >= Math.min(step.settings.tier, Math.max(1, tierForEut(step.recipe.eut)))}
              <option value={i}>{tier.name} ({formatNumber(tier.v)} V)</option>
            {/if}
          {/each}
        </select>
      </label>
      <label class="field">
        Overclock<select
          value={step.settings.ocMode}
          onchange={(event) =>
            app.overrideNode(step.id, {
              ocMode: event.currentTarget.value as OverclockMode,
            })}
        >
          <option value="standard">Standard (×4 EU, ÷2 time)</option>
          <option value="perfect">Perfect (×4 EU, ÷4 time)</option>
          <option value="none">No overclocking</option>
        </select>
      </label>
      {#if step.useCoil}
        <label class="field">
          Coils<select
            value={step.settings.coil}
            onchange={(event) =>
              app.overrideNode(step.id, {
                coil: Number(event.currentTarget.value),
              })}
          >
            {#each COILS as coil, i}
              <option value={i}>{coil.name} ({formatNumber(coil.temp)}K)</option>
            {/each}
          </select>
        </label>
      {/if}
      <label class="field">
        Parallel<input
          type="number"
          min="1"
          step="1"
          value={step.settings.parallel}
          onchange={(event) =>
            app.overrideNode(step.id, {
              parallel: Math.max(1, Math.floor(event.currentTarget.valueAsNumber || 1)),
            })}
        >
      </label>
    </div>
    {#if step.settings.autoTier}
      <p class="hint text-accent">
        Tier picked automatically for perfect overclocking, up to your
        {tierAt(app.project.gridTier).name}
        grid. Choose a tier to override it.
      </p>
    {/if}
    {#each step.oc.errors as error}
      <p class="text-xs text-danger">
        {error}
      </p>
    {/each}
    {#each step.oc.notes as note}
      <p class="hint">
        {note}
      </p>
    {/each}
    {#if step.useCoil && step.oc.effTemp}
      <p class="hint">Effective coil heat {formatNumber(step.oc.effTemp)}K</p>
    {/if}
  </section>
  <section class="section">
    <h3>Per machine</h3>
    <dl class="kv">
      <dt>Time per craft</dt>
      <dd>{step.oc.dur} t ({formatDuration(step.oc.dur)})</dd>
      <dt>Power draw</dt>
      <dd>{formatEut(step.oc.eut)}</dd>
      <dt>Amperage</dt>
      <dd>{formatNumber(step.amps, 2)}A @ {tierAt(step.settings.tier).name}</dd>
      <dt>Crafts</dt>
      <dd>{app.format.rate(step.oc.craftsPerSec)}</dd>
      <dt>Energy per craft</dt>
      <dd>{formatNumber(step.oc.euPerCraft)} EU</dd>
    </dl>
  </section>
{/if}
<section class="section">
  <h3>This step in total</h3>
  <dl class="kv">
    <dt>Crafts needed</dt>
    <dd>{app.format.rate(step.rate)}</dd>
    <dt>Average power</dt>
    <dd>{formatEut(step.avgEut)}</dd>
    <dt>Peak ({step.built} running)</dt>
    <dd>{formatEut(step.peakEut)}</dd>
  </dl>
  {#if step.instant}
    <p class="hint">
      No processing time or machine count. Use an autocrafter or craft by hand at this rate.
    </p>
  {/if}
</section>
{#each [true, false] as input}
  <section class="section">
    <h3>{input ? 'Inputs' : 'Outputs'}</h3>
    {#each input ? step.recipe.inputs : step.recipe.outputs as io}
      <div class="space-y-1 py-1">
        <div class="flex items-start gap-2 text-xs">
          <ItemIcon
            item={io.item}
            fluid={!!io.fluid}
          /><span class="flex-1">
            <ItemName item={io.item} />
            {#if io.uses}
              <span class="text-subtle"> (tool, {io.uses.toLocaleString()} uses) </span>
            {/if}
            {#if io.kept}
              <span class="text-subtle"> (kept) </span>
            {/if}
            {#if io.returned}
              <span class="text-subtle"> (returned) </span>
            {/if}
            {#if !input && io.chance != null && io.chance !== 100}
              <span class="text-subtle"> ({io.chance}%) </span>
            {/if}
          </span><span class="font-mono text-muted">
            {app.format.rate((input ? io.amount : expectedAmount(io)) * step.rate, io.fluid)}
          </span>
        </div>
        {#if input}
          <div class="pl-5"><ChoiceControl item={io.item} /></div>
        {/if}
      </div>
    {:else}
      <p class="hint">None</p>
    {/each}
  </section>
{/each}
{#if comparisons.length}
  <section class="section">
    <h3>Compare tiers</h3>
    <div
      class="table-wrap [&_td]:px-[7px] [&_td]:py-[5px] [&_td]:text-[12px] [&_th]:px-[7px] [&_th]:py-[5px] [&_th]:text-[12px]"
    >
      <table>
        <thead>
          <tr>
            <th>Tier</th>
            <th>Machines</th>
            <th>Time</th>
            <th>EU/t each</th>
            <th>Avg EU/t</th>
          </tr>
        </thead>
        <tbody>
          {#each comparisons as option}
            <tr class:bg-raised={option.tier === step.settings.tier}>
              <td>
                <button
                  aria-label="Use {tierAt(option.tier).name} tier"
                  onclick={() => app.overrideNode(step.id, { tier: option.tier })}
                >
                  <TierBadge tier={option.tier} />
                </button>
              </td>
              <td>{formatNumber(option.machines, 2)} ({option.built})</td>
              <td>{option.oc.dur}t</td>
              <td>
                {formatNumber(option.oc.eut)}
              </td>
              <td>{formatNumber(option.avgEut)}</td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
    <p class="hint">
      Standard overclocks keep the same EU per item but double power per machine; perfect overclocks
      make each item cheaper.
    </p>
  </section>
{/if}
<div class="section flex flex-wrap gap-2">
  <button
    class="btn btn-primary btn-small"
    disabled={!product}
    onclick={() => product && app.openPicker(product)}
  >
    Change recipe…
  </button>
  <button
    class="btn btn-small"
    onclick={() => app.editOrCopy(step.recipe)}
  >
    {step.recipe.src === 'game' ? 'Copy & edit' : 'Edit recipe'}
  </button>
  {#if !step.instant}
    <button
      class="btn btn-small"
      onclick={() => delete app.project.nodes[step.id]}
    >
      Reset machine setup
    </button>
  {/if}
  <button
    class="btn btn-danger btn-small"
    onclick={() => app.hideChain(step.id)}
  >
    Hide this chain (supply as raw)
  </button>
</div>
