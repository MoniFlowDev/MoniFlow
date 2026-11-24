<script lang="ts">
  import { useApp } from '../state/context';
  import StepDrawer from './StepDrawer.svelte';
  import ItemDrawer from './ItemDrawer.svelte';
  const app = useApp();
  const step = $derived(
    app.selection?.type === 'step'
      ? app.solution.steps.find((s) => s.id === app.selectedId)
      : undefined,
  );
</script>

{#if app.selection && (app.selection.type === 'item' || step)}
  <aside
    class="drawer"
    aria-label="Selection details"
  >
    <button
      class="absolute top-2.5 right-2.5 text-[22px] leading-none text-muted hover:text-foreground"
      aria-label="Close details"
      onclick={() => (app.selection = null)}
    >
      ×
    </button>
    <div>
      {#if app.selection.type === 'item'}
        <ItemDrawer
          item={app.selection.item}
          kind={app.selection.kind}
        />
      {:else if step}
        <StepDrawer {step} />
      {/if}
    </div>
  </aside>
{/if}
