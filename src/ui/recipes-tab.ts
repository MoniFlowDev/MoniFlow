/**
 * The Settings > Recipes page: your own recipe library and the read-only game set, side by side.
 *
 * The game set can be tens of thousands of recipes, so the grid renders at most a screenful and
 * says how many matched — the search box is the way through it, not scrolling.
 */
import { formatNumber } from '../core/format';
import { escapeHtml } from '../core/html';
import type { Recipe } from '../core/types';
import { recipeNameHtml } from '../solver/step-title';
import { deepClone, uid } from '../state/project';
import type { App } from './app';
import { confirmAction } from './ask';
import { machineIcon, recipeBadge, recipeTiming } from './badges';
import { all, debounce, need, setActive } from './dom';
import { ioChips } from './io-chips';

/** Cards rendered at most. */
const LIMIT = 120;
/** How long to wait after the last keystroke before searching the game's full recipe set. */
const SEARCH_DEBOUNCE_MS = 150;

export type RecipeSource = 'mine' | 'game';

export function renderRecipes(app: App): void {
  renderSourceTabs(app);
  renderRecipeGrid(app);
}

function renderSourceTabs(app: App): void {
  setActive('#recipeSrcSeg button', 'src', app.recipeSource);

  const gameCount = app.store.gameData?.recipes.length;
  need('#recipeSrcSeg [data-src="game"]').textContent = `Game recipes${
    gameCount == null ? '' : ` (${gameCount.toLocaleString()})`
  }`;
  need('#recipeSrcSeg [data-src="mine"]').textContent =
    `My recipes (${app.store.state.library.length})`;
}

function renderRecipeGrid(app: App): void {
  const query = need<HTMLInputElement>('#recipeSearch').value.trim();
  const matched = app.store.searchRecipes(app.recipeSource, query);
  const shown = matched.slice(0, LIMIT);

  const container = need('#recipeList');
  if (!shown.length) {
    container.innerHTML =
      app.recipeSource === 'game' && !app.store.gameData
        ? '<p class="muted">No game recipes yet — follow the steps above.</p>'
        : '<p class="muted">No recipes match.</p>';
    return;
  }

  const inPlan = new Set(app.store.solution.steps.map((step) => step.id));
  const overflow =
    matched.length > LIMIT
      ? `<p class="hint" style="margin-top:10px">Showing ${LIMIT} of ${matched.length.toLocaleString()} — type more to narrow it down.</p>`
      : '';

  container.innerHTML =
    `<div class="recipe-grid">${shown.map((r) => card(r, inPlan.has(r.id))).join('')}</div>` +
    overflow;

  wireCards(app, container);
}

function card(recipe: Recipe, inPlan: boolean): string {
  const meta = [
    `<span class="num">${recipeTiming(recipe)}</span>`,
    recipe.duration > 0 ? `<span class="num">${recipe.duration}t</span>` : '',
    recipe.temp ? `<span class="num">${formatNumber(recipe.temp)}K</span>` : '',
    inPlan ? '<span style="color:var(--good)">● in plan</span>' : '',
  ].join('');

  return `
    <div class="recipe-card" data-id="${escapeHtml(recipe.id)}">
      <div class="rc-head">
        <div>
          <div class="rc-name">${recipeNameHtml(recipe)}</div>
          <div class="rc-machine">${machineIcon(recipe, null, 14)}${escapeHtml(recipe.machine)}${
            recipe.cond ? ` · <span class="cond">${escapeHtml(recipe.cond)}</span>` : ''
          }</div>
        </div>
        ${recipeBadge(recipe)}
      </div>
      <div class="rc-io">
        <div class="chips">${ioChips(recipe.inputs) || '<span class="muted">—</span>'}</div>
        <div class="arrow">→</div>
        <div class="chips">${ioChips(recipe.outputs)}</div>
      </div>
      <div class="rc-meta">${meta}</div>
      <div class="rc-actions">${cardActions(recipe)}</div>
    </div>`;
}

function cardActions(recipe: Recipe): string {
  const make =
    '<button class="btn small" data-act="make" title="Add its main product as a target, made with this recipe">Make this</button>';

  // Game recipes are read-only, so editing one means copying it into your library first.
  if (recipe.src === 'game') {
    return (
      make +
      '<button class="btn small" data-act="copy" title="Copy into My recipes so you can edit it">Copy &amp; edit</button>'
    );
  }
  return (
    make +
    `<button class="btn small" data-act="edit">Edit</button>
     <button class="btn small" data-act="dup">Duplicate</button>
     <button class="btn small danger" data-act="del">Delete</button>`
  );
}

function wireCards(app: App, container: HTMLElement): void {
  for (const element of all('.recipe-card', container)) {
    const recipe = app.store.index.byId.get(element.dataset['id']!);
    if (!recipe) continue;

    for (const button of all<HTMLButtonElement>('[data-act]', element)) {
      button.addEventListener('click', () => {
        runCardAction(app, button.dataset['act']!, recipe);
      });
    }
  }
}

function runCardAction(app: App, action: string, recipe: Recipe): void {
  switch (action) {
    case 'edit':
      app.openRecipeEditor(recipe);
      break;
    case 'copy':
      app.editOrCopy(recipe);
      break;
    case 'dup':
      duplicate(app, recipe);
      break;
    case 'del':
      void deleteRecipe(app, recipe);
      break;
    case 'make':
      makeThis(app, recipe);
      break;
  }
}

function duplicate(app: App, recipe: Recipe): void {
  const copy = deepClone(recipe);
  copy.id = uid('r_');
  copy.name += ' (copy)';
  app.store.state.library.push(copy);
  app.store.markLibraryDirty();
  app.renderStatic();
  app.update();
}

async function deleteRecipe(app: App, recipe: Recipe): Promise<void> {
  const confirmed = await confirmAction({
    title: 'Delete recipe?',
    message: `"${recipe.name}" will be removed from your library and from any plan that uses it.`,
    okLabel: 'Delete',
    danger: true,
  });
  if (!confirmed) return;

  const state = app.store.state;
  state.library = state.library.filter((r) => r.id !== recipe.id);
  // Drop it from every plan too, or those plans would point at a recipe that no longer exists.
  for (const project of state.projects) {
    for (const item of Object.keys(project.choices)) {
      if (project.choices[item] === recipe.id) delete project.choices[item];
    }
  }
  app.store.markLibraryDirty();
  app.renderStatic();
  app.update();
}

/** Target this recipe's main product, pinned to this recipe, and jump to the graph. */
function makeThis(app: App, recipe: Recipe): void {
  const product = recipe.outputs[0];
  if (!product) return;
  app.store.project.choices[product.item] = recipe.id;
  app.addTarget(product.item, 1);
  app.setTab('flow');
  app.closeSettings();
}

export function wireRecipesTab(app: App): void {
  const search = debounce(() => renderRecipes(app), SEARCH_DEBOUNCE_MS);
  need<HTMLInputElement>('#recipeSearch').addEventListener('input', search);

  need<HTMLButtonElement>('#btnNewRecipe').addEventListener('click', () => {
    app.openRecipeEditor(null);
  });

  for (const button of all<HTMLButtonElement>('#recipeSrcSeg button')) {
    button.addEventListener('click', () => {
      app.recipeSource = button.dataset['src'] as RecipeSource;
      renderRecipes(app);
    });
  }
}
