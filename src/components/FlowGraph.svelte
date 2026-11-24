<script lang="ts">
  import { onMount, untrack } from 'svelte';
  import { GraphView } from '../graph/view';
  import { attachInteraction } from '../graph/interaction';
  import { setRateUnit, setFluidUnitMode } from '../core/format';
  import { download, slugify } from '../state/files';
  import { useApp } from '../state/context';
  import type { GraphDirection } from '../core/types';

  let { active }: { active: boolean } = $props();
  const app = useApp();
  const view = new GraphView();
  let svg: SVGSVGElement;
  let tip: HTMLDivElement;
  let mounted = $state(false);
  let hasGraph = $state(false);
  let previousProject = '';
  const direction = $derived(app.project.graphDir ?? 'lr');
  const moved = $derived(Object.keys(app.project.graphPos?.[direction] ?? {}).length);

  onMount(() => {
    view.attach(svg, {
      onSelect: (id) => app.selectById(id),
      onMove: (id, point, dir) => app.saveNodePosition(id, point, dir),
      onAction: (action, item) => {
        if (action === 'hide') app.hideChain(item);
        if (action === 'expand') app.showChain(item);
        if (action === 'pick') app.openPicker(item);
      },
    });
    const dispose = attachInteraction(view, svg, tip);
    mounted = true;
    return dispose;
  });

  $effect(() => {
    if (!mounted) return;
    // Capture only inputs requiring a redraw. Pinned positions are read untracked because
    // dragging already moved the live SVG; recording that position must not redraw it again.
    const solution = app.solution;
    const projectId = app.project.id;
    direction;
    app.layoutRevision;
    app.iconRevision;
    const stubs = app.state.graphStubs !== false;
    const unit = app.state.unit;
    const fluidUnits = app.state.fluidUnits ?? 'auto';
    untrack(() => {
      setRateUnit(unit);
      setFluidUnitMode(fluidUnits);
      if (previousProject !== projectId) {
        view.resetViewMemory();
        previousProject = projectId;
      }
      if (view.stubs !== stubs) view.resetViewMemory();
      view.stubs = stubs;
      hasGraph = view.render(solution, $state.snapshot(app.project));
    });
  });

  $effect(() => {
    if (mounted) view.setLabels(!!app.state.alwaysRates);
  });

  $effect(() => {
    if (!mounted) return;
    const id = app.selectedId;
    const visible = active;
    untrack(() => {
      view.highlight(id);
      if (visible && id) view.ensureVisible(id);
    });
  });

  $effect(() => {
    if (!mounted || !active) return;
    const frame = requestAnimationFrame(() => view.onResize());
    return () => cancelAnimationFrame(frame);
  });

  function exportSvg() {
    const content = view.exportSvg();
    if (content) download(`${slugify(app.project.name)}.svg`, content, 'image/svg+xml');
    else app.notify('Nothing to export yet');
  }
</script>

<div
  class="graph-wrap"
  hidden={!active}
>
  <svg
    bind:this={svg}
    id="graph"
    xmlns="http://www.w3.org/2000/svg"
    aria-label="Recipe flow diagram"
  ></svg>
  <div
    class="graph-tip"
    bind:this={tip}
    hidden
  ></div>
  <div class="graph-tools">
    <div class="seg seg-small">
      {#each [
        ['lr', '→', 'Left to right'],
        ['tb', '↓', 'Top to bottom'],
        ['bt', '↑', 'Bottom to top'],
      ] as [dir, label, title]}
        <button
          class:active={direction === dir}
          {title}
          aria-label={title}
          onclick={() => (app.project.graphDir = dir as GraphDirection)}
        >
          {label}
        </button>
      {/each}
    </div>
    <button
      class="btn btn-small"
      disabled={!moved}
      onclick={() => {
        app.resetLayout();
        view.resetViewMemory();
      }}
    >
      Reset layout{moved ? ` (${moved} moved)` : ''}
    </button>
    <button
      class="btn btn-small"
      onclick={() => view.fit()}
    >
      Fit
    </button>
    <button
      class="btn btn-small"
      aria-label="Zoom in"
      onclick={() => view.zoomBy(1.25)}
    >
      ＋
    </button>
    <button
      class="btn btn-small"
      aria-label="Zoom out"
      onclick={() => view.zoomBy(0.8)}
    >
      −
    </button>
    <label class="check text-[12px]">
      <input
        type="checkbox"
        bind:checked={app.state.alwaysRates}
      >
      All rates
    </label>
    <label class="check text-[12px]">
      <input
        type="checkbox"
        checked={app.state.graphStubs !== false}
        onchange={(event) => (app.state.graphStubs = event.currentTarget.checked)}
      >
      Compact
    </label>
    <button
      class="btn btn-small"
      onclick={exportSvg}
    >
      SVG
    </button>
  </div>
  <div class="graph-legend">
    <span> <i class="lg item"></i>Line colour = item, thickness = rate </span
    ><span><i class="lg raw"></i>Raw input</span><span> <i class="lg out"></i>Target </span
    ><span><i class="lg sur"></i>Byproduct</span>
  </div>

  {#if !hasGraph}
    <div class="pointer-events-none absolute inset-0 flex items-center justify-center p-12">
      <div class="max-w-md text-center">
        <h3>Nothing to show yet</h3>
        <p class="mt-2 text-xs text-muted">
          Find an item to make on the left, then pick a recipe. Use ＋ on any input to expand its
          chain. Import game recipes in Settings to search everything.
        </p>
      </div>
    </div>
  {/if}
</div>
