/* MoniFlow — overclocking math and flow solver */
'use strict';

const EPS = 1e-9;

function tierIndexForEut(eut) {
  for (let i = 0; i < TIERS.length; i++) if (eut <= TIERS[i].v) return i;
  return TIERS.length - 1;
}

function machineInfo(name) {
  return MACHINES.find(m => m.name.toLowerCase() === String(name || '').toLowerCase()) || null;
}

function machineUsesCoil(name) {
  const m = machineInfo(name);
  return !!(m && m.coil);
}

function defaultOcMode(name) {
  const m = machineInfo(name);
  return (m && m.oc) || 'standard';
}

/**
 * GregTech CEu style overclock.
 * opts: { tier, ocMode: 'standard'|'perfect'|'none', coilTemp, parallel }
 * Returns per-machine stats.
 */
function overclock(recipe, opts) {
  const baseEut = Math.max(0, Number(recipe.eut) || 0);
  const baseDur = Math.max(1, Number(recipe.duration) || 1);
  const recipeTier = tierIndexForEut(baseEut);
  const tier = opts.tier;
  const maxV = TIERS[tier].v;
  const notes = [];
  const errors = [];

  if (baseEut > maxV) {
    errors.push(`Needs at least ${TIERS[recipeTier].name} (${fmtNum(baseEut)} EU/t), machine is ${TIERS[tier].name}.`);
  }

  let eut = baseEut;
  let dur = baseDur;
  let perfectBudget = 0;

  // Coil bonuses (EBF-style): +100K per tier above MV, 5% EU discount per 900K over,
  // one perfect overclock per 1800K over.
  let effTemp = null;
  if (opts.useCoil && recipe.temp) {
    effTemp = opts.coilTemp + 100 * Math.max(0, tier - 2);
    if (effTemp < recipe.temp) {
      errors.push(`Coils too cold: ${fmtNum(effTemp)}K < ${fmtNum(recipe.temp)}K required.`);
    } else {
      const over = effTemp - recipe.temp;
      const discounts = Math.floor(over / 900);
      if (discounts > 0) {
        eut = eut * Math.pow(0.95, discounts);
        notes.push(`${discounts}× coil discount (−${Math.round((1 - Math.pow(0.95, discounts)) * 100)}% EU)`);
      }
      perfectBudget = Math.floor(over / 1800);
    }
  }

  // Parallel: limited by what the voltage can pay for at base speed.
  let parallel = Math.max(1, Math.floor(opts.parallel || 1));
  if (parallel > 1 && eut > 0) {
    const maxPar = Math.max(1, Math.floor(maxV / eut));
    if (maxPar < parallel) {
      notes.push(`Parallel capped at ${maxPar} by ${TIERS[tier].name} voltage`);
      parallel = maxPar;
    }
  }
  eut *= parallel;

  // Overclocks.
  let ocs = 0, perfectOcs = 0, hitTickCap = false;
  if (opts.ocMode !== 'none' && eut > 0) {
    while (eut * 4 <= maxV) {
      const perfect = opts.ocMode === 'perfect' || perfectOcs < perfectBudget;
      const div = perfect ? 4 : 2;
      if (dur / div < 1) { hitTickCap = true; break; }
      eut *= 4;
      dur = dur / div;
      if (perfect) perfectOcs++;
      ocs++;
    }
  }
  if (dur < 1) dur = 1;
  dur = Math.floor(dur) || 1;
  if (hitTickCap) notes.push('Hit 1-tick minimum: higher tier gives no more speed');
  if (ocs) notes.push(`${ocs} overclock${ocs > 1 ? 's' : ''}${perfectOcs ? ` (${perfectOcs} perfect)` : ''}`);

  const craftsPerSec = parallel * TICKS_PER_SECOND / dur; // per machine
  return {
    recipeTier, tier, eut, dur, parallel, ocs, perfectOcs, effTemp,
    craftsPerSec, notes, errors,
    euPerCraft: eut * dur / parallel,
  };
}

