<script lang="ts">
  import { useApp } from '../state/context';
  import { itemName } from '../core/item-names';
  import { formatNumber } from '../core/format';
  import { stepTitle } from '../solver/step-title';
  import ItemName from './ItemName.svelte';
  import ItemIcon from './ItemIcon.svelte';
  import ChoiceControl from './ChoiceControl.svelte';

  let { item, kind }: { item: string; kind: 'raw' | 'out' | 'sur' } = $props();

  const app = useApp();
  const fluid = $derived(app.isFluid(item));
  const raw = $derived(app.solution.raw.find((r) => r.item === item));
  const surplus = $derived(app.solution.surplus.find((r) => r.item === item));
  const target = $derived(app.solution.targets.find((r) => r.item === item));

  const producers = $derived(
    app.solution.steps.filter((s) => s.recipe.outputs.some((io) => io.item === item)),
  );

  const consumers = $derived(
    app.solution.steps.filter((s) => s.recipe.inputs.some((io) => io.item === item)),
  );

</script>

<h2 class="flex items-center gap-2 text-base normal-case tracking-normal text-foreground">
  <ItemIcon
    {item}
    {fluid}
  /><ItemName {item} />
</h2>

<p class="mt-[2px] mb-3 text-[13px] text-muted">
  {{ raw: 'Raw input', out: 'Target', sur: 'Byproduct' }[kind]} ·
  {fluid ? 'fluid' : 'item'}{item !== itemName(item) ? ` · ${item}` : ''}
</p>

<dl class="kv mt-4">
  {#if target}
    <dt>Target rate</dt>
    <dd>{app.format.rate(target.rate, fluid)}</dd>
  {/if}

  {#if raw}
    <dt>You must supply</dt>
    <dd>{app.format.rate(raw.rate, fluid)}</dd>
    <dt>{fluid ? 'Buckets' : 'Stacks'} per hour</dt>
    <dd>
      {formatNumber((raw.rate * 3600) / (fluid ? 1000 : 64))}
    </dd>
  {/if}

  {#if surplus}
    <dt>Left over</dt>
    <dd>{app.format.rate(surplus.rate, fluid)}</dd>
  {/if}
</dl>

{#if app.producersOf(item).length}
  <section class="section">
    <h3>Made by</h3>
    <ChoiceControl {item} />
  </section>
{/if}

{#if producers.length}
  <section class="section">
    <h3>Produced in this plan by</h3>
    {#each producers as step}
      <button
        class="block text-left text-xs text-accent hover:underline"
        onclick={() => app.selectById(step.id)}
      >
        <ItemName text={stepTitle(step, true)} /> ({step.recipe.machine})
      </button>
    {/each}
  </section>
{/if}

{#if consumers.length}
  <section class="section">
    <h3>Used by</h3>
    {#each consumers as step}
      <div class="flex justify-between gap-2 text-xs">
        <button
          class="text-left text-accent hover:underline"
          onclick={() => app.selectById(step.id)}
        >
          <ItemName text={stepTitle(step, true)} />
        </button><span class="font-mono text-muted">
          {app.format.rate(
            step.recipe.inputs
              .filter((io) => io.item === item)
              .reduce((sum, io) => sum + io.amount, 0) * step.rate,
            fluid,
          )}
        </span>
      </div>
    {/each}
  </section>
{/if}

<div class="section flex flex-wrap gap-2">
  {#if app.project.choices[item] === 'raw' && app.producersOf(item).length}
    <button
      class="btn btn-primary btn-small"
      onclick={() => {
        app.selection = null;
        app.showChain(item);
      }}
    >
      Show its chain again
    </button>
  {/if}
  {#if !target}
    <button
      class="btn btn-small"
      onclick={() => app.addTarget(item)}
    >
      Make it a target
    </button>
  {/if}
  <button
    class="btn btn-small"
    onclick={() =>
      app.openEditor(undefined, {
        name: itemName(item),
        outputs: [{ item, amount: 1, fluid }],
      })}
  >
    ＋ New recipe for this
  </button>
</div>
