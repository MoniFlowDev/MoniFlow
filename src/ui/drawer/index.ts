/** The side drawer, showing whichever step or item is selected. */
import type { App } from '../app';
import { need } from '../dom';
import { bindItemDrawer, itemDrawerHtml } from './item-drawer';
import { bindStepDrawer, stepDrawerHtml } from './step-drawer';

export function renderDrawer(app: App): void {
  const drawer = need('#drawer');
  const body = need('#drawerBody');
  const selection = app.store.selection;

  if (!selection) {
    drawer.hidden = true;
    return;
  }

  if (selection.type === 'item') {
    drawer.hidden = false;
    body.innerHTML = itemDrawerHtml(app, selection.item, selection.kind);
    bindItemDrawer(app, body, selection.item);
    return;
  }

  const step = app.store.solution.steps.find((s) => s.id === selection.id);
  // The step is gone — a recipe changed, or the plan no longer needs it.
  if (!step) {
    app.store.select(null);
    drawer.hidden = true;
    app.graph.highlight(null);
    return;
  }

  drawer.hidden = false;
  body.innerHTML = stepDrawerHtml(app, step);
  bindStepDrawer(app, body, step);
}
