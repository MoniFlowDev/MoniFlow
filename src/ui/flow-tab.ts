/** The flow graph tab: the graph itself plus its toolbar. */
import type { GraphDirection, Point } from '../core/types';
import { DEFAULT_DIRECTION, isDirection } from '../graph/directions';
import { attachInteraction } from '../graph/interaction';
import type { App } from './app';
import { all, download, need, setActive, slugify } from './dom';
import { toast } from './toast';

const ZOOM_IN = 1.25;
const ZOOM_OUT = 0.8;

export function renderFlow(app: App): void {
  const project = app.store.project;
  const hasGraph = app.graph.render(app.store.solution, project);
  need('#graphEmpty').hidden = hasGraph;

  const dir = project.graphDir ?? DEFAULT_DIRECTION;
  setActive('#dirSeg button', 'dir', dir);
  updateResetLayoutButton(app);
}

/** The reset button doubles as the indicator that nodes have been moved by hand. */
function updateResetLayoutButton(app: App): void {
  const project = app.store.project;
  const dir = project.graphDir ?? DEFAULT_DIRECTION;
  const moved = Object.keys(project.graphPos?.[dir] ?? {}).length;

  const button = need<HTMLButtonElement>('#btnResetLayout');
  button.disabled = !moved;
  button.textContent = moved ? `Reset layout (${moved} moved)` : 'Reset layout';
}

/** Remember where a node was dragged to, per plan and per flow direction. */
function saveNodePosition(app: App, id: string, position: Point, dir: GraphDirection): void {
  const project = app.store.project;
  project.graphPos ??= {};
  project.graphPos[dir] ??= {};
  project.graphPos[dir]![id] = { x: Math.round(position.x), y: Math.round(position.y) };

  updateResetLayoutButton(app);
  app.store.save();
}

export function wireFlowTab(app: App): void {
  const svg = need<SVGSVGElement>('#graph');

  app.graph.attach(svg, {
    onSelect: (id) => app.selectById(id),
    onAction: (action, argument) => runNodeAction(app, action, argument),
    onMove: (id, position, dir) => saveNodePosition(app, id, position, dir),
  });
  attachInteraction(app.graph, svg, need<HTMLElement>('#graphTip'));

  for (const button of all<HTMLButtonElement>('#dirSeg button')) {
    button.addEventListener('click', () => {
      const dir = button.dataset['dir'];
      if (!isDirection(dir)) return;
      app.store.project.graphDir = dir;
      renderFlow(app);
      app.store.save();
    });
  }

  need<HTMLButtonElement>('#btnResetLayout').addEventListener('click', () => {
    const project = app.store.project;
    delete project.graphPos?.[project.graphDir ?? DEFAULT_DIRECTION];
    // The layout changes shape, so let the view re-fit.
    app.graph.resetViewMemory();
    renderFlow(app);
    app.store.save();
  });

  need<HTMLButtonElement>('#btnFit').addEventListener('click', () => app.graph.fit());
  need<HTMLButtonElement>('#btnZoomIn').addEventListener('click', () => app.graph.zoomBy(ZOOM_IN));
  need<HTMLButtonElement>('#btnZoomOut').addEventListener('click', () => app.graph.zoomBy(ZOOM_OUT));

  const compact = need<HTMLInputElement>('#graphStubs');
  app.graph.stubs = app.store.state.graphStubs !== false;
  compact.checked = app.graph.stubs;
  compact.addEventListener('change', () => {
    app.store.state.graphStubs = compact.checked;
    app.graph.stubs = compact.checked;
    app.graph.resetViewMemory();
    renderFlow(app);
    app.store.save();
  });

  const allRates = need<HTMLInputElement>('#showLabels');
  allRates.checked = !!app.store.state.alwaysRates;
  app.graph.setLabels(allRates.checked);
  allRates.addEventListener('change', () => {
    app.store.state.alwaysRates = allRates.checked;
    app.graph.setLabels(allRates.checked);
    app.store.save();
  });

  need<HTMLButtonElement>('#btnSvg').addEventListener('click', () => {
    const svgText = app.graph.exportSvg();
    if (!svgText) {
      toast('Nothing to export yet');
      return;
    }
    download(`${slugify(app.store.project.name)}.svg`, svgText, 'image/svg+xml');
  });
}

/** The buttons drawn on the nodes themselves. */
function runNodeAction(app: App, action: string, argument: string): void {
  if (action === 'hide') app.hideChain(argument);
  else if (action === 'expand') app.showChain(argument);
  else if (action === 'pick') app.openPicker(argument);
}
