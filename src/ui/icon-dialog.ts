/**
 * The icon builder dialog.
 *
 * Everything happens locally: the browser reads your instance's jars, draws every icon, and stores
 * the result here. The dialog exists mostly to explain that, and to get a folder — which is the
 * awkward part, since `showDirectoryPicker` is not everywhere and the `<input webkitdirectory>`
 * fallback hands over the whole file list instead.
 */
import { buildAtlas } from '../icons/atlas-builder';
import { icons } from '../icons/icon-store';
import { collectInstanceAssets, type InstanceSource } from '../icons/instance-sources';
import { ModelRepository } from '../icons/model-repository';
import type { App } from './app';
import { need } from './dom';
import { toast } from './toast';

/** How long the success message stays up — it carries a caveat worth reading. */
const RESULT_TOAST_MS = 6000;

let source: InstanceSource | null = null;
let vanillaJar: File | null = null;

export function openIconDialog(app: App): void {
  if (!app.store.gameData) {
    toast('Import game recipes first');
    return;
  }
  need('#iconProgress').hidden = true;
  need<HTMLButtonElement>('#iconBuild').disabled = !source;
  need<HTMLDialogElement>('#iconDialog').showModal();
}

export function wireIconDialog(app: App): void {
  need<HTMLButtonElement>('#iconPickDir').addEventListener('click', () => void pickFolder());
  need<HTMLInputElement>('#iconDirInput').addEventListener('change', (event) => {
    const files = (event.target as HTMLInputElement).files;
    if (files?.length) {
      setSource(files, `${files.length.toLocaleString()} files selected`);
    }
  });

  need<HTMLInputElement>('#iconJarInput').addEventListener('change', (event) => {
    vanillaJar = (event.target as HTMLInputElement).files?.[0] ?? null;
    need('#iconJarStatus').textContent = vanillaJar ? vanillaJar.name : 'Nothing chosen';
  });

  need<HTMLButtonElement>('#iconCancel').addEventListener('click', () => {
    need<HTMLDialogElement>('#iconDialog').close();
  });
  need<HTMLFormElement>('#iconForm').addEventListener('submit', (event) => {
    event.preventDefault();
    void build(app);
  });
}

function setSource(chosen: InstanceSource, label: string): void {
  source = chosen;
  need('#iconDirStatus').textContent = label;
  need<HTMLButtonElement>('#iconBuild').disabled = false;
}

/** Prefer a directory handle, which reads files lazily; fall back to the file input. */
async function pickFolder(): Promise<void> {
  if (window.showDirectoryPicker) {
    try {
      const handle = await window.showDirectoryPicker({ id: 'moniflow-instance', mode: 'read' });
      setSource(handle, `Folder: ${handle.name}`);
      return;
    } catch (error) {
      // Cancelling is not a failure; anything else means try the other API.
      if (error instanceof DOMException && error.name === 'AbortError') return;
    }
  }
  need<HTMLInputElement>('#iconDirInput').click();
}

async function build(app: App): Promise<void> {
  const game = app.store.gameData;
  if (!game || !source) return;

  const status = need('#iconProgressText');
  const bar = need('#iconBar');
  need('#iconProgress').hidden = false;
  const buildButton = need<HTMLButtonElement>('#iconBuild');
  buildButton.disabled = true;
  bar.style.width = '0%';

  try {
    const assets = await collectInstanceAssets(source, vanillaJar, (message) => {
      status.textContent = message;
    });
    if (!assets.jars) {
      status.textContent = 'No mod jars found. Pick the instance folder that contains "mods".';
      buildButton.disabled = false;
      return;
    }

    const repo = new ModelRepository(assets.fs, game.icons.iconSets);
    const atlas = await buildAtlas(repo, {
      // Only real game ids can have artwork; your own recipes' plain names cannot.
      items: [...app.store.index.items]
        .filter((key) => key.includes(':') && !key.startsWith('#'))
        .map((key) => ({ key, fluid: app.store.isFluid(key) })),
      types: [...new Set(game.recipes.map((r) => r.type).filter(Boolean))] as string[],
      itemIds: new Set(Object.keys(game.names)),
      materials: game.icons.gtMaterials,
      gtIcons: game.icons.gtIcons,
      onProgress: (done, total, drawn) => {
        bar.style.width = `${((done / total) * 100).toFixed(1)}%`;
        status.textContent =
          `Drawing icons… ${done.toLocaleString()} / ${total.toLocaleString()} ` +
          `(${drawn.toLocaleString()} found)`;
      },
    });

    status.textContent = 'Saving…';
    await icons.save(atlas);
    need<HTMLDialogElement>('#iconDialog').close();
    app.renderStatic();
    app.update();

    const vanillaNote = assets.vanilla ? '' : ' (add the Minecraft jar for vanilla items)';
    toast(
      `Built ${atlas.count.toLocaleString()} icons for ${atlas.total.toLocaleString()} items and machines${vanillaNote}`,
      RESULT_TOAST_MS,
    );
  } catch (error) {
    status.textContent = `Icon build failed: ${error instanceof Error ? error.message : String(error)}`;
    buildButton.disabled = false;
  }
}
