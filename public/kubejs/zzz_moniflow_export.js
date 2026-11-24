// MoniFlow recipe exporter v3 (KubeJS 6 / Minecraft 1.20.1)
//
// Put this file in <instance>/minecraft/kubejs/server_scripts/ and load a world.
// It reads every recipe the game actually ended up with (all mods, after Monifactory's
// own changes) and writes them, plus item/fluid names, to
//   <instance>/minecraft/kubejs/moniflow_recipes.json
// Import that file in MoniFlow (Recipes tab -> "Import game recipes").
//
// It exports automatically once per script version. To export again at any time,
// run the command  /moniflow export  in game.
//
// GregTech recipes keep their duration, EU/t, chances, heat and cleanroom data.
// Other mods' recipes are read through Minecraft's generic recipe API (ingredients,
// result, and processing time where the mod exposes one).
//
// Rhino notes (KubeJS's JavaScript engine), learned the hard way:
//  - use `let`, not `const`, inside functions that run more than once;
//  - build output with plain JS objects/arrays: Gson's JsonArray.add(...) is ambiguous;
//  - vanilla Ingredient.getItems() is not exposed; use KubeJS's .itemIds / .stacks.

const MONIFLOW_VERSION = 8;
const MONIFLOW_OUT = 'kubejs/moniflow_recipes.json';
const MONIFLOW_MARKER = 'kubejs/moniflow_export_done.json';

