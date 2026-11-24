<script lang="ts">
  import { useApp } from '../state/context';

  const app = useApp();

  async function importGame(event: Event) {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (file) await app.importGame(file);
  }
  const exporter = `${import.meta.env.BASE_URL}kubejs/zzz_moniflow_export.js`;
</script>

<section class="panel">
  <div class="panel-head">
    <h2>Game recipes</h2>
    <span class="hint">Import your Monifactory install's recipes</span>
  </div>

  {#if app.gameData}
    <div class="game-card !px-[14px] !py-[9px]">
      <div>
        <b>{app.gameData.recipes.length.toLocaleString()} game recipes</b
        ><span class="hint ml-2">
          GregTech {app.gameData.stats.gregtech?.toLocaleString()} · other mods
          {app.gameData.stats.other?.toLocaleString()}
          ·
          {app.gameData.meta.gtceu ? `GTCEu ${app.gameData.meta.gtceu} · ` : ''}{app.gameData.meta
            .exported
            ? `exported ${app.gameData.meta.exported.slice(0, 10)}`
            : ''}
        </span>

        {#if app.gameData.meta.exportErrors.length}
          <details class="hint">
            <summary>{app.gameData.meta.exportErrors.length} export warnings</summary>
            {#each app.gameData.meta.exportErrors as warning}
              <p>
                {warning}
              </p>
            {/each}
          </details>
        {/if}

        <p class="hint mt-2">
          Game updated? Re-run
          <a
            href={exporter}
            download
          >
            the exporter script
          </a>
          and re-import below.
        </p>
      </div>

      <div class="flex gap-[6px]">
        <label class="btn btn-small cursor-pointer">
          Re-import<input
            class="hidden"
            type="file"
            aria-label="Re-import game recipes"
            accept=".json,application/json"
            onchange={importGame}
          >
        </label><button
          class="btn btn-small btn-danger"
          onclick={() => app.removeGame()}
        >
          Remove
        </button>
      </div>

    </div>
  {:else}
    <div class="game-card">
      <div>
        <h3 class="mb-1">Use the real recipes from your game</h3>
        <p class="hint mt-2">
          MoniFlow reads recipes straight out of your Monifactory install, so every machine, EU/t
          and duration matches your exact version.
        </p>
        <ol class="mt-2 flex list-decimal flex-col gap-[3px] pl-5 text-[13px] text-muted">
          <li>
            <a
              class="underline"
              href={exporter}
              download
            >
              Download the exporter script
            </a>
            and put it in
            <code>&lt;instance&gt;/minecraft/kubejs/server_scripts/</code>.
          </li>
          <li>
            Start Monifactory and load a singleplayer world. It writes
            <code> kubejs/moniflow_recipes.json </code> once.
          </li>
          <li>Click <b>Import game recipes</b> and pick that file.</li>
        </ol>
      </div>

      <label class="btn btn-primary cursor-pointer">
        Import game recipes<input
          class="hidden"
          type="file"
          aria-label="Import game recipes"
          accept=".json,application/json"
          onchange={importGame}
        >
      </label>
    </div>
  {/if}
</section>
