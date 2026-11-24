<script lang="ts">
  import { useApp } from '../state/context';
  import { backupJson } from '../state/transfer';
  import { download } from '../state/files';
  import type { RateUnit } from '../core/types';
  const app = useApp();
  async function importFile(event: Event) {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    try {
      app.importBackup(JSON.parse(await file.text()));
    } catch (error) {
      app.notify(error instanceof Error ? error.message : 'That file is not valid JSON');
    }
  }
</script>

<header class="topbar">
  <a
    href="/"
    class="brand"
  >
    <svg
      viewBox="0 0 32 32"
      class="size-8"
      aria-hidden="true"
    >
      <rect
        width="32"
        height="32"
        rx="7"
        fill="#1d2a38"
      />
      <path
        d="M6 22 L13 10 L19 18 L26 8"
        stroke="#ffb347"
        stroke-width="3.5"
        fill="none"
        stroke-linecap="round"
      />
    </svg>
    <div>
      <div class="brand-name">MoniFlow</div>
      <div class="brand-sub">Monifactory recipe flow &amp; power planner</div>
    </div>
  </a>
  <div class="project-bar">
    <select
      aria-label="Saved plans"
      value={app.state.activeId}
      onchange={(event) => app.switchProject(event.currentTarget.value)}
    >
      {#each app.state.projects as project (project.id)}
        <option value={project.id}>
          {project.name}
        </option>
      {/each}
    </select>
    <button
      class="btn btn-ghost"
      onclick={() => app.createProject()}
    >
      ＋ New
    </button>
    <button
      class="btn btn-ghost"
      onclick={() => app.renameProject()}
    >
      Rename
    </button>
    <button
      class="btn btn-ghost"
      onclick={() => app.duplicateProject()}
    >
      Duplicate
    </button>
    <button
      class="btn btn-ghost btn-danger"
      onclick={() => app.deleteProject()}
    >
      Delete
    </button>
  </div>
  <div class="top-actions">
    <div
      class="seg"
      aria-label="Rate unit"
    >
      {#each ['s', 'min', 'h'] as unit}
        <button
          class:active={app.state.unit === unit}
          aria-pressed={app.state.unit === unit}
          onclick={() => (app.state.unit = unit as RateUnit)}
        >
          /{unit}
        </button>
      {/each}
    </div>
    <button
      class="btn btn-ghost"
      onclick={() => app.share()}
    >
      Share link
    </button>
    <button
      class="btn btn-ghost"
      onclick={() => download('moniflow-backup.json', backupJson($state.snapshot(app.state)))}
    >
      Export
    </button>
    <label class="btn btn-ghost cursor-pointer">
      Import<input
        type="file"
        accept=".json,application/json"
        class="hidden"
        aria-label="Import backup"
        onchange={importFile}
      >
    </label>
    <a
      class="btn btn-ghost"
      href="/settings/icons"
      >Settings</a
    >
  </div>
</header>
