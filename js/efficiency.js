/* MoniFlow — how efficient is each way of making an item? Used to rank recipes in the picker. */
'use strict';


/* ---- material forms (GregTech naming) ---- */

const FORM_PREFIXES = ['tiny_', 'small_', 'long_', 'double_', 'dense_', 'hot_', 'molten_', 'liquid_', 'raw_', 'pure_', 'impure_', 'purified_', 'refined_', 'crushed_', 'chipped_', 'flawed_', 'flawless_', 'exquisite_'];
const DERIVED_SUFFIXES = ['_nugget', '_block', '_plate', '_rod', '_bolt', '_screw', '_gear', '_foil', '_ring', '_round', '_spring', '_frame', '_lens',
  '_single_wire', '_double_wire', '_quadruple_wire', '_octal_wire', '_hex_wire', '_fine_wire'];
const MAIN_SUFFIXES = ['_ingot', '_gem'];
const UPSTREAM_SUFFIXES = ['_dust', '_ore'];

/** { material, form: 'main' | 'upstream' | 'derived' | null } from an item id like gtceu:steel_nugget. */
function materialForm(id, isFluid) {
  const r = baseMaterialForm(id, isFluid);
  // Magnetic materials are polarised versions of the plain one (magnetic steel <- steel).
  if (r.material && r.material.startsWith('magnetic_')) return { material: r.material.slice(9), form: 'derived' };
  return r;
}

function baseMaterialForm(id, isFluid) {
  const path = String(id).split(':').pop();
  let p = path, prefix = '';
  for (const pre of FORM_PREFIXES) if (p.startsWith(pre)) { prefix = pre; p = p.slice(pre.length); break; }
  if (isFluid) return { material: p, form: 'derived' };
  for (const suf of MAIN_SUFFIXES) if (p.endsWith(suf)) {
    const mat = p.slice(0, -suf.length);
    // Hot ingots come out of the blast furnace before the ingot; double ingots are made from it.
    return { material: mat, form: prefix === 'hot_' ? 'upstream' : prefix === 'double_' ? 'derived' : 'main' };
  }
  for (const suf of UPSTREAM_SUFFIXES) if (p.endsWith(suf)) {
    // Tiny and small piles are split off a full dust.
    return { material: p.slice(0, -suf.length), form: prefix === 'tiny_' || prefix === 'small_' ? 'derived' : 'upstream' };
  }
  if (['raw_', 'crushed_', 'purified_', 'refined_', 'pure_', 'impure_'].includes(prefix)) return { material: p.replace(/_(dust|ore)$/, ''), form: 'upstream' };
  for (const suf of DERIVED_SUFFIXES) if (p.endsWith(suf)) return { material: p.slice(0, -suf.length), form: 'derived' };
  if (prefix === 'long_' || prefix === 'dense_' || prefix === 'double_') return { material: p.replace(/_(rod|plate)$/, ''), form: 'derived' };
  return { material: null, form: null };
}

/** How many base units (ingots) one of this form is worth, following GregTech's standard amounts. */
function materialUnits(id, isFluid) {
  if (isFluid) return 1 / 144;
  const p = String(id).split(':').pop();
  const table = [
    [/^tiny_.*_dust$/, 1 / 9], [/^small_.*_dust$/, 1 / 4], [/_nugget$/, 1 / 9], [/_block$/, 9],
    [/^double_.*_plate$/, 2], [/^dense_.*_plate$/, 9], [/_plate$/, 1], [/^long_.*_rod$/, 1], [/_rod$/, 1 / 2],
    [/_bolt$/, 1 / 8], [/_screw$/, 1 / 8], [/^small_.*_gear$/, 1], [/_gear$/, 4], [/_foil$/, 1 / 4],
    [/_ring$/, 1 / 4], [/_round$/, 1 / 9], [/_spring$/, 1], [/_frame$/, 2], [/^double_.*_ingot$/, 2],
    [/_fine_wire$/, 1 / 8], [/_single_wire$/, 1 / 2], [/_double_wire$/, 1], [/_quadruple_wire$/, 2], [/_octal_wire$/, 4], [/_hex_wire$/, 8],
  ];
  for (const [re, u] of table) if (re.test(p)) return u;
  return 0;
}

