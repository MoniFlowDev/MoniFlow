import { createRouter } from 'sv-router';
import Flow from './pages/Flow.svelte';
import Machines from './pages/Machines.svelte';
import Power from './pages/Power.svelte';
import Icons from './pages/Icons.svelte';
import NotFound from './pages/NotFound.svelte';

export const { navigate, route, p } = createRouter(
  {
    '/': Flow,
    '/machines': Machines,
    '/power': Power,
    '/settings': {
      '/': Icons,
      '/icons': Icons,
      '/recipes': () => import('./pages/Recipes.svelte'),
    },
    '*notfound': NotFound,
  },
  { base: import.meta.env.BASE_URL.replace(/\/$/, '') },
);
