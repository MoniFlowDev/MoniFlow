// Usage: node test/inspect-export.js <path to moniflow_recipes.json>
// Parses a real exporter file with MoniFlow's importer and prints a health report.
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const file = process.argv[2];
if (!file) { console.error('usage: node test/inspect-export.js <moniflow_recipes.json>'); process.exit(1); }
const root = path.join(__dirname, '..');
const ctx = vm.createContext({ console, window: {}, Map, Set, WeakMap, JSON, Math });
for (const f of ['js/data.js', 'js/importer.js', 'js/solver.js']) vm.runInContext(fs.readFileSync(path.join(root, f), 'utf8'), ctx, { filename: f });

ctx.dump = JSON.parse(fs.readFileSync(file, 'utf8'));
const t0 = Date.now();
const res = vm.runInContext('parseGameDump(dump)', ctx);
const ms = Date.now() - t0;
const st = res.stats;
console.log(`parsed ${st.parsed} of ${st.total} in ${ms} ms (gregtech ${st.gregtech || 0}, other ${st.other || 0}); skipped ${st.skipped}, generators ${st.generators}, errors ${st.errors}`);
console.log(`tags: resolved by guess ${st.tagGuesses}, unresolved ${st.tagUnresolved}`);

const noInputs = res.recipes.filter(r => r.inputs.length === 0);
const byMachine = {};
for (const r of noInputs) byMachine[r.machine] = (byMachine[r.machine] || 0) + 1;
console.log(`recipes with no inputs: ${noInputs.length}`, Object.entries(byMachine).sort((a, b) => b[1] - a[1]).slice(0, 12));

const unresolved = new Map();
for (const r of res.recipes) for (const io of [...r.inputs, ...r.outputs]) if (io.item.startsWith('#')) unresolved.set(io.item, (unresolved.get(io.item) || 0) + 1);
console.log('top unresolved tags', [...unresolved.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15));

const show = id => { const r = res.recipes.find(x => x.id.includes(id)); if (r) console.log(id, '=>', JSON.stringify({ machine: r.machine, eut: r.eut, duration: r.duration, temp: r.temp, in: r.inputs.map(i => `${i.amount} ${vm.runInContext(`iname(${JSON.stringify(i.item)})`, ctx)}`), out: r.outputs.map(o => `${o.amount} ${vm.runInContext(`iname(${JSON.stringify(o.item)})`, ctx)}${o.chance ? ` (${o.chance}%)` : ''}`) })); };
for (const id of (process.argv[3] || 'macerate_tungsten_carbide_plate,electric_blast_furnace/steel,shaped/ev_alloy_smelter,smelting').split(',')) show(id);
if (res.meta.exportErrors.length) console.log('export warnings:', res.meta.exportErrors);
