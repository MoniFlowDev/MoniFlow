<script lang="ts">
  import { useApp } from '../state/context';
  import { onMount } from 'svelte';
  import { Efficiency } from '../efficiency/recipe-stats';
  import { rankRecipes, PICK_SORTS, isPickSort } from '../efficiency/ranking';
  import { RecipeSearchIndex } from '../state/recipe-search';
  import { formatNumber, formatDuration, formatEut } from '../core/format';
  import { expectedAmount } from '../core/recipe';
  import { tier as tierAt } from '../data/tiers';
  import { itemName } from '../core/item-names';
  import Modal from './Modal.svelte';
  import ItemName from './ItemName.svelte';
  import ItemIcon from './ItemIcon.svelte';
  import TierBadge from './TierBadge.svelte';
  import IoChips from './IoChips.svelte';

  let { item }: { item: string } = $props();
  const app = useApp();

  let ready = $state(false);
  let query = $state('');
  let machine = $state('');
  let recycling = $state(false);
  const producers = $derived(app.producersOf(item));

  const machines = $derived.by(() => {
    const counts = new Map<string, number>();
    for (const recipe of producers)
      counts.set(recipe.machine, (counts.get(recipe.machine) ?? 0) + 1);
    return [...counts].sort((a, b) => b[1] - a[1]);
  });

  const search = $derived.by(() => {
    const index = new RecipeSearchIndex();
    index.rebuild(producers);
    return index;
  });

  const planUses = $derived(
    new Set([
      ...app.solution.steps.flatMap((s) => s.recipe.inputs.map((io) => io.item)),
      ...app.solution.targets.map((t) => t.item),
    ]),
  );

  const efficiency = $derived(
    ready
      ? new Efficiency(app.index, $state.snapshot(app.project.choices), {
          byproducts: app.state.byproductMode ?? 'split',
          planUses,
          defaultTier: app.project.defaultTier,
        })
      : null,
  );

  const mode = $derived(isPickSort(app.state.pickSort) ? app.state.pickSort : 'best');

  const ranked = $derived(
    efficiency
      ? rankRecipes(
          search
            .search(query.trim())
            .filter((r) => (recycling || !r.recycling) && (!machine || machine === r.machine)),
          item,
          efficiency,
          mode,
          app.project.defaultTier || 1,
        )
      : [],
  );

  const fluid = $derived(app.isFluid(item));
  const costScale = $derived(fluid ? 1000 : 1);

  onMount(() => {
    const timer = setTimeout(() => (ready = true), 30);
    return () => clearTimeout(timer);
  });
</script>

<Modal
  kind="picker"
  title="How should {itemName(item)} be made?"
  onclose={() => (app.picker = null)}
  wide
