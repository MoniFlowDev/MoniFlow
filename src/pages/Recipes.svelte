<script lang="ts">
  import { useApp } from '../state/context';
  import { navigate } from '../router';
  import { libraryJson } from '../state/transfer';
  import { download } from '../state/files';
  import { formatDuration, formatEut } from '../core/format';
  import { itemNameRaw } from '../core/item-names';
  import GamePanel from '../components/GamePanel.svelte';
  import IoChips from '../components/IoChips.svelte';
  import ItemIcon from '../components/ItemIcon.svelte';
  import ItemName from '../components/ItemName.svelte';
  import TierBadge from '../components/TierBadge.svelte';
  const app = useApp();
  let query = $state('');
  let debouncedQuery = $state('');
  $effect(() => {
    const value = query;
    const timer = setTimeout(() => (debouncedQuery = value.trim()), 150);
    return () => clearTimeout(timer);
  });
  const matched = $derived(app.searchRecipes(app.recipeSource, debouncedQuery));
  const inPlan = $derived(new Set(app.solution.steps.map((s) => s.id)));
  async function importLibrary(event: Event) {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    try {
      app.importBackup(JSON.parse(await file.text()), true);
    } catch (error) {
      app.notify(error instanceof Error ? error.message : 'Invalid JSON file');
    }
  }
</script>

<svelte:head><title>Recipes · MoniFlow</title></svelte:head>
<div class="flex flex-col gap-3">
  <GamePanel />
  <section class="panel">
    <div class="panel-head">
      <h2>Recipe library</h2>
      <span class="hint">Back up or restore your own recipes</span>
    </div>
    <div class="flex flex-wrap gap-2">
      <button
        class="btn btn-ghost"
        onclick={() => download('moniflow-recipes.json', libraryJson($state.snapshot(app.state)))}
      >
        Export library
      </button><label class="btn btn-ghost cursor-pointer">
        Import library<input
          class="hidden"
          type="file"
          aria-label="Import library"
          accept=".json,application/json"
          onchange={importLibrary}
        >
      </label><button
        class="btn btn-ghost"
        onclick={() => app.restoreStarters()}
      >
        Restore starters
      </button>
    </div>
  </section>
  <div class="flex flex-wrap items-center gap-2 mb-1">
    <div class="seg">
      <button
        class:active={app.recipeSource === 'mine'}
        onclick={() => (app.recipeSource = 'mine')}
      >
        My recipes ({app.state.library.length})
      </button><button
        class:active={app.recipeSource === 'game'}
        onclick={() => (app.recipeSource = 'game')}
      >
        Game recipes{app.gameData ? ` (${app.gameData.recipes.length})` : ''}
      </button>
    </div>
    <input
      class="min-w-[220px] flex-1"
      type="search"
      aria-label="Search recipes"
      placeholder="Search recipes, machines, items…"
      bind:value={query}
    >
    <button
      class="btn btn-primary"
      onclick={() => app.openEditor()}
    >
      ＋ New recipe
    </button>
  </div>
  <p class="hint mt-2">
    Game recipes come from your own install and are read-only; use "Copy &amp; edit" to change one.
    My recipes are yours to edit (durations in ticks, 20 ticks = 1 s).
  </p>
  <div class="recipe-grid">
    {#each matched.slice(0, 120) as recipe (recipe.id)}
      <article class="recipe-card">
        <div class="flex items-start justify-between gap-2">
          <div>
            <h3 class="text-[14px]">
              <ItemName
                text={recipe.src === 'game' && recipe.outputs[0]
                  ? itemNameRaw(recipe.outputs[0].item)
                  : recipe.name}
              />
            </h3>
            <p class="text-[12px] text-muted">
              <ItemIcon {recipe} />{recipe.machine}
            </p>
          </div>
          <TierBadge {recipe} />
        </div>
        <div class="recipe-io">
          <IoChips list={recipe.inputs} /><span class="text-center text-subtle"> → </span>
          <IoChips list={recipe.outputs} />
        </div>
        <div class="flex flex-wrap items-center gap-[10px] text-[12px] text-muted">
          <span class="font-mono">
            {recipe.duration
              ? `${formatEut(recipe.eut)} · ${formatDuration(recipe.duration)}`
              : 'instant'}
          </span>
          {#if recipe.duration}
            <span class="font-mono text-subtle"> {recipe.duration}t </span>
          {/if}
          {#if recipe.temp}
            <span> {recipe.temp}K </span>
          {/if}
          {#if recipe.cond}
            <span class="cond">
              {recipe.cond}
            </span>
          {/if}
          {#if recipe.recycling}
            <span> recycling </span>
          {/if}
          {#if inPlan.has(recipe.id)}
            <span class="text-good"> ● in plan </span>
          {/if}
        </div>
        <div class="mt-[2px] flex justify-end gap-[6px]">
          <button
            class="btn btn-small"
            onclick={() => {
              app.makeRecipe(recipe);
              void navigate('/');
            }}
          >
            Make this
          </button><button
            class="btn btn-small"
            onclick={() => app.editOrCopy(recipe)}
          >
            {recipe.src === 'game' ? 'Copy & edit' : 'Edit'}
          </button>
          {#if recipe.src !== 'game'}
            <button
              class="btn btn-small"
              onclick={() => app.duplicateRecipe(recipe)}
            >
              Duplicate
            </button><button
              class="btn btn-small btn-danger"
              onclick={() => app.deleteRecipe(recipe)}
            >
              Delete
            </button>
          {/if}
        </div>
      </article>
    {:else}
      <p class="text-subtle">
        {app.recipeSource === 'game' && !app.gameData
          ? 'No game recipes yet — follow the steps above.'
          : 'No recipes match.'}
      </p>
    {/each}
  </div>
  {#if matched.length > 120}
    <p class="hint">
      Showing 120 of {matched.length.toLocaleString()} — type more to narrow it down.
    </p>
  {/if}
</div>
