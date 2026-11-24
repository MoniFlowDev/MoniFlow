<script lang="ts">
  import { untrack } from 'svelte';
  import { useApp } from '../state/context';
  import { MACHINES, machineUsesCoil } from '../data/machines';
  import { tier as tierAt, tierForEut } from '../data/tiers';
  import { itemName } from '../core/item-names';
  import type { Recipe, RecipeIO } from '../core/types';
  import type { EditorSession } from '../state/app.svelte';
  import Modal from './Modal.svelte';

  const app = useApp();

  let { session }: { session: EditorSession } = $props();
  let draft = $state<Recipe>(structuredClone(untrack(() => session.recipe)));
  let durationUnit = $state<'t' | 's'>('t');

  const minTier = $derived(tierAt(tierForEut(draft.eut || 0)));

  const machines = $derived(
    [
      ...new Set([...MACHINES.map((m) => m.name), ...app.state.library.map((r) => r.machine)]),
    ].sort(),
  );

  const items = $derived(
    [
      ...new Set(
        app.state.library.flatMap((r) =>
          [...r.inputs, ...r.outputs].map((io) => itemName(io.item)),
        ),
      ),
    ].sort(),
  );

  function add(kind: 'inputs' | 'outputs', fluid = false) {
    draft[kind].push({ item: '', amount: fluid ? 1000 : 1, fluid });
  }

  function save(event: SubmitEvent) {
    event.preventDefault();
    const rows = (list: RecipeIO[]) =>
      list
        .map((io) => ({
          ...$state.snapshot(io),
          item: app.keyFromText(io.item),
        }))
        .filter((io) => io.item && io.amount > 0);

    const outputs = rows(draft.outputs);

    if (!outputs.length) {
      app.notify('A recipe needs at least one output');
      return;
    }

    app.saveRecipe({
      ...$state.snapshot(draft),
      name: draft.name.trim(),
      machine: draft.machine.trim(),
      duration: Math.max(1, Math.round((draft.duration || 1) * (durationUnit === 's' ? 20 : 1))),
      eut: Math.max(0, draft.eut || 0),
      inputs: rows(draft.inputs),
      outputs,
    });
  }
</script>

<Modal
  title={session.existing ? 'Edit recipe' : 'New recipe'}
  onclose={() => (app.editor = null)}
  wide
>
  <form
    class="flex flex-col gap-[14px]"
    onsubmit={save}
  >
    <div class="grid grid-cols-1 gap-[10px] lg:grid-cols-2">
      <label class="field">
        Name<input
          required
          bind:value={draft.name}
        >
      </label>
      <label class="field">
        Machine<input
          required
          list="machine-options"
          bind:value={draft.machine}
        >
      </label>
      <label class="field">
        Duration
        <div class="flex gap-[6px]">
          <input
            class="min-w-0 flex-1"
            type="number"
            min="0.05"
            step="any"
            required
            bind:value={draft.duration}
          ><select
            aria-label="Duration unit"
            bind:value={durationUnit}
          >
            <option value="t">ticks</option>
            <option value="s">seconds</option>
          </select>
        </div>
      </label>
      <label class="field">
        Base EU/t<input
          type="number"
          min="0"
          step="any"
          required
          bind:value={draft.eut}
        >
      </label>
      {#if machineUsesCoil(draft.machine) || draft.temp}
        <label class="field">
          Required heat (K)<input
            type="number"
            min="0"
            step="1"
            bind:value={draft.temp}
          >
        </label>
      {/if}
      <label class="field">
        Minimum tier<output
          class="py-[5px] font-mono font-bold"
          style:color={minTier.color}
        >
          {minTier.name}
        </output>
      </label>
    </div>
    <div class="grid gap-4 lg:grid-cols-2">
      {#each ['inputs', 'outputs'] as side}
        {@const kind = side as 'inputs' | 'outputs'}
        <section class="space-y-[6px]">
          <div class="flex items-center gap-[6px]">
            <h3 class="mr-auto capitalize">{kind}</h3>
            <button
              type="button"
              class="btn btn-small"
              onclick={() => add(kind)}
            >
              ＋ Item
            </button><button
              type="button"
              class="btn btn-small"
              onclick={() => add(kind, true)}
            >
              ＋ Fluid
            </button>
          </div>
          {#each draft[kind] as io, i (io)}
            <div
              class="editor-row"
              class:no-chance={kind === 'inputs'}
            >
              <button
                type="button"
                title="Toggle item/fluid"
                aria-label="Ingredient kind"
                class="size-[10px] shrink-0 rounded-[2px]"
                class:rounded-full={io.fluid}
                style:background={io.fluid ? 'var(--fluid)' : 'var(--item)'}
                onclick={() => (io.fluid = !io.fluid)}
              ></button>
              <input
                class="min-w-0 flex-1"
                list="item-options"
                aria-label="{kind} item {i + 1}"
                placeholder="Item name or id"
                bind:value={io.item}
              >
              <input
                class="w-full"
                aria-label="{kind} amount {i + 1}"
                title={io.fluid ? 'mB' : 'Count'}
                type="number"
                min="0"
                step="any"
                bind:value={io.amount}
              >
              {#if kind === 'outputs'}
                <input
                  class="w-full"
                  aria-label="Output chance {i + 1}"
                  title="Chance %"
                  type="number"
                  min="0"
                  max="100"
                  value={io.chance ?? 100}
                  oninput={(event) => (io.chance = event.currentTarget.valueAsNumber)}
                >
              {/if}
              <button
                class="text-lg text-subtle hover:text-danger"
                type="button"
                aria-label="Remove {kind} row {i + 1}"
                onclick={() => draft[kind].splice(i, 1)}
              >
                ×
              </button>
            </div>
          {/each}
        </section>
      {/each}
    </div>
    <p class="hint mt-2">
      Fluids are in mB (1000 mB = 1 bucket). Output chance is in percent; the first output is the
      main product.
    </p>
    <div class="flex justify-end gap-2">
      <button
        class="btn btn-ghost"
        type="button"
        onclick={() => (app.editor = null)}
      >
        Cancel
      </button><button
        class="btn btn-primary"
        type="submit"
      >
        Save recipe
      </button>
    </div>
  </form>
  <datalist id="machine-options">
    {#each machines as machine}
      <option value={machine}></option>
    {/each}
  </datalist>
  <datalist id="item-options">
    {#each items as item}
      <option value={item}></option>
    {/each}
  </datalist>
</Modal>
