import { getContext, setContext } from 'svelte';
import type { AppModel } from './app.svelte';
const APP = Symbol('moniflow');
export function provideApp(app: AppModel): AppModel {
  setContext(APP, app);
  return app;
}
export function useApp(): AppModel {
  return getContext<AppModel>(APP);
}
