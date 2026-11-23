/**
 * Settings > Recipes: importing your game's recipe export (`#gameDataPanel`).
 * Settings > Icons: building item & machine icons from that import (`#iconPanel`).
 *
 * The import is a prerequisite for icons, so the icon page just points over when it is missing
 * rather than repeating the import flow.
 */
import { escapeHtml } from '../core/html';
import { icons } from '../icons/icon-store';
import type { ImportedGame } from '../import/parse-dump';
import type { App } from './app';
import { all, need } from './dom';
import { confirmAction } from './ask';
import { openIconDialog } from './icon-dialog';

/* ------------------------------ game data (Settings > Recipes) ------------------------------ */

export function renderGameDataPanel(app: App): void {
  const panel = need('#gameDataPanel');
  const game = app.store.gameData;

  panel.innerHTML = game ? importedMarkup(game) : gettingStartedMarkup();

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

function importedMarkup(game: ImportedGame): string {
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
        <p class="hint">Game updated? Re-run <a href="kubejs/zzz_moniflow_export.js" download>the exporter script</a> and re-import below.</p>
      </div>
      <div style="display:flex;gap:6px">
        <label class="btn small">Re-import<input type="file" class="game-file" accept=".json,application/json" hidden></label>
        <button class="btn small danger" id="btnRemoveGame">Remove</button>
      </div>
    </div>`;
}

function wireImported(app: App, panel: HTMLElement): void {
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

/* ------------------------------ icons (Settings > Icons) ------------------------------ */

export function renderIconPanel(app: App): void {
  const panel = need('#iconPanel');
  panel.innerHTML = app.store.gameData ? iconStatusMarkup(app) : noGameDataMarkup();
  wireIconPanel(app, panel);
}

function noGameDataMarkup(): string {
  return '<p class="hint">Import your game recipes in <a href="#" id="goToRecipes">Settings → Recipes</a> first, then build icons here.</p>';
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

  return `<div class="icon-status">${status}${hint}</div>`;
}

function wireIconPanel(app: App, panel: HTMLElement): void {
  panel.querySelector<HTMLAnchorElement>('#goToRecipes')?.addEventListener('click', (event) => {
    event.preventDefault();
    app.setSettingsPage('recipes');
  });

  panel.querySelector<HTMLButtonElement>('#btnIcons')?.addEventListener('click', () => {
    openIconDialog(app);
  });

  panel.querySelector<HTMLButtonElement>('#btnClearIcons')?.addEventListener('click', async () => {
    await icons.clear();
    app.renderStatic();
    app.update();
  });
}