function expectedAmount(io) {
  const chance = io.chance == null || io.chance === '' ? 100 : Number(io.chance);
  return (Number(io.amount) || 0) * chance / 100;
}

/** Net amount of `item` a recipe produces per craft (outputs minus inputs). */
function netOutput(recipe, item) {
  let n = 0;
  for (const o of recipe.outputs) if (o.item === item) n += expectedAmount(o);
  for (const i of recipe.inputs) if (i.item === item) n -= Number(i.amount) || 0;
  return n;
}

/**
 * Lookup index over every recipe (your own + imported game recipes).
 * Build once per library change; solving and the UI both read from it.
 */
function buildIndex(recipes) {
  const byId = new Map();
  const producers = new Map();
  const fluids = new Set();
  const items = new Set();
  for (const r of recipes) {
    byId.set(r.id, r);
    r.outputs.forEach((o, k) => {
      if (!producers.has(o.item)) producers.set(o.item, []);
      producers.get(o.item).push({ recipe: r, primary: k === 0 });
      items.add(o.item);
      if (o.fluid) fluids.add(o.item);
    });
    for (const i of r.inputs) { items.add(i.item); if (i.fluid) fluids.add(i.item); }
  }
  return { recipes, byId, producers, fluids, items };
}

/**
 * Which recipe should make `item`? null => raw input.
 * Auto-expansion only follows your own recipes: the game has many recipes (and loops)
 * per item, so game recipes are only used once you pick one.
 */
function resolveChoice(project, index, item) {
  const c = project.choices[item];
  if (c === 'raw') return null;
  if (c && index.byId.has(c)) return index.byId.get(c);
  if (project.autoExpand === false) return null;
  const list = index.producers.get(item);
  if (!list) return null;
  const primary = list.find(p => p.primary && p.recipe.src !== 'game');
  return primary ? primary.recipe : null;
}

/**
 * For each step: the outputs the plan uses (another step's input, or a target) and the spare ones
 * (byproducts nobody uses). Steps are named after what they're used for.
 */
function markOutputRoles(nodes, targets) {
  const needers = new Map(); // item -> steps that consume it
  for (const n of nodes) for (const i of n.recipe.inputs) {
    if (!((Number(i.amount) || 0) > 0)) continue;
    if (!needers.has(i.item)) needers.set(i.item, new Set());
    needers.get(i.item).add(n);
  }
  const targetItems = new Set(targets.map(t => t.item));
  for (const n of nodes) {
    const outs = [...new Set(n.recipe.outputs.map(o => o.item))];
    const usedBy = item => targetItems.has(item) || [...(needers.get(item) || [])].some(m => m !== n);
    n.usedOutputs = outs.filter(usedBy);
    n.spareOutputs = outs.filter(i => !usedBy(i));
  }
}

/** Plain title for a step: the outputs the plan uses ("Hydrogen + Oxygen"), else its main product. */
function stepTitle(node, raw) {
  return stepTitleOptions(node, raw)[0];
}

/**
 * Ways to name a step, longest first, for fitting into tight spaces:
 * "Sulfuric Heavy Fuel + Sulfuric Light Fuel" -> "Sulfuric Heavy + Light Fuel" -> "Sulfuric Heavy Fuel + 1 more".
 */
function stepTitleOptions(node, raw) {
  const nameOf = raw ? inameRaw : iname;
  const r = node.recipe;
  const used = node.usedOutputs || [];
  if (r.src !== 'game' && used.length <= 1) return [r.name];
  if (!used.length) return [r.outputs[0] ? nameOf(r.outputs[0].item) : r.name];
  const names = used.map(nameOf);
  if (names.length === 1) return names;
  const out = [];
  if (names.length === 2) {
    out.push(names.join(' + '));
    const merged = mergeNames(names[0], names[1]);
    if (merged) out.push(merged);
  }
  out.push(`${names[0]} + ${names.length - 1} more`);
  return out;
}