function moniflowExport(server) {
  let started = Date.now();
  let JsonOps = null,
    GTCodec = null,
    RecipeTypes = null,
    FluidRegistry = null,
    ItemRegistry = null;
  try {
    JsonOps = Java.loadClass('com.mojang.serialization.JsonOps').INSTANCE;
  } catch (e) {
    console.warn('[MoniFlow] JsonOps unavailable: ' + e);
  }
  try {
    GTCodec = Java.loadClass('com.gregtechceu.gtceu.api.recipe.GTRecipeSerializer').CODEC;
  } catch (e) {
    console.warn('[MoniFlow] GT codec unavailable: ' + e);
  }
  try {
    let forgeRegistries = Java.loadClass('net.minecraftforge.registries.ForgeRegistries');
    RecipeTypes = forgeRegistries.RECIPE_TYPES;
    FluidRegistry = forgeRegistries.FLUIDS;
    ItemRegistry = forgeRegistries.ITEMS;
  } catch (e) {
    console.warn('[MoniFlow] Forge registries unavailable: ' + e);
  }
  let registryAccess = server.registryAccess();

  let recipes = [];
  let genericIngredients = {};
  let tagSet = {};
  let tagRe = /"tag":"([^"]+)"/g;
  let stats = { gtCodec: 0, gtManual: 0, generic: 0, skipped: 0, failed: 0 };
  let errors = [];
  let notes = {}; // first problem seen per step, for diagnosing skipped recipes
  let codecError = null;
  let fail = (id, where, e) => {
    stats.failed++;
    if (errors.length < 10) errors.push(String(id) + ' [' + where + ']: ' + String(e));
  };
  let note = (where, e) => {
    if (notes[where] == null) notes[where] = String(e);
  };

  let itemId = (stack) => {
    try {
      if (ItemRegistry) return String(ItemRegistry.getKey(stack.getItem()));
    } catch (e) {
      note('itemId', e);
    }
    try {
      return String(stack.getId());
    } catch (e) {
      return null;
    }
  };
  let fluidId = (fs) => {
    try {
      if (FluidRegistry) return String(FluidRegistry.getKey(fs.getFluid()));
    } catch (e) {
      note('fluidId', e);
    }
    return null;
  };
  // All item ids an ingredient accepts (KubeJS helpers; vanilla getItems() isn't exposed).
  let ingredientIds = (ing) => {
    let ids = [];
    if (ing == null) return ids;
    try {
      ing.itemIds.forEach((i) => ids.push(String(i)));
      if (ids.length > 0) return ids;
    } catch (e) {
      note('itemIds', e);
    }
    try {
      ing.stacks.forEach((st) => {
        let sid = itemId(st);
        if (sid) ids.push(sid);
      });
    } catch (e) {
      note('stacks', e);
    }
    return ids;
  };
  // When an ingredient accepts several items (a tag), pick a sensible one: GregTech's, not an
  // electric tier version, and for tools a basic material (iron, steel, ...).
  let basicMaterials = ['iron_', 'steel_', 'wrought_iron_', 'bronze_', 'rubber_', 'wood_'];
  let pickScore = (sid) => {
    let path = sid.split(':').pop();
    let score = sid.indexOf('gtceu:') === 0 ? 0 : 10;
    if (/^(ulv|lv|mv|hv|ev|iv|luv|zpm|uv|uhv|uev|uiv|uxv|opv)_/.test(path)) score += 100;
    let m = -1;
    for (let i = 0; i < basicMaterials.length; i++)
      if (path.indexOf(basicMaterials[i]) === 0) {
        m = i;
        break;
      }
    score += m >= 0 ? m : 20;
    return score;
  };
  let pickId = (ids) => {
    if (ids.length <= 1) return ids.length ? ids[0] : null;
    let best = ids[0],
      bestScore = pickScore(ids[0]);
    for (let i = 1; i < ids.length; i++) {
      let sc = pickScore(ids[i]);
      if (sc < bestScore) {
        best = ids[i];
        bestScore = sc;
      }
    }
    return best;
  };
  let io = (id, amount, fluid, chance) => {
    let o = { id: String(id), n: Number(amount) };
    if (fluid) o.f = true;
    if (chance != null && chance < 1) o.c = Number(chance);
    return o;
  };
  let typeId = (r) => {
    try {
      if (RecipeTypes) {
        let k = RecipeTypes.getKey(r.getType());
        if (k) return String(k);
      }
    } catch (e) {
      note('typeId', e);
    }
    try {
      return String(r.getType());
    } catch (e) {
      return 'unknown';
    }
  };

  // ---- GregTech: field-by-field fallback when the codec can't encode a recipe.
  let gtManual = (r) => {
    let ins = [],
      outs = [];
    let eu = 0,
      gen = 0;
    let euOf = (c) => {
      try {
        return Number(c.getTotalEU());
      } catch (e) {
        return Number(c) || 0;
      }
    };
    let walk = (map, arr, isInput, perTick) => {
      map.forEach((cap, contents) => {
        let name = String(cap.name);
        contents.forEach((c) => {
          if (name === 'eu') {
            if (perTick && isInput) eu += euOf(c.content);
            else if (perTick) gen += euOf(c.content);
            return;
          }
          let chance = Number(c.chance) / Math.max(1, Number(c.maxChance));
          if (isInput && chance === 0) return; // not consumed (circuits, catalysts)
          let mult = perTick ? Number(r.duration) : 1;
          if (name === 'item') {
            let ing = c.content;
            let inner = ing;
            try {
              inner = ing.getInner();
            } catch (e) {
              inner = ing;
            }
            let sid = pickId(ingredientIds(inner));
            if (!sid) return;
            let n = 1;
            try {
              n = Number(ing.getAmount());
            } catch (e) {
              n = 1;
            }
            arr.push(io(sid, n * mult, false, isInput ? null : chance));
          } else if (name === 'fluid') {
            let fi = c.content;
            let stacks = fi.getStacks();
            if (!stacks || stacks.length === 0) return;
            let fid = fluidId(stacks[0]);
            if (fid)
              arr.push(io(fid, Number(fi.getAmount()) * mult, true, isInput ? null : chance));
          }
        });
      });
    };
    walk(r.inputs, ins, true, false);
    walk(r.outputs, outs, false, false);
    walk(r.tickInputs, ins, true, true);
    walk(r.tickOutputs, outs, false, true);
    let o = { duration: Number(r.duration), eut: eu, in: ins, out: outs };
    if (gen) o.gen = gen;
    try {
      let t = Number(r.data.getInt('ebf_temp'));
      if (t) o.temp = t;
    } catch (e) {
      /* no heat */
    }
    try {
      r.conditions.forEach((cond) => {
        if (String(cond).toLowerCase().indexOf('cleanroom') >= 0) o.clean = String(cond);
      });
    } catch (e) {
      /* no conditions */
    }
    return o;
  };

  let exportGT = (r, id, type) => {
    let entry = { id: id, type: type };
    let json = null;
    if (GTCodec && JsonOps) {
      try {
        let res = GTCodec.encodeStart(JsonOps, r).result();
        if (res.isPresent()) json = res.get();
      } catch (e) {
        if (!codecError) codecError = String(e);
      }
    }
    if (json != null) {
      let s = String(json.toString());
      entry.json = s;
      let m;
      tagRe.lastIndex = 0;
      while ((m = tagRe.exec(s)) !== null) tagSet[m[1]] = true;
      stats.gtCodec++;
    } else {
      entry.gt = gtManual(r);
      stats.gtManual++;
    }
    recipes.push(entry);
  };

  // ---- Everything else: generic recipe API plus common mod extensions.
  let exportGeneric = (r, id, type) => {
    try {
      if (r.isSpecial()) {
        stats.skipped++;
        return;
      }
    } catch (e) {
      /* not special */
    }
    let ins = [],
      outs = [];
    let counts = {};
    let order = [];
    try {
      r.getIngredients().forEach((ing) => {
        if (ing == null) return;
        try {
          if (ing.isEmpty()) return;
        } catch (e) {
          /* treat as non-empty */
        }
        let sid = pickId(ingredientIds(ing));
        if (!sid) return;
        if (counts[sid] == null) {
          counts[sid] = 0;
          order.push(sid);
        }
        counts[sid] += 1;
      });
    } catch (e) {
      note('ingredients', e);
    }
    order.forEach((sid) => {
      ins.push(io(sid, counts[sid], false, null));
      genericIngredients[sid] = true;
    });

    // Fluids (Create-style processing recipes).
    try {
      r.getFluidIngredients().forEach((fi) => {
        let stacks = null;
        try {
          stacks = fi.getMatchingFluidStacks();
        } catch (e) {
          stacks = null;
        }
        if (!stacks || stacks.size() === 0) return;
        let fid = fluidId(stacks.get(0));
        if (fid) ins.push(io(fid, Number(fi.getRequiredAmount()), true, null));
      });
    } catch (e) {
      /* not a fluid recipe */
    }

    // Outputs: several results with chances if the mod exposes them, else the single result.
    try {
      r.getRollableResults().forEach((po) => {
        let st = po.getStack();
        let sid = st && !st.isEmpty() ? itemId(st) : null;
        if (sid) outs.push(io(sid, Number(st.getCount()), false, Number(po.getChance())));
      });
    } catch (e) {
      /* no rollable results */
    }
    if (outs.length === 0) {
      try {
        let st = r.getResultItem(registryAccess);
        if (st && !st.isEmpty()) {
          let sid = itemId(st);
          if (sid) outs.push(io(sid, Number(st.getCount()), false, null));
        }
      } catch (e) {
        note('result', e);
      }
    }
    try {
      r.getFluidResults().forEach((fs) => {
        if (fs.isEmpty()) return;
        let fid = fluidId(fs);
        if (fid) outs.push(io(fid, Number(fs.getAmount()), true, null));
      });
    } catch (e) {
      /* no fluid results */
    }
    if (outs.length === 0) {
      stats.skipped++;
      return;
    }

    let duration = 0;
    try {
      duration = Number(r.getCookingTime());
    } catch (e) {
      try {
        duration = Number(r.getProcessingDuration());
      } catch (e2) {
        duration = 0;
      }
    }
    recipes.push({
      id: id,
      type: type,
      generic: { duration: duration || 0, eut: 0, in: ins, out: outs },
    });
    stats.generic++;
  };

  server
    .getRecipeManager()
    .getRecipes()
    .forEach((r) => {
      let id = '?';
      try {
        id = String(r.getId());
        let type = typeId(r);
        let isGT =
          r.tickInputs !== undefined && r.recipeType !== undefined && r.duration !== undefined;
        if (isGT) exportGT(r, id, type);
        else exportGeneric(r, id, type);
      } catch (e) {
        fail(id, 'recipe', e);
      }
    });

  // Ingredients that come back after crafting: tools lose durability, buckets return empty.
  //   itemInfo[id] = "d:<durability>" (tool, 1 use per craft) | "r:<returned item>" | "k" (kept, not used up)
  let itemInfo = {};
  Object.keys(genericIngredients).forEach((sid) => {
    try {
      let st = Item.of(sid);
      let keep = false;
      try {
        keep = !!st.hasCraftingRemainingItem();
      } catch (e) {
        try {
          keep = !!st.getItem().hasCraftingRemainingItem();
        } catch (e2) {
          keep = false;
        }
      }
      if (!keep) return;
      let rem = null;
      try {
        rem = st.getCraftingRemainingItem();
      } catch (e) {
        rem = null;
      }
      let rid = rem != null && !rem.isEmpty() ? itemId(rem) : null;
      if (!rid) return;
      if (rid === sid) {
        let md = 0;
        try {
          md = Number(st.getMaxDamage());
        } catch (e) {
          md = 0;
        }
        itemInfo[sid] = md > 0 ? 'd:' + md : 'k';
      } else itemInfo[sid] = 'r:' + rid;
    } catch (e) {
      note('itemInfo', e);
    }
  });

  // Display names for every item and fluid.
  let items = {};
  try {
    Item.getTypeList().forEach((i) => {
      try {
        items[String(i)] = String(Item.of(i).getHoverName().getString());
      } catch (e) {
        /* skip */
      }
    });
  } catch (e) {
    console.warn('[MoniFlow] Could not list item names: ' + e);
  }
  let fluids = {};
  try {
    Fluid.getTypes().forEach((f) => {
      try {
        fluids[String(f)] = String(Fluid.getType(f).getFluidType().getDescription().getString());
      } catch (e) {
        /* skip */
      }
    });
  } catch (e) {
    console.warn('[MoniFlow] Could not list fluid names: ' + e);
  }

  // Item tags used by GregTech JSON (for example #forge:dusts/sulfur) -> item ids.
  let tags = {};
  Object.keys(tagSet).forEach((tag) => {
    try {
      let ids = ingredientIds(Ingredient.of('#' + tag));
      if (ids.length > 0) tags[String(tag)] = ids.join('|');
    } catch (e) {
      note('tags', e);
    }
  });

  // Icon data for GregTech material items (their models are generated at runtime, so MoniFlow
  // needs the texture paths and material colours to draw them).
  //   item/block: "kind|base|secondary|overlay|rgb|secondaryRgb|iconSet|oreBaseModel"
  //   pipe:       "pipe|wire|cable|fluid|item|other|typeName|thickness|rgb|secondaryRgb|iconSet"
  //   tool:       "tool|modelLocation|rgb|secondaryRgb"
  let gtIcons = {};
  let gtMaterials = {};
  let iconSets = {};
  let hex = (n) => {
    let v = (Number(n) & 0xffffff).toString(16);
    while (v.length < 6) v = '0' + v;
    return v;
  };
  let rememberMaterial = (mat) => {
    try {
      let name = String(mat.getName());
      if (gtMaterials[name] != null) return;
      let set = mat.getMaterialIconSet();
      gtMaterials[name] =
        hex(mat.getMaterialRGB()) +
        '|' +
        hex(mat.getMaterialSecondaryRGB()) +
        '|' +
        String(set.name);
      let s2 = set;
      while (s2 != null && iconSets[String(s2.name)] == null) {
        iconSets[String(s2.name)] = s2.parentIconset != null ? String(s2.parentIconset.name) : '';
        s2 = s2.parentIconset;
      }
    } catch (e) {
      note('material', e);
    }
  };
  // Read a Java field that may be shadowed by a same-named method in Rhino.
  let val = (o, k) => {
    if (o == null) return null;
    let v = o[k];
    return typeof v === 'function' ? v.call(o) : v;
  };
  let TagPrefixClass = null;
  try {
    TagPrefixClass = Java.loadClass('com.gregtechceu.gtceu.api.data.tag.TagPrefix');
  } catch (e) {
    note('TagPrefix', e);
  }
  try {
    Item.getTypeList().forEach((i) => {
      let sid = String(i);
      try {
        let item = Item.of(sid).getItem();
        // GregTech tools: model + material colour.
        if (typeof item.getToolType === 'function' && typeof item.getMaterial === 'function') {
          let mat = item.getMaterial();
          let tt = item.getToolType();
          if (mat != null && tt != null && val(tt, 'modelLocation') != null) {
            gtIcons[sid] = [
              'tool',
              String(val(tt, 'modelLocation')),
              hex(mat.getMaterialRGB()),
              hex(mat.getMaterialSecondaryRGB()),
            ].join('|');
            rememberMaterial(mat);
          }
          return;
        }
        // Wires, cables and pipes are pipe blocks with a material and a pipe type.
        if (typeof item.getBlock === 'function') {
          let block = item.getBlock();
          if (
            block != null &&
            block.pipeType !== undefined &&
            block.material !== undefined &&
            val(block, 'material') != null
          ) {
            let pt = val(block, 'pipeType');
            let mat = val(block, 'material');
            let kind = 'other';
            if (pt.isCable !== undefined) kind = val(pt, 'isCable') ? 'cable' : 'wire';
            else if (pt.channels !== undefined) kind = 'fluid';
            else if (pt.name !== undefined) kind = 'item';
            let thick = 0.5;
            try {
              thick = Number(pt.getThickness());
            } catch (e) {
              /* default */
            }
            gtIcons[sid] = [
              'pipe',
              kind,
              String(val(pt, 'name')).toLowerCase(),
              thick,
              hex(mat.getMaterialRGB()),
              hex(mat.getMaterialSecondaryRGB()),
              String(mat.getMaterialIconSet().name),
            ].join('|');
            rememberMaterial(mat);
            return;
          }
        }
        if (item.tagPrefix === undefined || item.material === undefined) return;
        let prefix = val(item, 'tagPrefix');
        let mat = val(item, 'material');
        if (prefix == null || mat == null) return;
        let set = mat.getMaterialIconSet();
        let type = prefix.materialIconType();
        if (type == null) return;
        let isBlock = typeof item.getBlock === 'function';
        let tex = (suffix) => {
          try {
            let rl = isBlock
              ? suffix
                ? type.getBlockTexturePath(set, suffix, true)
                : type.getBlockTexturePath(set, true)
              : suffix
                ? type.getItemTexturePath(set, suffix, true)
                : type.getItemTexturePath(set, true);
            return rl == null ? '' : String(rl);
          } catch (e) {
            return '';
          }
        };
        // Ores sit on a stone block: remember that block's model.
        let oreBase = '';
        try {
          if (isBlock && TagPrefixClass != null) {
            let ot = TagPrefixClass.ORES.get(prefix);
            if (ot != null) oreBase = String(ot.baseModelLocation());
          }
        } catch (e) {
          note('oreBase', e);
        }
        gtIcons[sid] = [
          isBlock ? 'block' : 'item',
          tex(null),
          tex('secondary'),
          tex('overlay'),
          hex(mat.getMaterialRGB()),
          hex(mat.getMaterialSecondaryRGB()),
          String(set.name),
          oreBase,
        ].join('|');
        rememberMaterial(mat);
      } catch (e) {
        note('gtIcons', e);
      }
    });
  } catch (e) {
    note('gtIcons list', e);
  }
  // Materials without items (many fluids and gases).
  try {
    let api = Java.loadClass('com.gregtechceu.gtceu.api.GTCEuAPI');
    api.materialManager.getRegisteredMaterials().forEach((mat) => rememberMaterial(mat));
  } catch (e) {
    note('materials', e);
  }

  let allErrors = errors.slice();
  if (codecError) allErrors.push('GT codec: ' + codecError);
  Object.keys(notes).forEach((k) => allErrors.push('note ' + k + ': ' + notes[k]));

  let out = {
    app: 'MoniFlow',
    format: MONIFLOW_VERSION,
    exported: String(new Date().toISOString()),
    stats: stats,
    errors: allErrors,
    recipes: recipes,
    items: items,
    fluids: fluids,
    tags: tags,
    gtIcons: gtIcons,
    gtMaterials: gtMaterials,
    iconSets: iconSets,
    itemInfo: itemInfo,
  };
  try {
    out.gtceu = String(Platform.getInfo('gtceu').version);
  } catch (e) {
    /* optional */
  }
  JsonIO.write(MONIFLOW_OUT, out);

  // Only mark as done when something was exported, so a failed run retries on the next load.
  if (recipes.length > 0)
    JsonIO.write(MONIFLOW_MARKER, {
      version: MONIFLOW_VERSION,
      exported: String(new Date().toISOString()),
      recipes: recipes.length,
    });
  let summary =
    '[MoniFlow] Exported ' +
    recipes.length +
    ' recipes (GregTech ' +
    (stats.gtCodec + stats.gtManual) +
    ', other ' +
    stats.generic +
    '; skipped ' +
    stats.skipped +
    ', failed ' +
    stats.failed +
    ') in ' +
    (Date.now() - started) +
    ' ms -> ' +
    MONIFLOW_OUT;
  console.info(summary);
  allErrors.forEach((e) => console.warn('[MoniFlow] ' + e));
  return summary;
}

// Export automatically the first time this version of the script runs.
ServerEvents.loaded((event) => {
  let marker = null;
  try {
    marker = JsonIO.read(MONIFLOW_MARKER);
  } catch (e) {
    marker = null;
  }
  if (marker && Number(marker.version) === MONIFLOW_VERSION) {
    console.info('[MoniFlow] Already exported; run /moniflow export to export again.');
    return;
  }
  try {
    moniflowExport(event.server);
  } catch (e) {
    console.error('[MoniFlow] Export failed: ' + e);
  }
});

// /moniflow export  — re-export at any time.
ServerEvents.commandRegistry((event) => {
  let Commands = event.commands;
  event.register(
    Commands.literal('moniflow').then(
      Commands.literal('export').executes((ctx) => {
        let msg;
        try {
          msg = moniflowExport(ctx.source.server);
        } catch (e) {
          msg = '[MoniFlow] Export failed: ' + e;
        }
        try {
          ctx.source.sendSystemMessage(Text.of(String(msg)));
        } catch (e) {
          console.info(msg);
        }
        return 1;
      }),
    ),
  );
});