/**
 * Build an evaluator over the recipe index.
 * choices: the plan's current choices (item -> recipe id | 'raw'); those are respected.
 * opts.byproducts: 'split' (share a recipe's cost with all its outputs, by quantity),
 *                  'plan'  (share only with byproducts the plan uses, opts.planUses),
 *                  'none'  (the item pays for everything).
 *
 * Costs come from a shortest-path pass over the whole recipe graph: every craftable item starts
 * unknown (infinite), raw materials start at zero, and each item repeatedly takes the cheapest of its
 * recipes until nothing changes. Every item gets one consistent cost, and loops can never make
 * something look free because a loop never beats a real path from raw materials.
 */
function makeEfficiency(index, choices, defaultTier, opts = {}) {
  const byMode = opts.byproducts || 'split';
  const planUses = opts.planUses || new Set();
  const unit = item => (index.fluids.has(item) ? 1 / 1000 : 1); // raw materials: 1 per item, 1 per bucket
  const makesOf = (r, item) => {
    let n = 0;
    for (const o of r.outputs) if (o.item === item) n += expectedAmount(o);
    for (const i of r.inputs) if (i.item === item) n -= Number(i.amount) || 0;
    return n;
  };
  const stepEU = r => (Number(r.eut) || 0) * (r.duration > 0 ? Number(r.duration) : 0);
  const formOf = item => materialForm(item, index.fluids.has(item));
  /**
   * True when a recipe turns a derived form (nugget, block, liquid, plate...) back into the base
   * ingot/gem/dust of the same material: those forms are themselves made from it.
   */
  const selfConversion = (r, item) => {
    const t = formOf(item);
    if (!t.material || (t.form !== 'main' && t.form !== 'upstream')) return false;
    return r.inputs.some(i => { const f = formOf(i.item); return f.material === t.material && f.form === 'derived'; });
  };

  /** Fraction of a recipe's cost the item pays when the recipe also makes byproducts (by quantity). */
  function costShare(r, item, makes) {
    if (byMode === 'none') return 1;
    const mine = makes * unit(item);
    let total = mine;
    const seen = new Set([item]);
    for (const o of r.outputs) {
      if (seen.has(o.item)) continue;
      seen.add(o.item);
      if (byMode === 'plan' && !planUses.has(o.item)) continue;
      const net = makesOf(r, o.item);
      if (net > 0) total += net * unit(o.item);
    }
    return total > 0 ? mine / total : 1;
  }

  /* ---- the cost table ---- */
  let table = null; // item -> { eu, raw, recipe, approx }

  /** Recipes allowed to make an item (respects plan choices; recycling only when nothing else makes it). */
  function eligible(item) {
    const choice = choices && choices[item];
    if (choice === 'raw') return [];
    if (choice && index.byId.has(choice)) return [index.byId.get(choice)];
    const all = (index.producers.get(item) || []).map(p => p.recipe).filter(r => r.inputs.length > 0 && makesOf(r, item) > 0 && !selfConversion(r, item));
    const normal = all.filter(r => !r.recycling);
    if (normal.length) return normal;
    // Only recycling makes it (e.g. liquid titanium). Allow melting/grinding plain forms of the same
    // material (nugget, plate, ingot...), never composite parts: recycling a part gives back the
    // material of all its components, which would let loops create material out of nothing.
    const mat = formOf(item).material;
    if (!mat) return [];
    return all.filter(r => r.inputs.every(i => formOf(i.item).material === mat));
  }

  function build() {
    const t0 = Date.now();
    const cost = new Map();
    const makers = new Map();      // item -> eligible recipes
    const consumers = new Map();   // item -> recipes that use it
    const recipes = new Set();
    for (const item of index.producers.keys()) {
      const list = eligible(item);
      makers.set(item, new Set(list));
      for (const r of list) recipes.add(r);
    }
    for (const r of recipes) for (const i of r.inputs) {
      if (!consumers.has(i.item)) consumers.set(i.item, []);
      consumers.get(i.item).push(r);
    }
    const leaf = item => ({ eu: 0, raw: unit(item), recipe: null, approx: false });
    const valueOf = item => {
      const c = cost.get(item);
      if (c) return c;
      const m = makers.get(item);
      return m && m.size ? null : leaf(item); // null = craftable but not reached yet
    };
    const queue = [...recipes];
    const queued = new Set(queue);
    const enqueueConsumers = item => {
      for (const c2 of consumers.get(item) || []) if (!queued.has(c2)) { queued.add(c2); queue.push(c2); }
    };
    const relax = () => {
      let pops = 0;
      while (queue.length && pops < 3000000) {
        const r = queue.pop();
        queued.delete(r);
        pops++;
        let eu = stepEU(r), raw = 0, approx = false, ok = true;
        for (const i of r.inputs) {
          const c = valueOf(i.item);
          if (!c) { ok = false; break; }
          const amt = Number(i.amount) || 0;
          eu += c.eu * amt;
          raw += c.raw * amt;
          approx = approx || c.approx;
        }
        if (!ok) continue;
        const seen = new Set();
        for (const o of r.outputs) {
          if (seen.has(o.item)) continue;
          seen.add(o.item);
          const m = makers.get(o.item);
          if (!m || !m.has(r)) continue;
          const makes = makesOf(r, o.item);
          if (!(makes > 0)) continue;
          const share = costShare(r, o.item, makes);
          const cand = { eu: eu * share / makes, raw: raw * share / makes, recipe: r, approx };
          const cur = cost.get(o.item);
          const tieEU = cur && Math.abs(cand.eu - cur.eu) <= Math.abs(cur.eu) * 1e-9 + 1e-12;
          const better = !cur || (!tieEU && cand.eu < cur.eu) || (tieEU && cand.raw < cur.raw * (1 - 1e-9));
          if (!better) continue;
          cost.set(o.item, cand);
          enqueueConsumers(o.item);
        }
      }
    };
    relax();
    // Items only reachable through loops with no way in: estimate a material form from its base
    // ingot, or treat as raw (approximate), then let costs settle again.
    for (let round = 0; round < 3; round++) {
      let added = 0;
      for (const [item, m] of makers) {
        if (cost.has(item) || !m.size) continue;
        cost.set(item, estimateFromMaterial(item, cost) || Object.assign(leaf(item), { approx: true }));
        added++;
        enqueueConsumers(item);
      }
      if (!added) break;
      relax();
    }
    table = cost;
    table.buildMs = Date.now() - t0;
  }

  /** A derived material form (liquid, nugget, plate...) estimated from its base ingot/gem/dust. */
  function estimateFromMaterial(item, cost) {
    const f = formOf(item);
    if (!f.material || f.form !== 'derived') return null;
    const units = materialUnits(item, index.fluids.has(item));
    if (!(units > 0)) return null;
    const ns = String(item).split(':')[0];
    for (const id of [`${ns}:${f.material}_ingot`, `${ns}:${f.material}_gem`, `${ns}:${f.material}_dust`, `gtceu:${f.material}_ingot`, `gtceu:${f.material}_dust`]) {
      const c = id !== item && cost.get(id);
      if (c) return { eu: c.eu * units, raw: c.raw * units, recipe: null, approx: true };
    }
    return null;
  }

  /** Cheapest cost of one unit of an item: { eu, raw, approx }. */
  function chain(item) {
    if (!table) build();
    return table.get(item) || { eu: 0, raw: unit(item), recipe: null, approx: false };
  }

  /** Does making these ingredients (by their cheapest recipes) need `target`? */
  function needs(items, target) {
    const seen = new Set();
    const stack = [...items];
    while (stack.length && seen.size < 4000) {
      const it = stack.pop();
      if (it === target) return true;
      if (seen.has(it)) continue;
      seen.add(it);
      const c = table.get(it);
      if (c && c.recipe) for (const i of c.recipe.inputs) stack.push(i.item);
    }
    return false;
  }

  /** Total cost of making one unit of `item` with recipe r, ingredients included. */
  function recipeChain(r, item) {
    if (!table) build();
    const makes = makesOf(r, item);
    if (!(makes > 0)) return null;
    let eu = stepEU(r), raw = 0, approx = false;
    for (const i of r.inputs) {
      if (i.item === item) continue;
      const c = chain(i.item);
      const amt = Number(i.amount) || 0;
      eu += c.eu * amt;
      raw += c.raw * amt;
      approx = approx || !!c.approx;
    }
    const share = costShare(r, item, makes);
    const loops = needs(r.inputs.map(i => i.item).filter(x => x !== item), item);
    return { eu: eu * share / makes, raw: raw * share / makes, cut: approx, loops, share };
  }

  /** Everything the picker shows and sorts by, for one recipe making `item`. */
  function stats(r, item) {
    const makes = makesOf(r, item);
    const tier = r.eut > 0 ? Math.max(1, tierIndexForEut(r.eut)) : 0;
    let machines = 0, runTierOut = null;
    if (r.duration > 0 && makes > 0) {
      const runTier = r.eut > 0 ? Math.max(tier, defaultTier || 1) : 1;
      const oc = overclock(r, { tier: runTier, ocMode: defaultOcMode(r.machine), parallel: 1, useCoil: false, coilTemp: 1800 });
      machines = 1 / (oc.craftsPerSec * makes);
      runTierOut = runTier;
    }
    const ch = recipeChain(r, item) || { eu: Infinity, raw: Infinity };
    return {
      makes,
      stepEU: makes > 0 ? stepEU(r) * (ch.share != null ? ch.share : 1) / makes : Infinity,
      chainEU: ch.eu,
      raw: ch.raw,
      approx: !!ch.cut && !ch.loops,
      byproductShare: ch.share != null ? 1 - ch.share : 0,
      tools: r.inputs.filter(i => i.uses).map(i => ({ item: i.item, uses: i.uses, est: !!i.usesEstimated })),
      loops: !!ch.loops || selfConversion(r, item),
      machines,
      runTier: runTierOut,
      tier,
      ingredients: new Set(r.inputs.map(i => i.item)).size,
    };
  }

  return { stats, recipeChain, chain, selfConversion, buildMs: () => (table ? table.buildMs : null) };
}

