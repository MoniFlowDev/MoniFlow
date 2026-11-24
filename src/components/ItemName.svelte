<script lang="ts">
  import { toSegments } from '../core/mc-text';
  import { itemNameRaw } from '../core/item-names';
  import { useApp } from '../state/context';

  let { item, text }: { item?: string; text?: string } = $props();

  const app = useApp();

  const segments = $derived.by(() => {
    app.nameRevision;
    return toSegments(text ?? itemNameRaw(item));
  });
</script>

<span>
  {#each segments as segment}
    <span
      style:color={segment.color}
      style:font-weight={segment.bold ? '700' : undefined}
      style:font-style={segment.italic ? 'italic' : undefined}
      style:text-decoration={[segment.underline && 'underline', segment.strike && 'line-through']
        .filter(Boolean)
        .join(' ')}
    >
      {segment.text}
    </span>
  {/each}
</span>
