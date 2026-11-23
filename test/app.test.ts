/**
 * @vitest-environment jsdom
 *
 * A smoke test over the whole UI, run against the real `index.html`.
 *
 * None of the view code is worth unit-testing in isolation — it is markup assembly — but the
 * wiring between it and the markup very much is: a renamed element id or a missing handler is
 * invisible until something is clicked. This boots the app for real and exercises the paths that
 * touch the most of it.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { App } from '../src/ui/app';

// Under jsdom `import.meta.url` is not a file URL, so resolve from the project root instead.
const html = readFileSync(resolve(process.cwd(), 'index.html'), 'utf8');

/** The markup inside `<body>`, which is all the app needs. */
function bodyMarkup(): string {
  const match = /<body>([\s\S]*)<\/body>/.exec(html);
  if (!match) throw new Error('index.html has no <body>');
  // The module script tag would try to load TypeScript; the test imports App directly instead.
  return match[1]!.replace(/<script[\s\S]*?<\/script>/g, '');
}

beforeAll(() => {
  // jsdom has neither of these, and the graph view observes its own size.
  globalThis.ResizeObserver = class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  };
  // `<dialog>` modality is not implemented, and the picker opens one.
  HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) {
    this.open = true;
  };
  HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement) {
    this.open = false;
    this.dispatchEvent(new Event('close'));
  };
});

let app: App;

beforeEach(() => {
  localStorage.clear();
  document.body.innerHTML = bodyMarkup();
  app = new App();
  app.start();
});

const $ = <T extends Element = HTMLElement>(selector: string): T => {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`missing ${selector}`);
  return element;
};

describe('booting the app', () => {
  it('starts on the example plan and draws it', () => {
    // The starter plan makes one polyethylene sheet per second.
    expect(app.store.project.name).toBe('Polyethylene line');
    expect(app.store.solution.steps.length).toBeGreaterThan(0);
    expect(app.store.solution.warnings).toEqual([]);
  });

  it('fills in the summary', () => {
    const summary = $('#summary');
    expect(summary.querySelectorAll('.stat')).toHaveLength(5);
    expect(summary.textContent).toContain('Machines to build');
  });

  it('draws the graph rather than the empty state', () => {
    expect($('#graphEmpty').hidden).toBe(true);
    expect($('#graph').querySelectorAll('.g-node').length).toBeGreaterThan(0);
  });

  it('lists the targets and the raw inputs it needs', () => {
    expect($('#targetList').textContent).toContain('Polyethylene Sheet');
    expect($('#rawList').textContent).toContain('Ethanol');
  });
});

describe('the tabs', () => {
  it('fills the machines tab with a build list and a row per step', () => {
    app.setTab('machines');
    const view = $('#machinesView');
    expect(view.querySelectorAll('.build-card').length).toBeGreaterThan(0);
    expect(view.querySelectorAll('tbody tr').length).toBe(app.store.solution.steps.length);
  });

  it('fills the power tab', () => {
    app.setTab('power');
    const view = $('#powerView');
    expect(view.textContent).toContain('Average draw');
    expect(view.querySelectorAll('.bar-row').length).toBeGreaterThan(0);
  });

  it('lists your own recipes in the recipes tab', () => {
    app.setTab('recipes');
    expect($('#recipeList').querySelectorAll('.recipe-card').length).toBeGreaterThan(0);
    expect($('#gamePanel').textContent).toContain('Use the real recipes from your game');
  });
});

describe('selecting a step', () => {
  it('opens the drawer with its machine setup', () => {
    const step = app.store.solution.steps[0]!;
    app.selectById(step.id);

    expect($('#drawer').hidden).toBe(false);
    const body = $('#drawerBody');
    expect(body.textContent).toContain('Machine setup');
    expect(body.querySelector('#dTier')).not.toBeNull();
  });

  it('changes the tier from the drawer', () => {
    const step = app.store.solution.steps.find((s) => !s.instant)!;
    app.selectById(step.id);

    const tier = $<HTMLSelectElement>('#dTier');
    tier.value = '4';
    tier.dispatchEvent(new Event('change'));

    expect(app.store.project.nodes[step.id]?.tier).toBe(4);
  });

  it('closes the drawer again', () => {
    app.selectById(app.store.solution.steps[0]!.id);
    $<HTMLButtonElement>('#drawerClose').click();
    expect($('#drawer').hidden).toBe(true);
  });
});

describe('editing the plan', () => {
  it('adds a target', () => {
    app.addTarget('Steel Plate', 2);
    expect(app.store.project.targets.map((t) => t.item)).toContain('Steel Plate');
    expect($('#targetList').textContent).toContain('Steel Plate');
  });

  it('supplies an item as raw and hides its chain', () => {
    const before = app.store.solution.steps.length;
    app.supplyAsRaw('Ethylene');

    expect(app.store.project.choices['Ethylene']).toBe('raw');
    expect(app.store.solution.steps.length).toBeLessThan(before);
    expect($('#rawList').textContent).toContain('chain hidden');
  });

  it('brings a hidden chain back', () => {
    app.supplyAsRaw('Ethylene');
    const hidden = app.store.solution.steps.length;
    app.showChain('Ethylene');

    expect(app.store.project.choices['Ethylene']).toBeUndefined();
    expect(app.store.solution.steps.length).toBeGreaterThan(hidden);
  });

  it('switches the rate unit and rewrites the target input', () => {
    const perSecond = Number($<HTMLInputElement>('.t-rate').value);
    $<HTMLButtonElement>('#unitSeg button[data-unit="min"]').click();

    expect(Number($<HTMLInputElement>('.t-rate').value)).toBeCloseTo(perSecond * 60, 6);
    expect($('#targetList').textContent).toContain('/min');
  });
});

describe('the recipe picker', () => {
  it('lists the ways to make an item, best first', () => {
    app.openPicker('Sulfuric Acid');
    expect($<HTMLDialogElement>('#pickDialog').open).toBe(true);
    // The list is filled a tick later, so the dialog can paint first.
    expect($('#pickList').textContent).toContain('Working out the most efficient recipes');
  });
});

describe('plans', () => {
  it('creates a second plan and switches to it', () => {
    const first = app.store.project.id;
    app.store.state.projects.push({ ...app.store.project, id: 'p_other', name: 'Second' });
    app.switchProject('p_other');

    expect(app.store.project.name).toBe('Second');
    expect(app.store.state.activeId).not.toBe(first);
    expect($<HTMLSelectElement>('#projectSelect').value).toBe('p_other');
  });
});