/** "Sulfuric Heavy Fuel", "Sulfuric Light Fuel" -> "Sulfuric Heavy + Light Fuel" (null when nothing is shared). */
function mergeNames(a, b) {
  const A = a.split(' '), B = b.split(' ');
  let pre = 0;
  while (pre < A.length - 1 && pre < B.length - 1 && A[pre] === B[pre]) pre++;
  let suf = 0;
  while (suf < A.length - pre - 1 && suf < B.length - pre - 1 && A[A.length - 1 - suf] === B[B.length - 1 - suf]) suf++;
  if (!pre && !suf) return null;
  const mid = w => w.slice(pre, w.length - suf).join(' ');
  return [...A.slice(0, pre), `${mid(A)} + ${mid(B)}`, ...A.slice(A.length - suf)].join(' ');
}

/**
 * Perfect overclocking makes each tier 4x faster for 4x power (same energy per item), so a higher tier
 * only saves machines. Pick the tier (up to the grid tier) that needs the fewest machines to build;
 * ties go to the lower tier (cheaper machines, fewer amps). Stops paying off at the 1-tick minimum.
 */
function bestPerfectTier(recipe, rate, s, project) {
  const minTier = Math.max(1, tierIndexForEut(recipe.eut || 0));
  const cap = Math.max(minTier, project.gridTier != null ? project.gridTier : minTier);
  let best = null;
  for (let t = minTier; t <= cap; t++) {
    const oc = overclock(recipe, { tier: t, ocMode: 'perfect', parallel: s.parallel, useCoil: false, coilTemp: 1800 });
    const built = Math.ceil(rate / oc.craftsPerSec - 1e-9);
    if (!best || built < best.built) best = { tier: t, built };
  }
  return best ? best.tier : s.tier;
}

function nodeSettings(project, recipe) {
  const s = project.nodes[recipe.id] || {};
  const base = recipe.eut || 0;
  const minTier = Math.max(1, tierIndexForEut(base));
  return {
    tier: s.tier != null ? s.tier : Math.max(minTier, project.defaultTier != null ? project.defaultTier : 1),
    ocMode: s.ocMode || defaultOcMode(recipe.machine),
    coil: s.coil != null ? s.coil : (project.defaultCoil || 0),
    parallel: s.parallel || 1,
  };
}

/**
 * Solve the flow. Rates are in "per second".
 * Returns { nodes, raw, surplus, targets, balance, warnings, totals }.
 */
