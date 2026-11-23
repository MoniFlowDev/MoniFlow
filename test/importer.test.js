// Run with: node test/importer.test.js
// Loads the browser scripts into a sandbox and checks the GregTech importer + solver.
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const root = path.join(__dirname, '..');
const ctx = vm.createContext({ console, window: {}, Map, Set, WeakMap, JSON, Math });
for (const f of ['js/data.js', 'js/importer.js', 'js/solver.js', 'js/efficiency.js', 'js/graph.js']) {
  vm.runInContext(fs.readFileSync(path.join(root, f), 'utf8'), ctx, { filename: f });
}
const run = code => vm.runInContext(code, ctx);

ctx.dump = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/sample-export.json'), 'utf8'));
const res = run('parseGameDump(dump)');
const byId = Object.fromEntries(res.recipes.map(r => [r.id, r]));

// Counts: 13 entries = 7 GT JSON + 1 GT fallback + 3 other-mod recipes, 1 generator (skipped), 1 broken string.
assert.strictEqual(res.stats.parsed, 13, 'parsed recipes');
assert.strictEqual(res.stats.other, 5, 'non-GregTech recipes');
assert.strictEqual(res.stats.generators, 1, 'generator recipes skipped');
assert.strictEqual(res.stats.errors, 1, 'broken entry counted');

// EBF steel: tag input resolved, fluid tag resolved, EnergyStack object, chance output, heat.
const ebf = byId['g:gtceu:electric_blast_furnace/steel_from_iron_dust'];
assert.strictEqual(ebf.machine, 'Electric Blast Furnace');
assert.strictEqual(ebf.eut, 120);
assert.strictEqual(ebf.temp, 1000);
assert.strictEqual(JSON.stringify(ebf.inputs), JSON.stringify([{ item: 'gtceu:iron_dust', amount: 1 }, { item: 'gtceu:oxygen', amount: 200, fluid: true }]));
assert.strictEqual(ebf.outputs[1].chance, 10);
assert.strictEqual(ebf.name, 'Steel Ingot');

// Plain-number EU (GTCEu 1.6.x style).
assert.strictEqual(byId['g:gtceu:macerator/macerate_iron_ingot'].eut, 2);
// Programmed circuit (chance 0) is not an ingredient.
assert.strictEqual(byId['g:gtceu:bender/bend_steel_ingot_to_plate'].inputs.length, 1);
// Cleanroom condition.
assert.strictEqual(byId['g:gtceu:circuit_assembler/cleanroom_example'].cond, 'Cleanroom');
// GregTech fallback entry and other mods.
const mix = byId['g:gtceu:mixer/manual_fallback_example'];
assert.strictEqual(mix.eut, 30);
assert.strictEqual(mix.outputs[1].chance, 25);
assert.strictEqual(mix.inputs[1].fluid, true);
const block = byId['g:minecraft:iron_block'];
assert.strictEqual(block.machine, 'Crafting Table');
assert.strictEqual(block.duration, 0);
assert.strictEqual(block.inputs[0].amount, 9);
assert.strictEqual(byId['g:minecraft:iron_ingot_from_smelting'].machine, 'Furnace');
assert.strictEqual(byId['g:create:mixing/example'].machine, 'Mixing (Create)');
assert.strictEqual(byId['g:create:mixing/example'].outputs[0].chance, 50);
// Tools lose one use per craft; buckets come back.
const mortar = byId['g:gtceu:shaped/mortar_steel_dust'];
const tool = mortar.inputs.find(i => i.item === 'gtceu:iron_mortar');
assert.strictEqual(tool.uses, 256);
assert.ok(Math.abs(tool.amount - 1 / 256) < 1e-12, 'mortar costs 1/256 per craft');
const clay = byId['g:minecraft:clay_from_bucket'];
assert.ok(clay.outputs.some(o => o.item === 'minecraft:bucket' && o.amount === 1), 'empty bucket returned');

// "Any wrench" picks are swapped for a basic tool and cost one use per craft.
ctx.toolRecipes = [{ id: 't', mod: 'gtceu', inputs: [{ item: 'gtceu:mv_neutronium_wrench', amount: 1 }, { item: 'gtceu:steel_plate', amount: 2 }], outputs: [{ item: 'x', amount: 1 }] }];
run(`normalizeTools(toolRecipes, { gtIcons: { 'gtceu:mv_neutronium_wrench': 'tool|gtceu:item/tools/mv_wrench|fff|000', 'gtceu:iron_wrench': 'tool|gtceu:item/tools/wrench|eee|999' },
  itemInfo: { 'gtceu:iron_wrench': 'd:128' }, names: {} }); normalizeTools(toolRecipes, {});`);
