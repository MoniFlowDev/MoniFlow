/**
 * "Made by" — the little control that appears next to any ingredient, showing which recipe the
 * plan uses for it and offering to change it. This is the main way a chain gets built: expand an
 * input, pick a recipe, and its own inputs appear in turn.
 */
import { plural } from '../core/format';
import { escapeHtml } from '../core/html';
import type { ItemKey } from '../core/types';
import type { App } from './app';
import { all } from './dom';
import { machineIcon, recipeBadge } from './badges';

export function choiceControl(app: App, item: ItemKey): string {
  const producers = app.store.producersOf(item);
  if (!producers.length) return '';

  const choice = app.store.currentChoice(item);
  const recipe = choice === 'raw' ? null : app.store.index.byId.get(choice);

  const current = recipe
    ? `${recipeBadge(recipe)} ${machineIcon(recipe, null, 14)}${escapeHtml(recipe.machine)}`
    : `<span class="muted">${plural(producers.length, 'recipe')} available</span>`;

  return `<div class="choice-ctl">
    <span class="cc-cur">${current}</span>
    <button class="link-btn" data-pick="${escapeHtml(item)}">${recipe ? 'Change…' : 'Pick recipe…'}</button>
  </div>`;
}

/** Wire up every choice control inside a freshly rendered container. */
export function bindChoiceControls(app: App, root: ParentNode): void {
  for (const button of all<HTMLButtonElement>('[data-pick]', root)) {
    button.addEventListener('click', (event) => {
      // These sit inside clickable rows, so keep the click from selecting the row too.
      event.stopPropagation();
      app.openPicker(button.dataset['pick']!);
    });
  }
}