function solve(project, index) {
  const libById = index.byId;
  const warnings = [];
  const rates = new Map(); // recipeId -> crafts/s
  const recipeFor = new Map(); // item -> recipe|null (cache)
  const getRecipe = item => {
    if (!recipeFor.has(item)) recipeFor.set(item, resolveChoice(project, index, item));
    return recipeFor.get(item);
  };

  const targets = project.targets.filter(t => t.item && t.rate > 0);
  let converged = false;
  let iter = 0;
  const MAX_ITER = 400;
  let balance;
  const unproducible = new Set();

  for (; iter < MAX_ITER; iter++) {
    balance = new Map();
    const add = (item, v) => balance.set(item, (balance.get(item) || 0) + v);
    for (const t of targets) add(t.item, -t.rate);
    for (const [rid, rate] of rates) {
      const r = libById.get(rid);
      for (const i of r.inputs) add(i.item, -(Number(i.amount) || 0) * rate);
      for (const o of r.outputs) add(o.item, expectedAmount(o) * rate);
    }
    let changed = false;
    for (const [item, bal] of balance) {
      if (bal >= -EPS * Math.max(1, Math.abs(bal))) continue;
      const deficit = -bal;
      if (deficit < 1e-9) continue;
      const r = getRecipe(item);
      if (!r) continue;
      const net = netOutput(r, item);
      if (net <= 0) { unproducible.add(`${r.name} cannot net-produce ${iname(item)}`); continue; }
      rates.set(r.id, (rates.get(r.id) || 0) + deficit / net);
      changed = true;
    }
    if (!changed) { converged = true; break; }
  }
  if (!converged) warnings.push('Flow did not converge — there is probably a loop that consumes more than it produces. Mark one of the looped items as a raw input.');
  for (const u of unproducible) warnings.push(u);

  // Final balance -> raw inputs and surplus.
  const raw = [], surplus = [];
  for (const [item, bal] of balance) {
    if (bal < -1e-7) raw.push({ item, rate: -bal, fluid: index.fluids.has(item), manual: project.choices[item] === 'raw' && index.producers.has(item), expandable: index.producers.has(item) });
    else if (bal > 1e-7) surplus.push({ item, rate: bal, fluid: index.fluids.has(item) });
  }
  raw.sort((a, b) => b.rate - a.rate);
  surplus.sort((a, b) => b.rate - a.rate);

  // Machine stats per recipe node.
  const nodes = [];
  for (const [rid, rate] of rates) {
    if (rate < 1e-12) continue;
    const r = libById.get(rid);
    const s = nodeSettings(project, r);
    // Perfect-overclock steps without a tier you set yourself get the tier that needs the fewest machines.
    const manualTier = project.nodes[rid] && project.nodes[rid].tier != null;
    if (!manualTier && s.ocMode === 'perfect' && project.autoPerfectTier !== false && r.duration > 0 && r.eut > 0) {
      const t = bestPerfectTier(r, rate, s, project);
      if (t !== s.tier) { s.tier = t; s.autoTier = true; }
    }
    if (!(r.duration > 0)) {
      // Crafting table, stonecutter and similar: no machine time, no power.
      nodes.push({
        id: rid, recipe: r, settings: s, useCoil: false, instant: true, rate,
        oc: { eut: 0, dur: 0, craftsPerSec: Infinity, parallel: 1, ocs: 0, perfectOcs: 0, recipeTier: 0, tier: s.tier, euPerCraft: 0,
          notes: ['Instant recipe: crafting table, autocrafter or similar'], errors: [] },
        machines: 0, built: 0, utilization: 1, avgEut: 0, peakEut: 0, amps: 0,
      });
      continue;
    }
    const useCoil = machineUsesCoil(r.machine) && !!r.temp;
    const oc = overclock(r, { tier: s.tier, ocMode: s.ocMode, parallel: s.parallel, useCoil, coilTemp: COILS[s.coil] ? COILS[s.coil].temp : 1800 });
    const machines = rate / oc.craftsPerSec;
    const built = Math.ceil(machines - 1e-9);
    nodes.push({
      id: rid, recipe: r, settings: s, useCoil, oc, rate, machines, built,
      utilization: built ? machines / built : 0,
      avgEut: machines * oc.eut,
      peakEut: built * oc.eut,
      amps: oc.eut / TIERS[s.tier].v,
    });
  }
  nodes.sort((a, b) => b.avgEut - a.avgEut);
  markOutputRoles(nodes, targets);

  const totals = {
    avgEut: nodes.reduce((a, n) => a + n.avgEut, 0),
    peakEut: nodes.reduce((a, n) => a + n.peakEut, 0),
    machines: nodes.reduce((a, n) => a + n.built, 0),
    maxTier: nodes.reduce((a, n) => Math.max(a, n.settings.tier), 0),
    // How much the whole line could scale with machines rounded up.
    headroom: nodes.some(n => !n.instant) ? Math.min(...nodes.filter(n => !n.instant).map(n => n.built / n.machines)) : 1,
  };
  for (const n of nodes) {
    if (n.oc.errors.length) warnings.push(`${n.recipe.name}: ${n.oc.errors.join(' ')}`);
  }
  return { nodes, raw, surplus, targets, balance, warnings, totals, rates, libById, iterations: iter };
}