const w = ctx.toolRecipes[0].inputs[0];
assert.strictEqual(w.item, 'gtceu:iron_wrench');
assert.strictEqual(w.uses, 128);
assert.ok(Math.abs(w.amount - 1 / 128) < 1e-12, 'one use per craft, and running twice changes nothing');
assert.strictEqual(ctx.toolRecipes[0].inputs[1].amount, 2, 'other ingredients untouched');

// Names.
assert.strictEqual(run("iname('gtceu:copper_single_wire')"), '1x Copper Wire');
assert.strictEqual(run("iname('gtceu:some_unknown_thing')"), 'Some Unknown Thing');
assert.strictEqual(run("prettifyId('#forge:dusts/sulfur')"), 'Sulfur Dust (any)');

// Minecraft formatting codes.
assert.strictEqual(run('mcHtml("§5Advanced Alloy Smelter III§r")'), '<span style="color:#c040c0">Advanced Alloy Smelter III</span>');
assert.strictEqual(run('mcStrip("§aOverworldian§f Matter")'), 'Overworldian Matter');
assert.strictEqual(run('mcHtml("<x>§lB")'), '&lt;x&gt;<span style="font-weight:700">B</span>');
assert.strictEqual(run("prettifyId('#gtceu:circuits/zpm')"), 'ZPM Circuit (any)');
assert.strictEqual(run("machineFromType('minecraft:crafting_shaped')"), 'Crafting Table');
assert.strictEqual(run("machineFromType('gtceu:crafting_shaped_strict')"), 'Crafting Table');

// Solve: 1 steel plate/s, with steel from the EBF and iron dust from the macerator.
ctx.recipes = res.recipes;
run(`
  var index = buildIndex(recipes);
  var proj = { targets: [{ item: 'gtceu:steel_plate', rate: 1 }], nodes: {}, defaultTier: 2, defaultCoil: 0, autoExpand: true,
    choices: { 'gtceu:steel_plate': 'g:gtceu:bender/bend_steel_ingot_to_plate',
               'gtceu:steel_ingot': 'g:gtceu:electric_blast_furnace/steel_from_iron_dust',
               'gtceu:iron_dust': 'g:gtceu:macerator/macerate_iron_ingot' } };
  var sol = solve(proj, index);
`);
const sol = ctx.sol;
assert.strictEqual(sol.warnings.length, 0, String(sol.warnings));
const raw = Object.fromEntries(sol.raw.map(r => [r.item, r.rate]));
assert.ok(Math.abs(raw['minecraft:iron_ingot'] - 1) < 1e-9, 'iron ingot 1/s');
assert.ok(Math.abs(raw['gtceu:oxygen'] - 200) < 1e-9, 'oxygen 200 mB/s');
const ebfNode = sol.nodes.find(n => n.id.includes('electric_blast_furnace'));
// MV EBF, cupronickel (1800K + 0 for MV) vs 1000K: 800K over -> no discount, 120 EU/t, no OC at MV.
assert.strictEqual(ebfNode.oc.eut, 120);
assert.ok(Math.abs(ebfNode.machines - 25) < 1e-9, '25 EBFs for 1 ingot/s at 500 ticks');

// Game recipes are never auto-expanded: without choices the target stays raw.
run(`var sol2 = solve({ targets: [{ item: 'gtceu:steel_plate', rate: 1 }], nodes: {}, choices: {}, autoExpand: true }, index);`);
assert.strictEqual(ctx.sol2.nodes.length, 0);
assert.strictEqual(ctx.sol2.raw[0].expandable, true);

// Efficiency ranking: arc furnace steel beats EBF steel (60,000 EU + macerating the iron + electrolysing 200 mB oxygen).
run(`var eff = makeEfficiency(index, {}, 1, { byproducts: 'none' });
  var steelRecipes = index.producers.get('gtceu:steel_ingot').map(p => p.recipe);
  var ranked = rankRecipes(steelRecipes, 'gtceu:steel_ingot', eff, 'best');
  var byTier = rankRecipes(steelRecipes, 'gtceu:steel_ingot', eff, 'tier');`);
assert.ok(ctx.ranked[0].r.id.includes('arc_furnace'), 'arc furnace ranked first');
const ebfStats = ctx.ranked.find(x => x.r.id.includes('electric_blast')).s;
assert.ok(Math.abs(ebfStats.stepEU - 60000) < 1e-6, 'EBF step energy');
assert.ok(Math.abs(ebfStats.chainEU - (60000 + 112 + 200 * 45)) < 1e-6, 'EBF total includes macerator and oxygen: ' + ebfStats.chainEU);
assert.ok(Math.abs(ctx.ranked[0].s.raw - 1.056) < 1e-9, 'arc furnace raw = 1 ingot + 56 mB oxygen');
assert.ok(ctx.byTier[0].s.tier <= ctx.byTier[1].s.tier, 'tier sort');

