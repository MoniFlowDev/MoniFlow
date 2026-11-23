/** Export, import and share: the header buttons and the Recipes tab's library buttons. */
import { STARTER_RECIPES } from '../data/starter-recipes';
import type { Recipe } from '../core/types';
import { deepClone } from '../state/project';
import {
  applySharePayload,
  backupJson,
  buildShareUrl,
  importProject,
  isShareHash,
  libraryJson,
  mergeRecipes,
  parseShareHash,
  type BackupFile,
} from '../state/transfer';
import type { App } from './app';
import { ask } from './ask';
import { download, need, readJsonFile } from './dom';
import { toast } from './toast';

export function wireTransfer(app: App): void {
  wireBackup(app);
  wireLibrary(app);
  wireShare(app);
}

/* ------------------------------ whole-app backup ------------------------------ */

function wireBackup(app: App): void {
  need<HTMLButtonElement>('#btnExport').addEventListener('click', () => {
    download('moniflow-backup.json', backupJson(app.store.state));
  });

  need<HTMLInputElement>('#fileImport').addEventListener('change', (event) => {
    readJsonFile<BackupFile>(
      event.target as HTMLInputElement,
      (data) => importBackup(app, data),
      toast,
    );
  });
}

function importBackup(app: App, data: BackupFile): void {
  const state = app.store.state;
  const imported: string[] = [];
  let lastProjectId: string | null = null;

  if (Array.isArray(data.library)) {
    const { added, updated } = mergeRecipes(state, data.library);
    app.store.markLibraryDirty();
    imported.push(`${added + updated} recipes`);
  }
  if (Array.isArray(data.projects)) {
    for (const project of data.projects) lastProjectId = importProject(state, project).id;
    imported.push(`${data.projects.length} plans`);
  }
  if (data.project) {
    lastProjectId = importProject(state, data.project).id;
    imported.push('1 plan');
  }

  // Land on whatever came in, which is what you wanted to look at.
  if (lastProjectId) state.activeId = lastProjectId;

  app.renderStatic();
  app.update();
  toast(imported.length ? `Imported ${imported.join(' and ')}` : 'Nothing to import in that file');
}

/* ------------------------------ recipe library ------------------------------ */

function wireLibrary(app: App): void {
  need<HTMLButtonElement>('#btnExportLib').addEventListener('click', () => {
    download('moniflow-recipes.json', libraryJson(app.store.state));
  });

  need<HTMLInputElement>('#fileImportLib').addEventListener('change', (event) => {
    readJsonFile<BackupFile | unknown[]>(
      event.target as HTMLInputElement,
      (data) => {
        // Accept either a bare list of recipes or a `{ library: [...] }` wrapper.
        const recipes = Array.isArray(data) ? data : data.library;
        if (!Array.isArray(recipes)) {
          toast('No recipes found in that file');
          return;
        }
        const { added, updated } = mergeRecipes(app.store.state, recipes);
        app.store.markLibraryDirty();
        app.renderStatic();
        app.update();
        toast(`Imported ${added} new, ${updated} updated recipes`);
      },
      toast,
    );
  });

  need<HTMLButtonElement>('#btnResetLib').addEventListener('click', () => {
    const library = app.store.state.library;
    let restored = 0;
    for (const starter of STARTER_RECIPES) {
      if (library.some((r) => r.id === starter.id)) continue;
      library.push(deepClone(starter) as Recipe);
      restored++;
    }
    app.store.markLibraryDirty();
    app.renderStatic();
    app.update();
    toast(restored ? `Restored ${restored} starter recipes` : 'All starter recipes are already present');
  });
}

/* ------------------------------ share links ------------------------------ */

function wireShare(app: App): void {
  need<HTMLButtonElement>('#btnShare').addEventListener('click', () => void share(app));

  window.addEventListener('hashchange', () => {
    if (!isShareHash(location.hash)) return;
    openSharedPlan(app);
    app.renderStatic();
    app.update();
  });
}

async function share(app: App): Promise<void> {
  const { store } = app;
  const project = store.project;

  // Everything the plan needs to stand on its own: the running steps plus any pinned choice.
  const ids = new Set(store.solution.steps.map((step) => step.id));
  for (const item of Object.keys(project.choices)) {
    const choice = project.choices[item]!;
    if (choice !== 'raw') ids.add(choice);
  }
  const recipes = [...ids]
    .map((id) => store.index.byId.get(id))
    .filter((recipe): recipe is Recipe => !!recipe);

  const url = buildShareUrl(project, recipes);

  // The clipboard needs permission and a secure context; fall back to showing the link.
  try {
    await navigator.clipboard.writeText(url);
    toast('Share link copied to clipboard');
  } catch {
    await ask({ title: 'Copy this link', input: url, okLabel: 'Done' });
  }
}

/** Read a plan out of the URL, if there is one, then clear the hash. */
export function openSharedPlan(app: App): void {
  const payload = parseShareHash(location.hash);
  if (!payload) return;

  const project = applySharePayload(
    app.store.state,
    payload,
    (id) =>
      app.store.state.library.some((r) => r.id === id) ||
      !!app.store.gameData?.recipes.some((r) => r.id === id),
  );
  app.store.markLibraryDirty();

  if (project) {
    app.store.state.activeId = project.id;
    toast(`Opened shared plan "${project.name}"`);
  } else {
    toast('Could not read the shared plan in the link');
  }

  // Drop the hash so a reload does not import the plan a second time.
  history.replaceState(null, '', location.href.split('#')[0]!);
}
