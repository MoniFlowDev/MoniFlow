<script lang="ts">
  import { useApp } from '../state/context';
  import { TIERS } from '../data/tiers';
  import { COILS } from '../data/coils';
  import { formatNumber } from '../core/format';
  import type { RawInput } from '../solver/solve';
  import ItemSearch from './ItemSearch.svelte';
  import ItemName from './ItemName.svelte';
  import ItemIcon from './ItemIcon.svelte';
  import ChoiceControl from './ChoiceControl.svelte';

  const app = useApp();

  let rawText = $state('');

  const manual = $derived(
    Object.keys(app.project.choices).filter((item) => app.project.choices[item] === 'raw'),
  );

  const raw = $derived.by(() => {
    const supplied: RawInput[] = manual.map(
      (item) =>
        app.solution.raw.find((r) => r.item === item) ?? {
          item,
          rate: 0,
          fluid: app.isFluid(item),
          manual: true,
          expandable: !!app.producersOf(item).length,
          unused: true,
        },
    );

    return [
      ...supplied.sort((a, b) => b.rate - a.rate),
      ...app.solution.raw.filter((r) => !manual.includes(r.item)),
    ];
  });
</script>

<aside
  class="sidebar"
  aria-label="Plan inputs"
>
  <section class="panel">
    <div class="panel-head">
      <h2>Targets</h2>
      <span class="hint">What you want to make</span>
    </div>
    <div id="targetList">
      {#each app.project.targets as target (target.item)}
        <div class="target-row">
          <span
            class="t-name"
            title={target.item}
          >
            <span class="shrink-0">
              <ItemIcon
                item={target.item}
                fluid={app.isFluid(target.item)}
                fallback={false}
              />
            </span><span><ItemName item={target.item} /></span>
          </span>

          <input
            class="w-full"
            aria-label="Target rate for {target.item}"
            type="number"
            min="0"
            step="any"
            value={+(target.rate * app.format.multiplier).toPrecision(6)}
            oninput={(event) => app.setTargetRate(target.item, event.currentTarget.valueAsNumber)}
          >

          <span class="unit"> {app.isFluid(target.item) ? 'mB' : 'items'}{app.format.label} </span>

          <button
            class="icon-btn"
            aria-label="Remove target {target.item}"
            onclick={() => app.removeTarget(target.item)}
          >
            ×
          </button>
        </div>
      {:else}
        <p class="io-empty mb-2">No targets yet — search for an item below.</p>
      {/each}
    </div>

    <ItemSearch
      placeholder="＋ Find an item to make…"
      label="Find an item to make"
      preferMakeable
      onpick={(item) => app.addTarget(item)}
    />
  </section>

  <section class="panel">
    <div class="panel-head"><h2>Defaults</h2></div>

    <div class="field-grid">
      <label class="field">
        Machine tier<select bind:value={app.project.defaultTier}>
          {#each TIERS as tier, i}
            {#if i > 0}
              <option value={i}>{tier.name} ({formatNumber(tier.v)} V)</option>
            {/if}
          {/each}
        </select>
      </label>

      <label class="field">
        EBF coils<select bind:value={app.project.defaultCoil}>
          {#each COILS as coil, i}
            <option value={i}>{coil.name} ({formatNumber(coil.temp)}K)</option>
          {/each}
        </select>
      </label>

      <label class="field">
        Power grid tier<select bind:value={app.project.gridTier}>
          {#each TIERS as tier, i}
            <option value={i}>{tier.name} ({formatNumber(tier.v)} V)</option>
          {/each}
        </select>
      </label>

      <label class="field">
        Fluid units<select bind:value={app.state.fluidUnits}>
          <option value="auto">Auto (mB, B, kB)</option>
          <option value="mb">Always mB</option>
        </select>
      </label>

      <label class="check col-span-2">
        <input
          type="checkbox"
          checked={app.project.autoExpand !== false}
          onchange={(event) => (app.project.autoExpand = event.currentTarget.checked)}
        >
        Auto-expand ingredients
      </label>

      <label class="check col-span-2">
        <input
          type="checkbox"
          checked={app.project.autoPerfectTier !== false}
          onchange={(event) => (app.project.autoPerfectTier = event.currentTarget.checked)}
        >
        Best tier for perfect overclocking
      </label>
    </div>
    <p class="hint mt-2">
      New nodes use the default tier (or the recipe's minimum tier if higher). Click a node to
      override it.
    </p>
  </section>

  <section class="panel">
    <div class="panel-head">
      <h2>Raw inputs</h2>
      <span class="hint">Supply these</span>
    </div>

    <form
      class="raw-add"
      onsubmit={(event) => {
        event.preventDefault();
        app.supplyAsRaw(rawText);
        rawText = '';
      }}
    >
      <div class="min-w-0 flex-1">
        <ItemSearch
          placeholder="Supply an item, hide its chain…"
          label="Supply an item"
          allowFree
          bind:value={rawText}
          onpick={(item) => app.supplyAsRaw(item)}
        />
      </div>
      <button
        class="btn btn-small"
        type="submit"
      >
        Add
      </button>
    </form>

    <div class="io-list">
      {#each raw as input, i (input.item)}
        {#if manual.length && i === 0}
          <div class="io-sub">
            <span>Supplied by you · chain hidden</span
            ><span>
              {manual.length}
            </span>
          </div>
        {/if}

        {#if manual.length && i === manual.length}
          <div class="io-sub">Base resources</div>
        {/if}

        <div class="io-item">
          <ItemIcon
            item={input.item}
            fluid={input.fluid}
          /><span
            class="io-name"
            title={input.item}
          >
            <ItemName item={input.item} />
          </span><span class="io-rate">
            {input.unused ? 'not needed' : app.format.rate(input.rate, input.fluid)}
          </span>

          {#if manual.includes(input.item)}
            <div class="choice-ctl">
              <span class="min-w-0 flex-1 text-[11px] text-surplus">
                {input.expandable ? 'chain hidden' : 'supplied'}
              </span><button
                class="link-btn"
                onclick={() => app.showChain(input.item)}
              >
                {input.expandable ? 'Show chain' : 'Remove'}
              </button>
            </div>
          {:else}
            <ChoiceControl item={input.item} />
          {/if}

        </div>
      {:else}
        <p class="io-empty">None</p>
      {/each}
    </div>
  </section>

  <section class="panel">
    <div class="panel-head">
      <h2>Byproducts</h2>
      <span class="hint">Left over</span>
    </div>

    <div class="io-list">
      {#each app.solution.surplus as output (output.item)}
        <div class="io-item">
          <ItemIcon
            item={output.item}
            fluid={output.fluid}
          /><span
            class="io-name"
            title={output.item}
          >
            <ItemName item={output.item} />
          </span><span class="io-rate">
            {app.format.rate(output.rate, output.fluid)}
          </span>
        </div>
      {:else}
        <p class="io-empty">None</p>
      {/each}
    </div>
  </section>

  {#if app.solution.warnings.length}
    <section class="panel">
      <div class="panel-head"><h2>Warnings</h2></div>
      <ul class="list-disc space-y-1 pl-[18px] text-[12px] text-warning">
        {#each app.solution.warnings as warning}
          <li>{warning}</li>
        {/each}
      </ul>
    </section>
  {/if}
</aside>
