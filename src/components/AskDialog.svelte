<script lang="ts">
  import { untrack } from 'svelte';
  import { useApp } from '../state/context';
  import Modal from './Modal.svelte';

  const app = useApp();

  let { request }: { request: NonNullable<typeof app.askRequest> } = $props();
  let value = $state(untrack(() => request.input ?? ''));
</script>

<Modal
  title={request.title}
  onclose={() => app.answer(null)}
>
  <form
    class="flex flex-col gap-3.5"
    onsubmit={(event) => {
      event.preventDefault();
      app.answer(request.input == null ? true : value);
    }}
  >
    {#if request.message}
      <p class="text-sm text-muted">
        {request.message}
      </p>
    {/if}

    {#if request.input != null}
      <input
        class="w-full"
        aria-label={request.title}
        bind:value
      >
    {/if}

    <div class="flex justify-end gap-2">
      <button
        type="button"
        class="btn btn-ghost"
        onclick={() => app.answer(null)}
      >
        Cancel
      </button><button
        type="submit"
        class="btn"
        class:btn-primary={!request.danger}
        class:btn-danger={request.danger}
      >
        {request.okLabel ?? 'OK'}
      </button>
    </div>
  </form>
</Modal>
