<script lang="ts">
  import { onMount, untrack } from 'svelte';
  import { Router } from 'sv-router';
  import { route, p } from './router';
  import { AppModel } from './state/app.svelte';
  import { provideApp } from './state/context';
  import { icons } from './icons/icon-store';
  import { clearLineColorCache } from './icons/line-color';
  import Header from './components/Header.svelte';
  import Sidebar from './components/Sidebar.svelte';
  import Summary from './components/Summary.svelte';
  import FlowGraph from './components/FlowGraph.svelte';
  import Drawer from './components/Drawer.svelte';
  import AskDialog from './components/AskDialog.svelte';
  import RecipePicker from './components/RecipePicker.svelte';
  import RecipeEditor from './components/RecipeEditor.svelte';
  import IconDialog from './components/IconDialog.svelte';
  let { model = new AppModel() }: { model?: AppModel } = $props();
  // App owns the instance for its entire mount; descendants share it through context.
  const app = provideApp(untrack(() => model));
  const settings = $derived(route.pathname.startsWith('/settings'));
  const flow = $derived(route.pathname === '/');
  onMount(() => {
    const unsubscribe = icons.onChange(() => {
      clearLineColorCache();
      app.iconRevision++;
    });
    void app.start();
    return () => {
      unsubscribe();
      app.dispose();
    };
  });
  $effect(() => {
    if (app.ready) app.persist();
  });
  function escape(event: KeyboardEvent) {
    if (event.key === 'Escape' && !app.askRequest && !app.picker && !app.editor && !app.iconDialog)
      app.selection = null;
  }
</script>

<svelte:window
  onkeydown={escape}
  onhashchange={() => app.ready && app.openSharedPlan()}
/>
<div class="app-shell">
  <Header />
  <div class="layout">
    {#if settings}
      <aside class="sidebar">
        <section class="panel">
          <a
            class="btn btn-ghost"
            href={p('/')}
            >← Back to home</a
          >
        </section>
        <section class="panel">
          <div class="panel-head"><h2>Settings</h2></div>
          <nav
            class="settings-nav"
            aria-label="Settings"
          >
            <a
              class:active={route.pathname !== '/settings/recipes'}
              href={p('/settings/icons')}
            >
              Icons
            </a><a
              class:active={route.pathname === '/settings/recipes'}
              href={p('/settings/recipes')}
            >
              Recipes
            </a>
          </nav>
        </section>
      </aside>
    {:else}
      <Sidebar />
    {/if}
    <main class="main">
      {#if !settings}
        <Summary />
        <nav
          class="tabs"
          aria-label="Plan views"
        >
          {#each [
            ['/', 'Flow graph'],
            ['/machines', 'Machines'],
            ['/power', 'Power'],
          ] as [path, label]}
            <a
              href={p(path as '/' | '/machines' | '/power')}
              aria-current={route.pathname === path ? 'page' : undefined}
            >
              {label}
            </a>
          {/each}
        </nav>
      {/if}
      <FlowGraph active={flow} />
      <div
        class="min-h-0 flex-1 overflow-y-auto"
        hidden={flow}
      >
        <Router />
      </div>
    </main>
    {#if !settings}
      <Drawer />
    {/if}
  </div>
</div>
{#if app.picker}
  {#key `${app.picker.projectId}:${app.picker.item}`}
    <RecipePicker item={app.picker.item} />
  {/key}
{/if}
{#if app.editor}
  {#key app.editor}
    <RecipeEditor session={app.editor} />
  {/key}
{/if}
{#if app.iconDialog}
  <IconDialog />
{/if}
{#if app.askRequest}
  {#key app.askRequest}
    <AskDialog request={app.askRequest} />
  {/key}
{/if}
{#if app.toast}
  <div
    class="fixed bottom-5 left-1/2 z-50 max-w-[90vw] -translate-x-1/2 rounded-lg border border-line bg-raised px-5 py-3 text-sm shadow-xl"
    role="status"
  >
    {app.toast}
  </div>
{/if}
