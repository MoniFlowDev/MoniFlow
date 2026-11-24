<script lang="ts">
  import { onMount, type Snippet } from 'svelte';
  let {
    title,
    children,
    onclose,
    wide = false,
    kind = 'default',
  }: {
    title: string;
    children: Snippet;
    onclose: () => void;
    wide?: boolean;
    kind?: 'default' | 'picker' | 'ask' | 'icons';
  } = $props();
  let dialog: HTMLDialogElement;
  const id = $props.id();

  onMount(() => {
    dialog.showModal();

    const field = dialog.querySelector<HTMLInputElement>('input:not([type=file])');

    if (field) {
      field.focus();
      if (kind === 'ask') field.select();
    } else {
      dialog.querySelector<HTMLButtonElement>('button[type=submit]')?.focus();
    }
  });
</script>

<dialog
  bind:this={dialog}
  aria-labelledby={id}
  class={kind === 'picker'
    ? 'modal-picker'
    : kind === 'ask'
      ? 'w-[min(420px,calc(100vw-32px))]'
      : kind === 'icons'
        ? 'w-[min(620px,calc(100vw-32px))]'
        : wide
          ? 'w-[min(860px,calc(100vw-32px))]'
          : 'w-[min(640px,calc(100vw-32px))]'}
  {onclose}
  oncancel={onclose}
>
  <div class="modal-head">
    <h2 {id}>{title}</h2>
    {#if kind === 'picker'}
      <button
        class="-mt-[6px] text-[22px] leading-none text-muted hover:text-foreground"
        aria-label="Close dialog"
        onclick={onclose}
      >
        ×
      </button>
    {/if}
  </div>
  {@render children()}
</dialog>
