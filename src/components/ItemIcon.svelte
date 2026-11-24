<script lang="ts">
  import { useApp } from '../state/context';
  import { icons } from '../icons/icon-store';
  import { itemColor } from '../core/item-color';
  import { fluidColor } from '../icons/line-color';
  import { tierForEut } from '../data/tiers';
  import type { Recipe } from '../core/types';
  let {
    item = '',
    fluid = false,
    recipe,
    tier = null,
    size = 16,
    dotSize = size === 14 ? 8 : 10,
    fallback = true,
  }: {
    item?: string;
    fluid?: boolean;
    recipe?: Recipe;
    tier?: number | null;
    size?: number;
    dotSize?: number;
    fallback?: boolean;
  } = $props();

  const app = useApp();

  const key = $derived.by(() => {
    app.iconRevision;
    return recipe
      ? icons.machineKey(
          recipe,
          tier ?? (recipe.eut > 0 ? Math.max(1, tierForEut(recipe.eut)) : null),
        )
      : item;
  });

  const at = $derived.by(() => {
    app.iconRevision;
    return key ? icons.locate(key) : null;
  });

  const background = $derived.by(() => {
    app.iconRevision;
    return fluid ? fluidColor(item) : itemColor(item, false);
  });

</script>

{#if at}
  <span
    class="inline-flex shrink-0 overflow-hidden align-middle"
    class:rounded-full={fluid}
    style:width="{size}px"
    style:height="{size}px"
    style:background={fluid ? background : undefined}
    aria-hidden="true"
  >
    <span
      class="block size-full bg-no-repeat"
      style:background-image="url('{at.url}')"
      style:background-position="{(-at.x * size) / at.px}px {(-at.y * size) / at.px}px"
      style:background-size="{(at.w * size) / at.px}px {(at.h * size) / at.px}px"
    ></span>
  </span>
{:else if !recipe && fallback}
  <span
    class="inline-block shrink-0 rounded-sm"
    class:rounded-full={fluid}
    style:width="{dotSize}px"
    style:height="{dotSize}px"
    style:background
    aria-hidden="true"
  ></span>
{/if}
