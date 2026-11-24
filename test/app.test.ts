/** @vitest-environment jsdom */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/svelte';
import { tick } from 'svelte';
import App from '../src/App.svelte';
import { AppModel } from '../src/state/app.svelte';
import { navigate, route } from '../src/router';
import { buildShareUrl } from '../src/state/transfer';
import { attachInteraction } from '../src/graph/interaction';
import { GraphView } from '../src/graph/view';
import sampleExport from './fixtures/sample-export.json';

const disconnect = vi.fn();
beforeAll(() => {
  globalThis.ResizeObserver = class {
    observe(): void {}
    unobserve(): void {}
    disconnect = disconnect;
  };
  HTMLDialogElement.prototype.showModal = function () {
    this.open = true;
  };
  HTMLDialogElement.prototype.close = function () {
    this.open = false;
    this.dispatchEvent(new Event('close'));
  };
  window.scrollTo = vi.fn();
  Element.prototype.scrollIntoView = vi.fn();
});
let app: AppModel;
beforeEach(async () => {
  localStorage.clear();
  await navigate('/', { replace: true });
  app = new AppModel();
  render(App, { model: app });
  await waitFor(() => expect(app.ready).toBe(true));
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

async function openRecipes() {
  await navigate('/settings/recipes');
  await fireEvent.click(await screen.findByRole('button', { name: /^My recipes/ }));
}

describe('reactive planning', () => {
  it('loads the saved example, summary, targets and existing SVG renderer', () => {
    expect(app.project.name).toBe('Polyethylene line');
    expect(app.solution.warnings).toEqual([]);
    expect(screen.getByLabelText('Plan summary').textContent).toContain('Machines to build');
    expect(document.querySelectorAll('#graph .g-node').length).toBeGreaterThan(0);
    expect(screen.getByLabelText('Plan inputs').textContent).toContain('Ethanol');
  });
  it('changes target rate through the input and updates the solution', async () => {
    const input = screen.getByRole('spinbutton', {
      name: 'Target rate for Polyethylene Sheet',
    });
    const before = app.solution.totals.avgEut;
    await fireEvent.input(input, { target: { value: '2' } });
    expect(app.project.targets[0]!.rate).toBe(2);
    expect(app.solution.totals.avgEut).toBeCloseTo(before * 2);
  });
  it('changes display units without resolving the plan', async () => {
    const solution = app.solution;
    const input = screen.getByRole('spinbutton', {
      name: 'Target rate for Polyethylene Sheet',
    }) as HTMLInputElement;
    const previous = Number(input.value);
    await fireEvent.click(screen.getByRole('button', { name: '/min' }));
    expect(Number(input.value)).toBeCloseTo(previous * 60);
    expect(app.solution).toBe(solution);
    expect(document.querySelector('#graph')?.textContent).toContain('/min');
  });
  it('records dragged positions without resolving or redrawing SVG', async () => {
    const solution = app.solution;
    const node = document.querySelector('#graph .g-node');
    app.saveNodePosition(app.solution.steps[0]!.id, { x: 11, y: 22 }, 'lr');
    await tick();
    expect(app.solution).toBe(solution);
    expect(document.querySelector('#graph .g-node')).toBe(node);
    expect(screen.getByRole('button', { name: 'Reset layout (1 moved)' })).toBeDefined();
  });
  it('uses keyboard autocomplete to add a target', async () => {
    const input = screen.getByRole('combobox', {
      name: 'Find an item to make',
    });
    await fireEvent.input(input, { target: { value: 'Steel Plate' } });
    await fireEvent.keyDown(input, { key: 'Enter' });
    expect(app.project.targets.some((t) => t.item === 'Steel Plate')).toBe(true);
  });
  it('supplies an item and restores its chain', async () => {
    const before = app.solution.steps.length;
    app.supplyAsRaw('Ethylene');
    await tick();
    expect(app.solution.steps.length).toBeLessThan(before);
    expect(screen.getByLabelText('Plan inputs').textContent).toContain('chain hidden');
    await fireEvent.click(screen.getByRole('button', { name: 'Show chain' }));
    expect(app.solution.steps.length).toBe(before);
  });
  it('opens the drawer, changes a tier, and closes it', async () => {
    const step = app.solution.steps.find((s) => !s.instant)!;
    app.selectById(step.id);
    await tick();
    const drawer = screen.getByLabelText('Selection details');
    await fireEvent.change(within(drawer).getByLabelText('Tier'), {
      target: { value: '4' },
    });
    expect(app.project.nodes[step.id]?.tier).toBe(4);
    await fireEvent.click(screen.getByRole('button', { name: 'Close details' }));
    expect(screen.queryByLabelText('Selection details')).toBeNull();
  });
  it('opens a picker, ranks recipes and applies a choice', async () => {
    app.openPicker('Sulfuric Acid');
    await tick();
    expect(screen.getByRole('dialog').textContent).toContain(
      'Working out the most efficient recipes',
    );
    await waitFor(() => expect(screen.getByRole('dialog').textContent).toContain('EU/B'));
    await fireEvent.click(screen.getByRole('button', { name: 'Supply as raw instead' }));
    expect(app.project.choices['Sulfuric Acid']).toBe('raw');
    expect(screen.queryByRole('dialog')).toBeNull();
  });
  it('duplicates a reactive plan without sharing nested state', async () => {
    const first = app.project;
    await fireEvent.click(screen.getByRole('button', { name: 'Duplicate' }));
    expect(app.project.name).toBe(`${first.name} (copy)`);
    app.project.targets[0]!.rate = 42;
    expect(first.targets[0]!.rate).not.toBe(42);
    expect(app.selection).toBeNull();
  });
  it('saves existing storage format and reloads it', async () => {
    app.project.name = 'Saved Svelte plan';
    await waitFor(() =>
      expect(JSON.parse(localStorage.getItem('moniflow.v1') ?? '{}').projects?.[0]?.name).toBe(
        'Saved Svelte plan',
      ),
    );
    const loaded = new AppModel();
    expect(loaded.project.name).toBe('Saved Svelte plan');
    loaded.dispose();
  });
});

describe('routing', () => {
  it('renders machines, power and settings using real links', async () => {
    await fireEvent.click(screen.getByRole('link', { name: 'Machines' }));
    expect(await screen.findByText('Build list')).toBeDefined();
    await fireEvent.click(screen.getByRole('link', { name: 'Power' }));
    expect(await screen.findByText('Generators needed')).toBeDefined();
    const solution = app.solution;
    await fireEvent.change(screen.getByLabelText('Generator preset'), {
      target: { value: '1' },
    });
    expect(app.project.gen.preset).toBe(1);
    expect(app.solution).toBe(solution);
    await fireEvent.click(screen.getByRole('link', { name: 'Settings' }));
    expect(await screen.findByText(/Import your game recipes in/)).toBeDefined();
    await fireEvent.click(screen.getByRole('link', { name: /Back to home/ }));
    await waitFor(() => expect(route.pathname).toBe('/'));
  });
  it('preserves the SVG instance when navigating away and back', async () => {
    const svg = document.getElementById('graph');
    const node = svg?.querySelector('.g-node');
    await navigate('/settings/recipes');
    await navigate('/');
    expect(document.getElementById('graph')).toBe(svg);
    expect(svg?.querySelector('.g-node')).toBe(node);
  });
  it('handles browser back and forward', async () => {
    await navigate('/machines');
    await navigate('/power');
    history.back();
    await waitFor(() => expect(route.pathname).toBe('/machines'));
    history.forward();
    await waitFor(() => expect(route.pathname).toBe('/power'));
  });
  it('handles an unknown route', async () => {
    // Exercise the browser URL rather than bypassing typed navigation with a cast.
    history.pushState(null, '', '/missing-page');
    window.dispatchEvent(new PopStateEvent('popstate'));
    expect(await screen.findByRole('heading', { name: 'Page not found' })).toBeDefined();
  });
  it('opens an existing share hash on a routed page exactly once', async () => {
    await navigate('/settings/recipes');
    const url = buildShareUrl(JSON.parse(JSON.stringify(app.project)), app.state.library);
    const count = app.state.projects.length;
    history.replaceState(null, '', url);
    window.dispatchEvent(new Event('hashchange'));
    await tick();
    expect(app.state.projects.length).toBe(count + 1);
    expect(location.hash).toBe('');
    window.dispatchEvent(new Event('hashchange'));
    expect(app.state.projects.length).toBe(count + 1);
  });
});

describe('game imports', () => {
  it('imports an export through settings, refreshes search and removes the game data', async () => {
    await navigate('/settings/recipes');
    const file = {
      name: 'sample-export.json',
      text: async () => JSON.stringify(sampleExport),
    } as File;
    await fireEvent.change(screen.getByLabelText('Import game recipes'), {
      target: { files: [file] },
    });
    await waitFor(() => expect(app.gameData?.recipes).toHaveLength(13));
    await waitFor(() =>
      expect(screen.getByRole('dialog').textContent).toContain('Remove the example recipes?'),
    );
    await fireEvent.click(
      within(screen.getByRole('dialog')).getByRole('button', {
        name: 'Cancel',
      }),
    );
    expect(
      app.catalog.search('Steel Ingot').some((entry) => entry.key === 'gtceu:steel_ingot'),
    ).toBe(true);
    await navigate('/settings/icons');
    expect(await screen.findByRole('button', { name: 'Build icons' })).toBeDefined();
    await navigate('/settings/recipes');
    await fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
    await fireEvent.click(
      within(screen.getByRole('dialog')).getByRole('button', {
        name: 'Remove',
      }),
    );
    await waitFor(() => expect(app.gameData).toBeNull());
  });
  it('leaves existing state intact after an invalid game import', async () => {
    const index = app.index;
    await app.importGame({
      name: 'bad.json',
      text: async () => '{invalid',
    } as File);
    expect(app.gameData).toBeNull();
    expect(app.index).toBe(index);
    expect(app.toast.length).toBeGreaterThan(0);
  });
});

describe('recipe library', () => {
  it('renders recipes and edits a local draft only after save', async () => {
    await openRecipes();
    const first = app.state.library[0]!;
    const name = first.name;
    await fireEvent.click(screen.getAllByRole('button', { name: 'Edit' })[0]!);
    const dialog = screen.getByRole('dialog');
    await fireEvent.input(within(dialog).getByLabelText('Name', { exact: true }), {
      target: { value: 'Draft name' },
    });
    expect(app.state.library[0]!.name).toBe(name);
    await fireEvent.click(within(dialog).getByRole('button', { name: 'Save recipe' }));
    expect(app.state.library[0]!.name).toBe('Draft name');
  });
  it('cancels a draft and duplicate recipe changes independently', async () => {
    await openRecipes();
    const name = app.state.library[0]!.name;
    await fireEvent.click(screen.getAllByRole('button', { name: 'Edit' })[0]!);
    await fireEvent.input(screen.getByLabelText('Name', { exact: true }), {
      target: { value: 'Unsaved' },
    });
    await fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(app.state.library[0]!.name).toBe(name);
    const count = app.state.library.length;
    const card = document.querySelector('article')!;
    await fireEvent.click(within(card).getByRole('button', { name: 'Duplicate' }));
    expect(app.state.library.length).toBe(count + 1);
  });
  it('updates fuzzy search after edits without a manual dirty flag', async () => {
    await openRecipes();
    app.state.library[0]!.name = 'Zebra Quantum Processing';
    await fireEvent.input(screen.getByRole('searchbox', { name: 'Search recipes' }), {
      target: { value: 'zbr qntm' },
    });
    await waitFor(() => expect(document.querySelectorAll('article')).toHaveLength(1));
    expect(document.querySelector('article')?.textContent).toContain('Zebra Quantum Processing');
  });
  it('makes a recipe and navigates home', async () => {
    await openRecipes();
    await fireEvent.click(screen.getAllByRole('button', { name: 'Make this' })[0]!);
    await waitFor(() => expect(route.pathname).toBe('/'));
    expect(app.project.choices[app.state.library[0]!.outputs[0]!.item]).toBe(
      app.state.library[0]!.id,
    );
  });
});

it('detaches graph listeners, frame work and resize observer', () => {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  const view = new GraphView();
  const zoom = vi.spyOn(view, 'zoomAt');
  const dispose = attachInteraction(view, svg, null);
  svg.dispatchEvent(new WheelEvent('wheel', { deltaY: 10 }));
  expect(zoom).toHaveBeenCalledTimes(1);
  dispose();
  svg.dispatchEvent(new WheelEvent('wheel', { deltaY: 10 }));
  expect(zoom).toHaveBeenCalledTimes(1);
  expect(disconnect).toHaveBeenCalled();
});