>
  <p class="picker-sub hint">
    {producers.length} recipes make this. Pick one to add it to the tree; expand its ingredients
    next.
  </p>
  <div class="picker-tools">
    <input
      type="search"
      aria-label="Filter recipes"
      placeholder="Filter by machine or ingredient…"
      bind:value={query}
    >
    <select
      aria-label="Recipe sort"
      bind:value={app.state.pickSort}
    >
      {#each Object.entries(PICK_SORTS) as [value, label]}
        <option {value}>Sort: {label}</option>
      {/each}
    </select>
    <select
      aria-label="Byproduct cost"
      bind:value={app.state.byproductMode}
    >
      <option value="split">Byproducts share the cost</option>
      <option value="plan">Only byproducts this plan uses share it</option>
      <option value="none">Ignore byproducts</option>
    </select>
    <select
      aria-label="Machine filter"
      bind:value={machine}
    >
      <option value="">All machines</option>
      {#each machines as [name, count]}
        <option value={name}>{name} ({count})</option>
      {/each}
    </select>
    {#if producers.some((r) => r.recycling)}
      <label class="check whitespace-nowrap text-[12px]">
        <input
          type="checkbox"
          bind:checked={recycling}
        >
        Show recycling ({producers.filter((r) => r.recycling).length})
      </label>
    {/if}
    <button
      class="btn btn-small"
      onclick={() => app.chooseRecipe('raw')}
    >
      Supply as raw instead
    </button>
  </div>
  <div class="picker-list">
    {#if !ready}
      <p
        class="hint"
        role="status"
      >
        Working out the most efficient recipes…
      </p>
    {:else}
      {#each ranked.slice(0, 150) as row, i (row.recipe.id)}
        {@const recipe = row.recipe}
        {@const stats = row.stats}
        <button
          class="pick-row"
          class:current={app.currentChoice(item) === recipe.id}
          onclick={() => app.chooseRecipe(recipe.id)}
        >
          <div class="flex flex-wrap items-center gap-2 text-[13px]">
            <TierBadge {recipe} />
            <ItemIcon
              {recipe}
              size={18}
            /><b>
              {recipe.machine}
            </b><span class="font-mono text-muted">
              {recipe.duration
                ? `${formatEut(recipe.eut)} · ${formatDuration(recipe.duration)}`
                : 'instant'}
            </span>
            {#if recipe.temp}
              <span> {formatNumber(recipe.temp)}K </span>
            {/if}
            {#if recipe.cond}
              <span class="text-sky-300">
                {recipe.cond}
              </span>
            {/if}
            {#if recipe.src !== 'game'}
              <span class="text-accent"> my recipe </span>
            {/if}
            <span class="ml-auto font-mono text-[12px] text-accent">
              makes
              {fluid
                ? app.format.fluid(
                    recipe.outputs
                      .filter((io) => io.item === item)
                      .reduce((sum, io) => sum + expectedAmount(io), 0),
                  )
                : formatNumber(
                    recipe.outputs
                      .filter((io) => io.item === item)
                      .reduce((sum, io) => sum + expectedAmount(io), 0),
                  )}
            </span>
            {#if i === 0 && ranked.length > 1 && !stats.loops}
              <span class="text-good"> ★ {mode === 'best' ? 'Best' : 'Top'} </span>
            {/if}
            {#if stats.loops}
              <span
                class="text-surplus"
                title="Ingredients are made from this item, so this recipe only converts what you already have"
              >
                ↻ made from itself
              </span>
            {/if}
            {#if app.currentChoice(item) === recipe.id}
              <span class="text-accent"> current </span>
            {/if}
          </div>
          <div class="pick-stats">
            <span
              class="pick-stat"
              class:selected={mode === 'chain'}
              title="Total energy including ingredients; * means approximate"
            >
              Σ {formatNumber(stats.chainEu * costScale)} EU/{fluid ? 'B' : 'item'}{stats.approx
                ? '*'
                : ''}
            </span>
            <span
              class="pick-stat"
              class:selected={mode === 'step'}
              title="Energy for this step only"
            >
              ⚡ {formatNumber(stats.stepEu * costScale)} EU/{fluid ? 'B' : 'item'}
            </span>
            <span
              class="pick-stat"
              class:selected={mode === 'machines'}
            >
              ⚙
              {stats.machines
                ? `${formatNumber(stats.machines * costScale, 2)} machines @ ${tierAt(stats.runTier!).name}`
                : 'instant'}
            </span>
            <span
              class="pick-stat"
              class:selected={mode === 'raw'}
              title="Raw materials following the ingredient tree"
            >
              ⛏ {formatNumber(stats.raw * costScale)} raw
            </span>
            <span
              class="pick-stat"
              class:selected={mode === 'tier'}
            >
              {stats.tier ? tierAt(stats.tier).name : 'no power'}
            </span>
            {#if stats.byproductShare > 0.005}
              <span
                class="pick-stat"
                title="Cost carried by other outputs"
              >
                ♻ {Math.round(stats.byproductShare * 100)}% to byproducts
              </span>
            {/if}
            {#each stats.tools as tool}
              <span
                class="pick-stat"
                title="Tool is used, not consumed"
              >
                🔨 <ItemName item={tool.item} />:
                {tool.estimated ? '~' : ''}{tool.uses.toLocaleString()} uses
              </span>
            {/each}
          </div>
          <div class="grid grid-cols-[1fr_18px_1fr] items-start gap-2">
            <IoChips list={recipe.inputs} /><span class="text-muted"> → </span>
            <IoChips
              list={recipe.outputs}
              highlight={item}
            />
          </div>
        </button>
      {:else}
        <p class="text-muted">No recipes match that filter.</p>
      {/each}
      {#if ranked.length > 150}
        <p class="hint">Showing 150 of {ranked.length} — filter to narrow it down.</p>
      {/if}
    {/if}
  </div>
</Modal>
