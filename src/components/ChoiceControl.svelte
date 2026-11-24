<script lang="ts">
  import { useApp } from '../state/context';
  import ItemIcon from './ItemIcon.svelte';
  import TierBadge from './TierBadge.svelte';
  const app = useApp();
  let { item }: { item: string } = $props();
  const producers = $derived(app.producersOf(item));
  const recipe = $derived(app.index.byId.get(app.currentChoice(item)));
</script>

{#if producers.length}
  <div class="choice-ctl">
    <span class="cc-cur">
      {#if recipe}
        <TierBadge {recipe} />
        <ItemIcon
          {recipe}
          size={14}
        />{recipe.machine}
      {:else}
        {producers.length} recipe{producers.length === 1 ? '' : 's'}
        available
      {/if}
    </span>

    <button
      class="link-btn"
      onclick={() => app.openPicker(item)}
    >
      {recipe ? 'Change…' : 'Pick recipe…'}
    </button>
  </div>
{/if}
