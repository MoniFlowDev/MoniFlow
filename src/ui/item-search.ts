/**
 * Autocomplete over every item the app knows.
 *
 * There can be tens of thousands, so the list is capped and ordered by match quality rather than
 * alphabetically — a prefix match beats a match in the middle, and (where it matters) something
 * with a recipe beats something without one.
 */
import { plural } from '../core/format';
import { itemNameHtml } from '../core/item-names';
import type { ItemKey } from '../core/types';
import type { CatalogEntry } from '../state/item-catalog';
import type { App } from './app';
import { itemDot } from './badges';

/** How long after blur to hide the list, so a click on it still registers. */
const BLUR_DELAY_MS = 150;

export interface ItemSearchOptions {
  /** Rank items with a recipe above items without one. */
  preferMakeable?: boolean;
  /** Accept whatever was typed on Enter, even with nothing selected. */
  allowFree?: boolean;
}

export function attachItemSearch(
  app: App,
  input: HTMLInputElement,
  onPick: (key: ItemKey) => void,
  options: ItemSearchOptions = {},
): void {
  const wrapper = input.parentElement;
  if (!wrapper) return;
  wrapper.classList.add('ac-wrap');

  const list = document.createElement('div');
  list.className = 'ac-list';
  list.hidden = true;
  wrapper.appendChild(list);

  let results: CatalogEntry[] = [];
  let highlighted = -1;

  const draw = (): void => {
    list.innerHTML = results.length
      ? results.map((entry, i) => row(app, entry, i, i === highlighted)).join('')
      : emptyMessage(app);
    list.hidden = false;
    list.querySelector('.sel')?.scrollIntoView({ block: 'nearest' });
  };

  const choose = (key: ItemKey): void => {
    list.hidden = true;
    input.value = '';
    results = [];
    onPick(key);
  };

  input.addEventListener('input', () => {
    const query = input.value.trim().toLowerCase();
    if (!query) {
      list.hidden = true;
      results = [];
      return;
    }
    results = app.store.catalog.search(query, { preferMakeable: options.preferMakeable });
    highlighted = results.length ? 0 : -1;
    draw();
  });

  input.addEventListener('keydown', (event) => {
    if (list.hidden) return;

    if (event.key === 'ArrowDown') {
      highlighted = Math.min(results.length - 1, highlighted + 1);
      draw();
      event.preventDefault();
    } else if (event.key === 'ArrowUp') {
      highlighted = Math.max(0, highlighted - 1);
      draw();
      event.preventDefault();
    } else if (event.key === 'Enter') {
      event.preventDefault();
      if (highlighted >= 0) choose(results[highlighted]!.key);
      else if (options.allowFree && input.value.trim()) choose(app.store.keyFromText(input.value));
    } else if (event.key === 'Escape') {
      list.hidden = true;
    }
  });

  // mousedown rather than click, so the choice lands before the input loses focus.
  list.addEventListener('mousedown', (event) => {
    const item = (event.target as Element).closest<HTMLElement>('.ac-item');
    if (!item) return;
    event.preventDefault();
    choose(results[Number(item.dataset['i'])]!.key);
  });

  input.addEventListener('blur', () => {
    setTimeout(() => {
      list.hidden = true;
    }, BLUR_DELAY_MS);
  });
}

function row(app: App, entry: CatalogEntry, index: number, selected: boolean): string {
  // An item with no colon in its key came from one of your own recipes, not the game.
  const origin = entry.key.includes(':') ? '' : 'my item · ';
  const recipes = entry.makeable
    ? plural(app.store.index.producers.get(entry.key)!.length, 'recipe')
    : 'no recipe';

  return `<div class="ac-item${selected ? ' sel' : ''}" data-i="${index}">
    ${itemDot(entry.key, entry.fluid)}<span class="ac-name">${itemNameHtml(entry.key)}</span>
    <span class="ac-meta">${origin}${recipes}</span>
  </div>`;
}

function emptyMessage(app: App): string {
  const hint = app.store.gameData
    ? ''
    : ' — import game recipes in Settings to search everything';
  return `<div class="ac-empty">No matching items${hint}</div>`;
}
