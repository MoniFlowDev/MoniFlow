/**
 * The panel at the top of the Recipes tab: importing your game's recipes, and building icons.
 *
 * Before an import it explains how to get the export out of the game; afterwards it reports what
 * came in and offers to rebuild. Both the before and after states live here because they are the
 * same piece of UI in two conditions.
 */
import { escapeHtml } from '../core/html';
import { icons } from '../icons/icon-store';
import type { App } from './app';
import { all, need } from './dom';
import { confirmAction } from './ask';
import { openIconDialog } from './icon-dialog';

export function renderGamePanel(app: App): void {
  const panel = need('#gamePanel');
  const game = app.store.gameData;

  panel.innerHTML = game ? importedMarkup(app) : gettingStartedMarkup();

  if (game) wireImported(app, panel);
  wireFileInputs(app, panel);
}

function gettingStartedMarkup(): string {
  return `
    <div class="game-card">
      <div>
        <h3>Use the real recipes from your game</h3>
        <p class="hint">MoniFlow reads recipes straight out of your Monifactory install, so every machine, EU/t and duration matches your exact version.</p>
        <ol class="steps">
          <li><a href="kubejs/zzz_moniflow_export.js" download>Download the exporter script</a> and put it in <code>&lt;instance&gt;/minecraft/kubejs/server_scripts/</code>.</li>
          <li>Start Monifactory and load a singleplayer world. It writes <code>kubejs/moniflow_recipes.json</code> once.</li>
          <li>Click <b>Import game recipes</b> and pick that file.</li>
        </ol>
      </div>
      <label class="btn primary">Import game recipes<input type="file" class="game-file" accept=".json,application/json" hidden></label>
    </div>`;
}

function importedMarkup(app: App): string {
  const game = app.store.gameData!;
  const meta = game.meta;
  const stats = game.stats;

  const counts =
    stats?.gregtech != null
      ? `GregTech ${stats.gregtech.toLocaleString()} · other mods ${stats.other.toLocaleString()} · `
      : '';
  const version = meta.gtceu ? `GTCEu ${escapeHtml(meta.gtceu)} · ` : '';
  // The export timestamp is an ISO string; the date alone is enough.
  const exported = meta.exported ? `exported ${escapeHtml(meta.exported.slice(0, 10))}` : '';

  const warnings = meta.exportErrors.length
    ? `<details class="hint"><summary>${meta.exportErrors.length} export warning(s)</summary>${meta.exportErrors
        .map((error) => `<div>${escapeHtml(error)}</div>`)
        .join('')}</details>`
    : '';

  return `
    <div class="game-card compact">
      <div>
        <b>${game.recipes.length.toLocaleString()} game recipes</b>
        <span class="hint">${counts}${version}${exported}</span>
        ${warnings}
      </div>
      <div style="display:flex;gap:6px">
        <label class="btn small">Re-import<input type="file" class="game-file" accept=".json,application/json" hidden></label>
        <button class="btn small danger" id="btnRemoveGame">Remove</button>
      </div>
    </div>
    <div class="icon-status">${iconStatusMarkup(app)}</div>`;
}

function iconStatusMarkup(app: App): string {
  const atlas = icons.info;
  const status = atlas
    ? `<span>Icons: <b>${atlas.count.toLocaleString()}</b> of ${atlas.total.toLocaleString()} built ${escapeHtml(
        String(atlas.built ?? '').slice(0, 10),
      )}</span>
      <button class="btn small" id="btnIcons">Rebuild icons</button>
      <button class="btn small ghost" id="btnClearIcons">Remove icons</button>`
    : '<span>No item icons yet.</span><button class="btn small primary" id="btnIcons">Build icons</button>';

  // Material icons need the extra tables that exporter v5 added.
  const hasMaterialData = Object.keys(app.store.gameData?.icons.gtIcons ?? {}).length > 0;
  const hint = hasMaterialData
    ? ''
    : ' <span class="hint">Re-export from the game (exporter v5) for GregTech material icons.</span>';

  return status + hint;
}

function wireImported(app: App, panel: HTMLElement): void {
  panel.querySelector<HTMLButtonElement>('#btnIcons')?.addEventListener('click', () => {
    openIconDialog(app);
  });

  panel.querySelector<HTMLButtonElement>('#btnClearIcons')?.addEventListener('click', async () => {
    await icons.clear();
    app.renderStatic();
    app.update();
  });

  panel.querySelector<HTMLButtonElement>('#btnRemoveGame')?.addEventListener('click', async () => {
    const confirmed = await confirmAction({
      title: 'Remove game recipes?',
      message:
        'Plans that use game recipes will show those items as raw inputs until you import again.',
      okLabel: 'Remove',
      danger: true,
    });
    if (confirmed) await app.removeGameData();
  });
}

function wireFileInputs(app: App, panel: HTMLElement): void {
  for (const input of all<HTMLInputElement>('.game-file', panel)) {
    input.addEventListener('change', () => {
      const file = input.files?.[0];
      input.value = '';
      if (file) void app.importGameFile(file);
    });
  }
}
