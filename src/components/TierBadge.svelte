<script lang="ts">
  import { tier as tierAt, tierForEut } from '../data/tiers';
  import type { Recipe } from '../core/types';
  let { tier = 0, recipe }: { tier?: number; recipe?: Recipe } = $props();
  const info = $derived(tierAt(recipe ? tierForEut(recipe.eut) : tier));
</script>

<span
  class="tier"
  style:color={recipe && !recipe.eut ? 'var(--raw)' : info.color}
>
  {recipe && !recipe.eut ? (recipe.duration > 0 ? 'NO EU' : 'CRAFT') : info.name}
</span>
