<script lang="ts">
  import { onDestroy } from 'svelte';
  import { useApp } from '../state/context';
  import { buildAtlas } from '../icons/atlas-builder';
  import { collectInstanceAssets, type InstanceSource } from '../icons/instance-sources';
  import { ModelRepository } from '../icons/model-repository';
  import { icons } from '../icons/icon-store';
  import Modal from './Modal.svelte';

  const app = useApp();

  let source = $state.raw<InstanceSource | null>(null);
  let vanillaJar = $state.raw<File | null>(null);
  let sourceLabel = $state('Nothing chosen');
  let status = $state('');
  let progress = $state(0);
  let working = $state(false);
  let disposed = false;
  let folderInput: HTMLInputElement;

  onDestroy(() => (disposed = true));

  async function pickFolder() {
    if (window.showDirectoryPicker) {
      try {
        const handle = await window.showDirectoryPicker({
          id: 'moniflow-instance',
          mode: 'read',
        });
        source = handle;
        sourceLabel = `Folder: ${handle.name}`;
        return;
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') return;
      }
    }
    folderInput.click();
  }

  async function build(event: SubmitEvent) {
    event.preventDefault();

    const game = app.gameData;

    if (!game || !source || working) return;

    working = true;
    progress = 0;
    status = 'Reading assets…';

    try {
      const assets = await collectInstanceAssets(source, vanillaJar, (message) => {
        if (!disposed) status = message;
      });

      if (disposed || game !== app.gameData) return;

      if (!assets.jars)
        throw new Error('No mod jars found. Pick the instance folder containing mods.');

      const repo = new ModelRepository(assets.fs, game.icons.iconSets);

      const atlas = await buildAtlas(repo, {
        items: [...app.index.items]
          .filter((key) => key.includes(':') && !key.startsWith('#'))
          .map((key) => ({ key, fluid: app.isFluid(key) })),
        types: [...new Set(game.recipes.map((r) => r.type).filter(Boolean))] as string[],
        itemIds: new Set(Object.keys(game.names)),
        materials: game.icons.gtMaterials,
        gtIcons: game.icons.gtIcons,
        onProgress: (done, total, drawn) => {
          if (!disposed) {
            progress = (done / total) * 100;
            status = `Drawing icons… ${done.toLocaleString()} / ${total.toLocaleString()} (${drawn.toLocaleString()} found)`;
          }
        },
      });

      if (disposed || game !== app.gameData) return;

      status = 'Saving…';

      await icons.save(atlas);

      if (disposed) return;

      app.notify(
        `Built ${atlas.count.toLocaleString()} icons for ${atlas.total.toLocaleString()} items and machines${assets.vanilla ? '' : ' (add the Minecraft jar for vanilla items)'}`,
        6000,
      );

      app.iconDialog = false;

    } catch (error) {
      if (!disposed)
        status = `Icon build failed: ${error instanceof Error ? error.message : String(error)}`;

    } finally {
      if (!disposed) working = false;
    }
  }
</script>

<Modal
  kind="icons"
  title="Build item & machine icons"
  onclose={() => (app.iconDialog = false)}
>
  <form
    class="flex flex-col gap-[14px]"
    onsubmit={build}
  >
    <p class="text-sm text-muted">
      MoniFlow draws icons from your instance’s own textures and models. Nothing leaves your
      computer; the result is saved in this browser.
    </p>
    <ol class="list-decimal space-y-4 pl-5 text-xs text-muted">
      <li>
        <p>
          Pick your instance’s <b>minecraft</b> folder (with <code>mods</code>
          and <code>kubejs</code>).
        </p>
        <div class="mt-2 flex items-center gap-2">
          <button
            class="btn"
            type="button"
            disabled={working}
            onclick={pickFolder}
          >
            Choose folder…
          </button><span>{sourceLabel}</span>
        </div>
        <input
          bind:this={folderInput}
          class="hidden"
          type="file"
          webkitdirectory
          aria-label="Instance folder"
          onchange={(event) => {
            source = event.currentTarget.files;
            sourceLabel = `${source?.length ?? 0} files selected`;
          }}
        >
      </li>
      <li>
        <p>
          Optional, for vanilla items: pick <code> minecraft-1.20.1-client.jar </code>
          from your launcher’s
          <code>libraries/com/mojang/minecraft/1.20.1/</code> folder.
        </p>
        <label class="btn mt-2 cursor-pointer">
          Choose jar…<input
            type="file"
            class="hidden"
            accept=".jar"
            aria-label="Minecraft jar"
            disabled={working}
            onchange={(event) => (vanillaJar = event.currentTarget.files?.[0] ?? null)}
          >
        </label>
        {vanillaJar?.name ?? 'Nothing chosen'}
      </li>
    </ol>

    {#if status}
      <div
        class="space-y-2"
        role="status"
      >
        <div class="h-2 overflow-hidden rounded bg-line">
          <div
            class="h-full bg-accent"
            style:width="{progress}%"
          ></div>
        </div>
        <p class="hint">{status}</p>
      </div>
    {/if}

    <div class="flex justify-end gap-2">
      <button
        type="button"
        class="btn btn-ghost"
        onclick={() => (app.iconDialog = false)}
      >
        Close
      </button><button
        class="btn btn-primary"
        type="submit"
        disabled={!source || working}
      >
        {working ? 'Building…' : 'Build icons'}
      </button>
    </div>
  </form>
</Modal>