// Byproducts share the cost: electrolysis makes 2 buckets H2 + 1 bucket O2, so oxygen pays a third.
run(`var effSplit = makeEfficiency(index, {}, 1, { byproducts: 'split' });
  var ebfSplit = effSplit.stats(index.byId.get('g:gtceu:electric_blast_furnace/steel_from_iron_dust'), 'gtceu:steel_ingot');
  var oxy = effSplit.chain('gtceu:oxygen', 0, new Set(), 'nothing');`);
assert.ok(Math.abs(ctx.oxy.eu - 15) < 1e-9, 'oxygen costs 15 EU/mB with hydrogen sharing: ' + ctx.oxy.eu);
// EBF: 1 ingot + 10% ash -> the ingot pays 1/1.1 of the step and of its ingredients.
assert.ok(Math.abs(ctx.ebfSplit.stepEU - 60000 / 1.1) < 1e-6, 'EBF step shared with ash');
assert.ok(Math.abs(ctx.ebfSplit.byproductShare - (1 - 1 / 1.1)) < 1e-9, 'byproduct share reported');
// Only byproducts the plan uses: nothing used -> full cost.
run(`var effPlan = makeEfficiency(index, {}, 1, { byproducts: 'plan', planUses: new Set() });
  var oxyPlan = effPlan.chain('gtceu:oxygen', 0, new Set(), 'nothing');`);
assert.ok(Math.abs(ctx.oxyPlan.eu - 45) < 1e-9, 'plan mode without hydrogen use: full cost');

// Liquid metal that only recycling makes must inherit the ingot's cost, and recycling a composite
// part must not create material out of nothing (the titanium plate / fluid solidifier case).
run(`
  var R = (id, machine, eut, dur, inputs, outputs, extra) => Object.assign({ id, machine, eut, duration: dur, src: 'game',
    inputs: inputs.map(([item, amount, fluid]) => ({ item, amount, fluid })), outputs: outputs.map(([item, amount, fluid]) => ({ item, amount, fluid })) }, extra || {});
  var tiIdx = buildIndex([
    R('ebf', 'Electric Blast Furnace', 100, 1000, [['gtceu:ti_dust', 1]], [['gtceu:ti_ingot', 1]]),
    R('ext_ingot', 'Extractor', 10, 10, [['gtceu:ti_ingot', 1]], [['gtceu:ti', 144, true]], { recycling: true }),
    R('ext_part', 'Extractor', 10, 10, [['gtceu:ti_part', 1]], [['gtceu:ti', 576, true]], { recycling: true }),
    R('part', 'Assembler', 1, 1, [['gtceu:ti_plate', 1]], [['gtceu:ti_part', 1]]),
    R('bender', 'Bender', 10, 10, [['gtceu:ti_ingot', 1]], [['gtceu:ti_plate', 1]]),
    R('solid', 'Fluid Solidifier', 10, 10, [['gtceu:ti', 144, true]], [['gtceu:ti_plate', 1]]),
  ]);
  var tiEff = makeEfficiency(tiIdx, {}, 1, { byproducts: 'split' });
  var tiLiquid = tiEff.chain('gtceu:ti');
  var tiRanked = rankRecipes(tiIdx.producers.get('gtceu:ti_plate').map(p => p.recipe), 'gtceu:ti_plate', tiEff, 'best', 1);
`);
assert.ok(Math.abs(ctx.tiLiquid.eu * 144 - (100000 + 100)) < 1e-6, 'liquid = ingot + extraction: ' + ctx.tiLiquid.eu * 144);
assert.strictEqual(ctx.tiLiquid.recipe.id, 'ext_ingot', 'composite part recycling is not used');
assert.strictEqual(ctx.tiRanked[0].r.id, 'bender', 'bender beats solidifying liquid made from the same ingot');

// Perfect overclocking: pick the tier with the fewest machines, up to the grid tier.
run(`
  var lcrIdx = buildIndex([{ id: 'lcr', name: 'PE', machine: 'Large Chemical Reactor', eut: 30, duration: 160, inputs: [{ item: 'a', amount: 1 }], outputs: [{ item: 'pe', amount: 1 }] }]);
  var lcrPlan = (extra) => Object.assign({ targets: [{ item: 'pe', rate: 1 }], choices: { pe: 'lcr' }, nodes: {}, defaultTier: 1, autoExpand: true }, extra);
  var tEV = solve(lcrPlan({ gridTier: 4 }), lcrIdx).nodes[0];
  var tMV = solve(lcrPlan({ gridTier: 2 }), lcrIdx).nodes[0];
  var tManual = solve(lcrPlan({ gridTier: 4, nodes: { lcr: { tier: 1 } } }), lcrIdx).nodes[0];
  var tOff = solve(lcrPlan({ gridTier: 4, autoPerfectTier: false }), lcrIdx).nodes[0];
`);
assert.strictEqual(ctx.tEV.settings.tier, 3, 'HV: 1 machine; EV also 1, so the lower tier wins');
assert.strictEqual(ctx.tEV.built, 1);
assert.strictEqual(ctx.tEV.settings.autoTier, true);
assert.strictEqual(ctx.tMV.settings.tier, 2, 'capped at the MV grid');
assert.strictEqual(ctx.tMV.built, 2);
assert.strictEqual(ctx.tManual.settings.tier, 1, 'a tier you set yourself is kept');
assert.strictEqual(ctx.tManual.built, 8);
assert.strictEqual(ctx.tOff.settings.tier, 1, 'switch off: default tier');