/** Tier comparison table for a node. */
function tierComparison(node) {
  if (node.instant) return [];
  const r = node.recipe;
  const out = [];
  const start = Math.max(1, tierIndexForEut(r.eut));
  for (let t = start; t < TIERS.length; t++) {
    const s = node.settings;
    const oc = overclock(r, { tier: t, ocMode: s.ocMode, parallel: s.parallel, useCoil: node.useCoil, coilTemp: COILS[s.coil] ? COILS[s.coil].temp : 1800 });
    const machines = node.rate / oc.craftsPerSec;
    out.push({ tier: t, oc, machines, built: Math.ceil(machines - 1e-9), avgEut: machines * oc.eut });
    if (oc.dur <= 1 && t > start + 1) break;
  }
  return out;
}

/* ---------- formatting helpers (shared) ---------- */

function fmtNum(n, digits) {
  if (n == null || !isFinite(n)) return '∞';
  const abs = Math.abs(n);
  if (digits == null) digits = abs >= 100 ? 0 : abs >= 10 ? 1 : abs >= 1 ? 2 : 3;
  if (abs >= 1e12) return (n / 1e12).toFixed(2) + 'T';
  if (abs >= 1e9) return (n / 1e9).toFixed(2) + 'G';
  if (abs >= 1e6) return (n / 1e6).toFixed(2) + 'M';
  if (abs >= 1e4) return (n / 1e3).toFixed(1) + 'k';
  const s = n.toFixed(digits);
  return s.includes('.') ? s.replace(/\.?0+$/, '') : s;
}

function fmtEut(eut) { return fmtNum(eut) + ' EU/t'; }

function fmtDuration(ticks) {
  const s = ticks / TICKS_PER_SECOND;
  if (s >= 60) return `${fmtNum(s / 60)} min`;
  return `${fmtNum(s)} s`;
}

const UNITS = { s: { mult: 1, label: '/s' }, min: { mult: 60, label: '/min' }, h: { mult: 3600, label: '/h' } };
let RATE_UNIT = 's';

/** Fluid amount with a unit that fits: mB, B (1,000 mB = a bucket), kB, MB. */
let FLUID_UNITS = 'auto'; // 'auto' | 'mb'

function fmtFluid(mb) {
  const a = Math.abs(mb);
  if (FLUID_UNITS === 'mb') {
    // Full numbers with separators (10,000 mB) rather than "10.0k mB"; shorten only past a million.
    if (a >= 1000 && a < 1e6) return `${Math.round(mb).toLocaleString('en-US')} mB`;
    return `${fmtNum(mb)} mB`;
  }
  if (a < 1000) return `${fmtNum(mb)} mB`;
  if (a < 1e6) return `${fmtNum(mb / 1000)} B`;
  if (a < 1e9) return `${fmtNum(mb / 1e6)} kB`;
  return `${fmtNum(mb / 1e9)} MB`;
}

/** Item count or fluid amount, for recipe chips: "4×", "144 mB", "2.5 B". */
function fmtAmount(amount, fluid) { return fluid ? fmtFluid(amount) : `${fmtNum(amount)}×`; }

/** Format a per-second rate in the current display unit. */
function fmtRate(ratePerSec, fluid) {
  const u = UNITS[RATE_UNIT];
  const v = ratePerSec * u.mult;
  return fluid ? `${fmtFluid(v)}${u.label}` : `${fmtNum(v)}${u.label}`;
}

/** Stable color per item name. */
function itemColor(name, fluid) {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  const hue = fluid ? 180 + (h % 70) : (h % 360);
  return `hsl(${hue} ${fluid ? 70 : 62}% ${fluid ? 60 : 62}%)`;
}

/** Best tier label for a power draw: "3.2A HV". */
function ampsLabel(eut, tier) {
  return `${fmtNum(eut / TIERS[tier].v)}A ${TIERS[tier].name}`;
}
