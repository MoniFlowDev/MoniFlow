<script lang="ts">
  import type { RecipeIO } from '../core/types';
  import { useApp } from '../state/context';
  import ItemName from './ItemName.svelte';
  import ItemIcon from './ItemIcon.svelte';
  let { list, highlight }: { list: readonly RecipeIO[]; highlight?: string } = $props();
  const app = useApp();
</script>

<div class="flex flex-wrap gap-1">
  {#each list as io}
    <span
      class="chip"
      class:border-accent={io.item === highlight}
      class:border-dashed={!!io.returned}
      class:text-surplus={!!io.returned}
      title={io.uses
        ? `Tool: ${io.usesEstimated ? 'about ' : ''}${io.uses.toLocaleString()} uses; one use per craft`
        : io.item}
    >
      <ItemIcon
        item={io.item}
        fluid={!!io.fluid}
        size={14}
      />

      <span class="font-mono text-muted">
        {io.uses ? `1/${io.uses}` : io.kept ? 'kept' : app.format.amount(io.amount, io.fluid)}
      </span>{' '}<ItemName item={io.item} />

      {#if io.returned}
        <span class="text-subtle">returned</span>
      {/if}

      {#if io.chance != null && io.chance !== 100}
        <span class="text-subtle"> {io.chance}% </span>
      {/if}
    </span>
  {:else}
    <span class="hint">nothing</span>
  {/each}
</div>