// Steps are named by the outputs the plan uses; unused outputs are byproducts.
run(`
  var elIdx = buildIndex([{ id: 'el', name: 'Water electrolysis', src: 'game', machine: 'Electrolyzer', eut: 30, duration: 100,
    inputs: [{ item: 'minecraft:water', amount: 1000, fluid: true }],
    outputs: [{ item: 'gtceu:hydrogen', amount: 2000, fluid: true }, { item: 'gtceu:oxygen', amount: 1000, fluid: true }] }]);
  var elPlan = (targets) => ({ targets, choices: { 'gtceu:hydrogen': 'el', 'gtceu:oxygen': 'el' }, nodes: {}, defaultTier: 1, autoExpand: true });
  var elOne = solve(elPlan([{ item: 'gtceu:hydrogen', rate: 100 }]), elIdx).nodes[0];
  var elBoth = solve(elPlan([{ item: 'gtceu:hydrogen', rate: 100 }, { item: 'gtceu:oxygen', rate: 10 }]), elIdx).nodes[0];
  var elOneTitle = stepTitle(elOne, true), elBothTitle = stepTitle(elBoth, true);
`);
assert.strictEqual(JSON.stringify(ctx.elOne.usedOutputs), '["gtceu:hydrogen"]');
assert.strictEqual(JSON.stringify(ctx.elOne.spareOutputs), '["gtceu:oxygen"]');
assert.strictEqual(ctx.elOneTitle, 'Hydrogen');
assert.strictEqual(JSON.stringify(ctx.elBoth.spareOutputs), '[]');
assert.strictEqual(ctx.elBothTitle, 'Hydrogen + Oxygen');

run(`var mergedA = mergeNames('Sulfuric Heavy Fuel', 'Sulfuric Light Fuel'), mergedB = mergeNames('Hydrogen', 'Oxygen'),
  elOpts = stepTitleOptions(elBoth, true);`);
assert.strictEqual(ctx.mergedA, 'Sulfuric Heavy + Light Fuel');
assert.strictEqual(ctx.mergedB, null);
assert.strictEqual(JSON.stringify(ctx.elOpts), '["Hydrogen + Oxygen","Hydrogen + 1 more"]');

// Graph layout: long lines get waypoints; raw inputs become stubs; crossing reduction finds a clean order.
run(`
  var L = (id, inputs, outputs) => ({ id, name: id, machine: 'M', eut: 8, duration: 20, inputs: inputs.map(i => ({ item: i, amount: 1 })), outputs: outputs.map(o => ({ item: o, amount: 1 })) });
  var lIdx = buildIndex([L('a', ['ore'], ['x']), L('b', ['x'], ['y']), L('c', ['y'], ['z']), L('d', ['z', 'x'], ['t'])]);
  var lPlan = { targets: [{ item: 't', rate: 1 }], choices: {}, nodes: {}, defaultTier: 1, autoExpand: true };
  var lSol = solve(lPlan, lIdx);
  var lg = buildGraph(lSol, { stubs: false });
  for (const e of lg.edges) e.w = 2;
  var lLay = layoutGraph(lg);
  assignCoordinates(lg, lLay, 'lr');
  var longEdge = lg.edges.find(e => e.from === 'a' && e.to === 'd');
  var gStub = buildGraph(lSol, { stubs: true });
`);
assert.ok(ctx.longEdge && ctx.longEdge.via && ctx.longEdge.via.length === 2, 'a -> d passes two columns via waypoints');
assert.ok(ctx.longEdge.via.every(v => v.seg && v.seg.x2 >= v.seg.x1), 'waypoint corridors run along the flow');
assert.strictEqual(ctx.lLay.crossings, 0, 'no crossings');
assert.ok(ctx.lg.nodes.has('raw:ore'), 'raw node without stubs');
assert.ok(!ctx.gStub.nodes.has('raw:ore'), 'raw node becomes stubs');
assert.strictEqual(ctx.gStub.edges.filter(e => e.stub === 'in').length, 1, 'stub at the step using the raw input');

console.log('importer tests passed:', res.stats.parsed, 'recipes parsed');
