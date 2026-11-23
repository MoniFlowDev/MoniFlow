/** The Settings area: a sidebar of pages (Icons, Recipes) shown in place of the main layout. */
import type { App } from './app';
import { all, need, setActive } from './dom';
import { renderGameDataPanel, renderIconPanel } from './game-panel';
import { renderRecipes } from './recipes-tab';

export type SettingsPage = 'icons' | 'recipes';

export function wireSettings(app: App): void {
  need<HTMLButtonElement>('#btnSettings').addEventListener('click', () => app.toggleSettings());
  need<HTMLButtonElement>('#btnSettingsHome').addEventListener('click', () => app.closeSettings());

  for (const button of all<HTMLButtonElement>('#settingsNav button')) {
    button.addEventListener('click', () => app.setSettingsPage(button.dataset['page'] as SettingsPage));
  }
}

export function applySettingsVisibility(app: App): void {
  need('#settingsLayout').hidden = !app.settingsOpen;
  need('#mainLayout').hidden = app.settingsOpen;
  if (app.settingsOpen) renderSettingsPage(app);
}

export function renderSettingsPage(app: App): void {
  setActive('#settingsNav button', 'page', app.settingsPage);
  for (const panel of all('#settingsLayout .tab-panel')) {
    panel.classList.toggle('active', panel.id === `settings-${app.settingsPage}`);
  }
  if (app.settingsPage === 'icons') {
    renderIconPanel(app);
  } else {
    renderGameDataPanel(app);
    renderRecipes(app);
  }
}
