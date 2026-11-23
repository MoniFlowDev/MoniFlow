# MoniFlow

A recipe flow and power planner for **Monifactory** (GregTech CEu Modern). It runs in the browser and needs no build step and no install.

## Run it

Open `index.html` in a browser, or serve the folder:

```bash
python -m http.server 8765
```

Then go to http://localhost:8765.

## Get your game's recipes

MoniFlow reads recipes from your own Monifactory install, so machines, EU/t and durations match your exact version. It exports every recipe the game ends up with, from every mod, after Monifactory's own changes.

1. Copy `kubejs/zzz_moniflow_export.js` into `<instance>/minecraft/kubejs/server_scripts/`.
2. Start Monifactory and load a singleplayer world. The script writes `kubejs/moniflow_recipes.json` once per script version. To export again (for example after a pack update), run `/moniflow export` in game.
3. In MoniFlow, open the **Recipes** tab, click **Import game recipes** and pick `moniflow_recipes.json`.

The game recipes are stored in your browser (IndexedDB), so you only import once.

- **GregTech** recipes keep duration, EU/t, chanced outputs, EBF heat and cleanroom requirements.
- **Other mods** (crafting table, furnace, Create, Thermal and so on) are read through Minecraft's generic recipe API: ingredients, result and processing time where the mod exposes one. Instant recipes (crafting table, stonecutter) show crafts per second instead of a machine count. Unpowered machines (furnace) show machine counts with no power draw.
- If the exporter hits problems, the first errors are written into the export and shown under **export warnings** in the Recipes tab.

## Item and machine icons

After importing game recipes, click **Build icons** in the Recipes tab and pick your instance's `minecraft` folder (and optionally `minecraft-1.20.1-client.jar` from `PrismLauncher/libraries/com/mojang/minecraft/1.20.1/` for vanilla items). MoniFlow reads the textures and models straight out of your mod jars, including mods bundled inside other jars, and draws:

- flat item icons, and real 3D renders of block models (anvils, stairs, hoppers, machines…) using each model's elements, UVs and inventory camera;
- GregTech wires, cables and pipes as 3D segments with the right thickness, end textures and cable insulation;
- GregTech material items (ingots, dusts, plates…) tinted with their material colours, and fluids, using data from exporter v5;
- machine icons per tier, so an LV Macerator step shows the LV macerator.

Nothing is uploaded; the icon atlas is stored in your browser. Rebuild icons after a pack update or a new export.

## Building a tree

1. Type in **Find an item to make** (Targets panel) and pick the item.
2. A recipe picker opens with every recipe that makes it, sorted by tier. Filter by machine or ingredient and click one.
3. Its ingredients appear on the graph as raw inputs. Any input with a **+** has recipes: click it to pick one, and keep going as deep as you like. Inputs you want to supply yourself just stay raw.
   The picker ranks recipes by efficiency. Each shows total EU per item including its ingredients. Costs come from one pass over the whole recipe graph (cheapest way to make every item from raw materials, respecting recipes you've already picked), so an intermediate like liquid titanium carries the full cost of the titanium ingot it's melted from, EU for that step, machines needed for 1/s at your default tier, raw materials per item, and the tier. **Best overall** balances power and machine count and avoids tiers above your plan's default tier; you can also sort by any single number. Recipes that just turn another form of the same material back (nuggets, blocks, liquid, magnetic or tiny dust → the base item) are marked **↻ made from itself** and listed last, as are chemistry loops whose ingredients need the item itself.

   **Byproducts:** by default a recipe's cost is shared across everything it makes, by quantity (items count 1 each, fluids 1 per bucket), and each recipe shows how much goes to byproducts. You can switch the picker to share only with byproducts your plan uses, or to ignore byproducts.

   **Tools:** with exporter v7, crafting ingredients that come back are handled properly: tools such as GregTech mortars, hammers and files cost one use per craft (shown as "1/256 Iron Mortar"), containers like water buckets give back the empty bucket, and items that aren't used up are marked "kept".
4. To swap a recipe later, click the step and use **Change recipe…**, or use **Pick recipe… / Change…** in the side panels.

## What it does

- **Targets → full chain.** Enter the items you want per second, minute or hour. Game recipes are only used once you pick them (the game has many recipes and loops per item). Your own recipes in **My recipes** expand automatically.
- **Hiding chains.** Long chains can be collapsed. Type an item into the box under **Raw inputs**, or click the **−** button on any step in the graph, and you supply that item yourself; the steps behind it are hidden. Click **+** on the dashed node, or **Show chain** in Raw inputs, to bring them back.
- **GregTech overclocking.** Each step has a machine tier, an overclock mode (standard / perfect / none) and a parallel count. Electric Blast Furnace style machines also get coil heat bonuses: +100K per tier above MV, a 5% EU discount per 900K over the recipe's heat, and one perfect overclock per 1800K over. Durations stop at 1 tick.
- **Machine counts.** Shows how many machines you need (as a fraction), how many to build, and how busy each one will be. You also get a build list grouped by tier.
- **Power.** Average and peak EU/t per step and in total, plus amps on your grid tier, cable amps, EU per hour, EU per item, and how many generators you need.
- **Tier comparison.** For any step, see how many machines and how much EU/t each tier needs, then switch tier with one click.
- **Loops and byproducts.** Byproducts are fed back into the chain automatically, so recycling loops (for example, re-concentrating diluted sulfuric acid) solve correctly.
- **Flow graph.** A compact, interactive graph you can pan and zoom. Each step shows its machine, product, machine count, power and ingredient icons; hover a step for a card with full details (machines and how busy they are, power, craft time, every input and output with its rate), or hover a line for its item and rate. Rates on lines appear on hover and selection, or all the time with **All rates**. Line thickness shows the rate, nodes are coloured by tier, and you can export it as SVG. Switch the flow direction with **→ ↓ ↑** (left to right, top to bottom, bottom to top). Drag any node to move it; positions are saved per plan and per direction, and **Reset layout** returns to the automatic layout. The layout keeps lines tidy: lines that skip columns are routed through the gaps between nodes instead of across them, and steps are ordered to keep line crossings to a minimum. With **Compact** on (the default), raw inputs and unused byproducts get no node or line at all: the step's own icon for that item is marked instead (dashed border = raw input, purple = unused byproduct). Hover it for the rate, click it for that item's details.
- **Saving.** Plans and recipes are saved in your browser automatically. You can keep several plans, export or import JSON backups, and share a plan as a link.

## Recipe library

**Game recipes** are read-only; use **Copy & edit** to make your own version. **My recipes** start with a few GregTech-style examples (you're offered the option to remove them when you import game recipes). Durations are in ticks (20 ticks = 1 s).

## Files

- `js/data.js`: tiers, coils, machines, generator presets, starter recipes
- `js/solver.js`: overclock math and the flow solver
- `js/graph.js`: graph layout and SVG rendering
- `js/efficiency.js`: recipe efficiency (ingredient-tree cost, machines, raw materials) and ranking
- `js/importer.js`: reads the exporter's GregTech JSON, item names, IndexedDB storage
- `js/icons.js`: jar reader and icon atlas builder
- `js/app.js`: UI and state
- `kubejs/zzz_moniflow_export.js`: the in-game recipe exporter
- `test/importer.test.js`: importer and solver tests (`node test/importer.test.js`)
