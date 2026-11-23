/** The header: the plan selector, the plan actions, and the rate unit. */
import { escapeHtml } from '../core/html';
import type { RateUnit } from '../core/types';
import { newProject } from '../state/project';
import type { App } from './app';
import { confirmAction, promptText } from './ask';
import { all, need, setActive } from './dom';

export function renderProjectSelect(app: App): void {
  const state = app.store.state;
  need<HTMLSelectElement>('#projectSelect').innerHTML = state.projects
    .map(
      (project) =>
        `<option value="${project.id}" ${project.id === state.activeId ? 'selected' : ''}>${escapeHtml(
          project.name,
        )}</option>`,
    )
    .join('');

  setActive('#unitSeg button', 'unit', state.unit);
}

export function wireTopBar(app: App): void {
  need<HTMLSelectElement>('#projectSelect').addEventListener('change', (event) => {
    app.switchProject((event.target as HTMLSelectElement).value);
  });

  need<HTMLButtonElement>('#btnNewProject').addEventListener('click', async () => {
    const name = await promptText({
      title: 'New plan',
      message: 'What should this plan be called?',
      input: 'New plan',
      okLabel: 'Create',
    });
    if (name == null) return;

    // A new plan inherits the tiers you are building at, which is almost always what you want.
    const current = app.store.project;
    const created = newProject({
      name: name.trim() || 'New plan',
      defaultTier: current.defaultTier,
      gridTier: current.gridTier,
    });
    app.store.state.projects.push(created);
    app.switchProject(created.id);
  });

  need<HTMLButtonElement>('#btnRenameProject').addEventListener('click', async () => {
    const project = app.store.project;
    const name = await promptText({ title: 'Rename plan', input: project.name, okLabel: 'Rename' });
    if (!name?.trim()) return;
    project.name = name.trim();
    renderProjectSelect(app);
    app.store.save();
  });

  need<HTMLButtonElement>('#btnDupProject').addEventListener('click', () => {
    const copy = newProject(app.store.project);
    copy.name = `${app.store.project.name} (copy)`;
    app.store.state.projects.push(copy);
    app.switchProject(copy.id);
  });

  need<HTMLButtonElement>('#btnDeleteProject').addEventListener('click', async () => {
    const project = app.store.project;
    const confirmed = await confirmAction({
      title: 'Delete plan?',
      message: `"${project.name}" will be deleted. Your recipe library is kept.`,
      okLabel: 'Delete',
      danger: true,
    });
    if (!confirmed) return;

    const state = app.store.state;
    state.projects = state.projects.filter((p) => p.id !== project.id);
    // There is always at least one plan.
    if (!state.projects.length) state.projects.push(newProject({ name: 'New plan' }));
    app.switchProject(state.projects[0]!.id);
  });

  for (const button of all<HTMLButtonElement>('#unitSeg button')) {
    button.addEventListener('click', () => {
      app.store.setRateUnit(button.dataset['unit'] as RateUnit);
      // Target rates are entered in the display unit, so those inputs have to be rewritten.
      app.renderStatic();
      app.update();
    });
  }
}
