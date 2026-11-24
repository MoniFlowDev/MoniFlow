<script lang="ts">
  import { useApp } from '../state/context';
  import { icons } from '../icons/icon-store';
  const app = useApp();
  const atlas = $derived.by(() => {
    app.iconRevision;
    return icons.info;
  });
</script>

<svelte:head><title>Icons · MoniFlow</title></svelte:head>
<div>
  <section class="panel">
    <div class="panel-head">
      <h2>Item &amp; machine icons</h2>
      <span class="hint">Built from your instance's own textures</span>
    </div>
    {#if !app.gameData}
      <p class="hint mt-2">
        Import your game recipes in <a href="/settings/recipes"> Settings → Recipes </a> first, then
        build icons here.
      </p>
    {:else}
      {#if atlas}
        <p>
          Icons: <b>{atlas.count.toLocaleString()}</b> of {atlas.total.toLocaleString()}
          · built {String(atlas.built ?? '').slice(0, 10)}
        </p>
      {:else}
        <p class="hint mt-2">No item icons yet.</p>
      {/if}
      <div class="flex gap-2">
        <button
          class="btn btn-primary"
          onclick={() => (app.iconDialog = true)}
        >
          {atlas ? 'Rebuild icons' : 'Build icons'}
        </button>
        {#if atlas}
          <button
            class="btn btn-danger"
            onclick={async () => {
              try {
                await icons.clear();
              } catch {
                app.notify('Could not remove saved icons');
              }
            }}
          >
            Remove icons
          </button>
        {/if}
      </div>
      {#if !Object.keys(app.gameData.icons.gtIcons ?? {}).length}
        <p class="hint">Re-export with exporter v5 or newer for GregTech material icons.</p>
      {/if}
    {/if}
  </section>
</div>
