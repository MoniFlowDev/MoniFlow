/** The side panel for an item: its rates in this plan, who makes it, who uses it. */
import { formatNumber, formatRate } from '../../core/format';
import { escapeHtml } from '../../core/html';
import { itemName, itemNameHtml } from '../../core/item-names';
import type { ItemKey } from '../../core/types';
import { stepTitleHtml } from '../../solver/step-title';
import type { SolvedStep } from '../../solver/solve';
import type { App } from '../app';
import { itemDot } from '../badges';
import { bindChoiceControls, choiceControl } from '../choice-control';
import { all } from '../dom';

export type ItemKind = 'raw' | 'out' | 'sur';

const KIND_LABELS: Record<ItemKind, string> = {
  raw: 'Raw input',
  out: 'Target',
  sur: 'Byproduct',
};

const SECONDS_PER_HOUR = 3600;
const MB_PER_BUCKET = 1000;
const ITEMS_PER_STACK = 64;

export function itemDrawerHtml(app: App, item: ItemKey, kind: ItemKind): string {
  const { store } = app;
  const solution = store.solution;
  const fluid = store.isFluid(item);

  const raw = solution.raw.find((r) => r.item === item);
  const surplus = solution.surplus.find((r) => r.item === item);
  const target = solution.targets.find((t) => t.item === item);

  const producers = solution.steps.filter((step) =>
    step.recipe.outputs.some((o) => o.item === item),
  );
  const consumers = solution.steps.filter((step) =>
    step.recipe.inputs.some((i) => i.item === item),
  );

  // Show the raw id too, but only when it is not simply the name already.
  const idNote = item !== itemName(item) ? ` · <span class="muted">${escapeHtml(item)}</span>` : '';

  return `
    <h2 class="d-title">${itemDot(item, fluid, 'chip-dot')} ${itemNameHtml(item)}</h2>
    <div class="d-sub">${KIND_LABELS[kind]}${fluid ? ' · fluid' : ' · item'}${idNote}</div>
    <dl class="kv">
      ${target ? `<dt>Target rate</dt><dd>${formatRate(target.rate, fluid)}</dd>` : ''}
      ${raw ? `<dt>You must supply</dt><dd>${formatRate(raw.rate, fluid)}</dd>` : ''}
      ${surplus ? `<dt>Left over</dt><dd>${formatRate(surplus.rate, fluid)}</dd>` : ''}
      ${raw ? bulkRow(raw.rate, fluid) : ''}
    </dl>
    ${
      store.producersOf(item).length
        ? `<div class="d-section"><h3>Made by</h3>${choiceControl(app, item)}</div>`
        : ''
    }
    ${
      producers.length
        ? `<div class="d-section"><h3>Produced in this plan by</h3>${producers
            .map(
              (step) =>
                `<div class="muted">• ${stepTitleHtml(step)} <span class="muted">(${escapeHtml(
                  step.recipe.machine,
                )})</span></div>`,
            )
            .join('')}</div>`
        : ''
    }
    ${
      consumers.length
        ? `<div class="d-section"><h3>Used by</h3>${consumers
            .map((step) => consumerRow(step, item, fluid))
            .join('')}</div>`
        : ''
    }
    ${itemActions(app, item, !!target)}`;
}

/** The practical version of a raw rate: buckets or stacks per hour. */
function bulkRow(ratePerSecond: number, fluid: boolean): string {
  const perHour = ratePerSecond * SECONDS_PER_HOUR;
  return fluid
    ? `<dt>Buckets per hour</dt><dd>${formatNumber(perHour / MB_PER_BUCKET)}</dd>`
    : `<dt>Stacks per hour</dt><dd>${formatNumber(perHour / ITEMS_PER_STACK)}</dd>`;
}

function consumerRow(step: SolvedStep, item: ItemKey, fluid: boolean): string {
  const perSecond =
    step.recipe.inputs
      .filter((input) => input.item === item)
      .reduce((sum, input) => sum + (Number(input.amount) || 0), 0) * step.rate;

  return `<div style="display:flex;justify-content:space-between">
    <span>${stepTitleHtml(step)}</span>
    <span class="num muted">${formatRate(perSecond, fluid)}</span>
  </div>`;
}

function itemActions(app: App, item: ItemKey, isTarget: boolean): string {
  const suppliedByYou =
    app.store.project.choices[item] === 'raw' && app.store.producersOf(item).length > 0;

  return `
    <div class="d-section" style="display:flex;gap:8px;flex-wrap:wrap">
      ${suppliedByYou ? '<button class="btn small primary" data-act="show">Show its chain again</button>' : ''}
      ${!isTarget ? '<button class="btn small" data-act="target">Make it a target</button>' : ''}
      <button class="btn small" data-act="newrecipe">＋ New recipe for this</button>
    </div>`;
}

export function bindItemDrawer(app: App, body: HTMLElement, item: ItemKey): void {
  bindChoiceControls(app, body);
  for (const button of all<HTMLButtonElement>('[data-act]', body)) {
    button.addEventListener('click', () => runItemAction(app, button.dataset['act']!, item));
  }
}

function runItemAction(app: App, action: string, item: ItemKey): void {
  if (action === 'target') {
    app.addTarget(item, 1);
  } else if (action === 'show') {
    app.store.select(null);
    app.showChain(item);
  } else if (action === 'newrecipe') {
    app.openRecipeEditor(null, {
      name: itemName(item),
      outputs: [{ item, amount: 1, fluid: app.store.isFluid(item) }],
    });
  }
}