/** Rank a list (ties share a rank); lower values are better. */
function rankBy(list, f) {
  const vals = list.map(f);
  const sorted = [...new Set(vals)].sort((a, b) => a - b);
  const pos = new Map(sorted.map((v, i) => [v, i]));
  return vals.map(v => pos.get(v) / Math.max(1, sorted.length - 1));
}

const PICK_SORTS = {
  best: 'Best overall',
  chain: 'Least total power',
  step: 'Least power (this step)',
  machines: 'Fewest machines',
  raw: 'Fewest raw materials',
  tier: 'Lowest tier',
};

/**
 * Sort recipes for an item. Returns [{ r, s, score }] best first.
 * "Best overall" balances total power and machine count, avoids tiers above the one you plan for,
 * then prefers fewer raw materials and simpler recipes.
 */
function rankRecipes(recipes, item, eff, mode, playerTier = 1) {
  const rows = recipes.map(r => ({ r, s: eff.stats(r, item) }));
  if (!rows.length) return rows;
  const fin = v => (isFinite(v) ? v : 1e300);
  if (mode === 'best' || !mode) {
    // Rank real production recipes against each other; conversions/recycling go below, ranked among themselves.
    const penalty = x => (x.s.loops ? 100 : 0) + (x.r.recycling ? 50 : 0) + (x.r.inputs.length ? 0 : 20);
    const score = group => {
      const rc = rankBy(group, x => fin(x.s.chainEU));
      // Above your tier counts a lot; far below it (older, slower tech) a little. Instant recipes are exempt.
      const rt = rankBy(group, x => Math.max(0, x.s.tier - playerTier) + (x.r.duration > 0 ? 0.35 * Math.max(0, playerTier - x.s.tier) : 0));
      const rm = rankBy(group, x => fin(x.s.machines));
      // Crafting-table style recipes need no machine (just an autocrafter): neither best nor worst on this.
      group.forEach((x, i) => { if (!(x.r.duration > 0)) rm[i] = 0.5; });
      const rr = rankBy(group, x => fin(x.s.raw));
      const ri = rankBy(group, x => x.s.ingredients);
      group.forEach((x, i) => { x.score = 2.5 * rc[i] + 3 * rt[i] + 2.5 * rm[i] + 1 * rr[i] + 0.5 * ri[i] + penalty(x); });
    };
    const groups = new Map();
    for (const x of rows) { const k = penalty(x); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(x); }
    for (const g of groups.values()) score(g);
  } else {
    const key = { chain: x => fin(x.s.chainEU), step: x => fin(x.s.stepEU), machines: x => fin(x.s.machines), raw: x => fin(x.s.raw), tier: x => x.s.tier }[mode] || (x => 0);
    rows.forEach(x => { x.score = key(x) + (x.r.recycling ? 1e290 : 0) + (x.s.loops ? 1e280 : 0); });
  }
  rows.sort((a, b) => a.score - b.score || a.s.chainEU - b.s.chainEU);
  return rows;
}
