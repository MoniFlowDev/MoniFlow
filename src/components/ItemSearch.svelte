<script lang="ts">
  import { useApp } from '../state/context';
  import ItemIcon from './ItemIcon.svelte';
  import ItemName from './ItemName.svelte';
  let {
    onpick,
    preferMakeable = false,
    allowFree = false,
    placeholder = 'Search items…',
    label = placeholder,
    value: query = $bindable(''),
  }: {
    onpick: (item: string) => void;
    preferMakeable?: boolean;
    allowFree?: boolean;
    placeholder?: string;
    label?: string;
    value?: string;
  } = $props();

  const app = useApp();

  let open = $state(false);
  let highlighted = $state(0);
  let list = $state<HTMLDivElement>();

  const id = $props.id();
  const results = $derived(
    query.trim() ? app.catalog.search(query.trim(), { preferMakeable }) : [],
  );

  function choose(item: string) {
    query = '';
    open = false;
    onpick(item);
  }

  function keydown(event: KeyboardEvent) {
    if (event.key === 'Escape') {
      open = false;
      return;
    }

    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      open = true;
      highlighted = Math.max(
        0,
        Math.min(results.length - 1, highlighted + (event.key === 'ArrowDown' ? 1 : -1)),
      );
      list?.children[highlighted]?.scrollIntoView?.({ block: 'nearest' });
    } else if (event.key === 'Enter') {
      event.preventDefault();

      if (open && results[highlighted]) {
        choose(results[highlighted]!.key);
      } else if (allowFree && query.trim()) {
        choose(app.keyFromText(query));
      }
    }
  }
</script>

<div
  class="relative min-w-0"
  onfocusout={(event) => {
    if (!event.currentTarget.contains(event.relatedTarget as Node)) open = false;
  }}
>
  <input
    class="w-full"
    type="search"
    role="combobox"
    aria-label={label}
    aria-expanded={open && !!query.trim()}
    aria-controls={id}
    aria-autocomplete="list"
    aria-activedescendant={open && results[highlighted] ? `${id}-${highlighted}` : undefined}
    autocomplete="off"
    {placeholder}
    bind:value={query}
    oninput={() => {
      open = true;
      highlighted = 0;
    }}
    onfocus={() => (open = !!query.trim())}
    onkeydown={keydown}
  >
  {#if open && query.trim()}
    <div
      bind:this={list}
      {id}
      role="listbox"
      class="absolute inset-x-0 top-full z-30 mt-1 max-h-80 overflow-y-auto rounded-lg border border-[var(--line-2)] bg-raised p-1 shadow-[0_12px_30px_#000a]"
    >
      {#each results as entry, i (entry.key)}
        <button
          id="{id}-{i}"
          type="button"
          role="option"
          aria-selected={i === highlighted}
          class="grid w-full grid-cols-[16px_1fr_auto] items-center gap-2 rounded-md px-2 py-[6px] text-left text-[13px] hover:bg-[#2b3d52]"
          class:bg-[#2b3d52]={i === highlighted}
          onpointerdown={(event) => event.preventDefault()}
          onclick={() => choose(entry.key)}
        >
          <ItemIcon
            item={entry.key}
            fluid={entry.fluid}
          /><span class="min-w-0 flex-1 truncate">
            <ItemName item={entry.key} />
          </span>
          <span class="whitespace-nowrap text-[11px] text-subtle">
            {entry.makeable ? `${app.producersOf(entry.key).length} recipes` : 'no recipe'}
          </span>
        </button>
      {:else}
        <p class="p-3 text-xs text-subtle">
          No matching items{!app.gameData
            ? ' — import game recipes in Settings to search everything'
            : ''}
        </p>
      {/each}
    </div>
  {/if}
</div>
