/**
 * Reading GregTech's material naming.
 *
 * GregTech makes the same material in a dozen shapes, and the id spells out which:
 * `gtceu:steel_ingot`, `gtceu:steel_nugget`, `gtceu:small_steel_dust`, `gtceu:double_steel_plate`.
 * Two things fall out of that, and the recipe ranking needs both:
 *
 *   - which *form* an item is, so we can tell a real production recipe from one that just turns
 *     another shape of the same material back into this one (nuggets -> ingot);
 *   - how many base units (ingots) a given shape is worth, so an unknown shape's cost can be
 *     estimated from the ingot's.
 */

/** Where a shape sits relative to the base ingot/gem/dust of its material. */
export type MaterialFormKind =
  /** The base form: the ingot or gem itself. */
  | 'main'
  /** Comes before the base form (dust, ore, hot ingot). */
  | 'upstream'
  /** Made from the base form (nugget, plate, rod, the molten fluid). */
  | 'derived'
  /** Not a recognisable material shape. */
  | null;

export interface MaterialForm {
  material: string | null;
  form: MaterialFormKind;
}

const NOT_A_MATERIAL: MaterialForm = { material: null, form: null };

const FORM_PREFIXES = [
  'tiny_',
  'small_',
  'long_',
  'double_',
  'dense_',
  'hot_',
  'molten_',
  'liquid_',
  'raw_',
  'pure_',
  'impure_',
  'purified_',
  'refined_',
  'crushed_',
  'chipped_',
  'flawed_',
  'flawless_',
  'exquisite_',
];

/** Prefixes that mean "an earlier ore-processing stage", whatever the suffix says. */
const UPSTREAM_PREFIXES = ['raw_', 'crushed_', 'purified_', 'refined_', 'pure_', 'impure_'];

const MAIN_SUFFIXES = ['_ingot', '_gem'];
const UPSTREAM_SUFFIXES = ['_dust', '_ore'];
const DERIVED_SUFFIXES = [
  '_nugget',
  '_block',
  '_plate',
  '_rod',
  '_bolt',
  '_screw',
  '_gear',
  '_foil',
  '_ring',
  '_round',
  '_spring',
  '_frame',
  '_lens',
  '_single_wire',
  '_double_wire',
  '_quadruple_wire',
  '_octal_wire',
  '_hex_wire',
  '_fine_wire',
];

const MAGNETIC = 'magnetic_';

export function materialForm(id: string, isFluid: boolean): MaterialForm {
  const base = classify(id, isFluid);
  // Magnetic variants are polarised from the plain material, so they are derived from it.
  if (base.material?.startsWith(MAGNETIC)) {
    return { material: base.material.slice(MAGNETIC.length), form: 'derived' };
  }
  return base;
}

function classify(id: string, isFluid: boolean): MaterialForm {
  const path = String(id).split(':').pop()!;

  let prefix = '';
  let rest = path;
  for (const p of FORM_PREFIXES) {
    if (rest.startsWith(p)) {
      prefix = p;
      rest = rest.slice(p.length);
      break;
    }
  }

  // Every fluid form of a material (molten, liquid, plasma) is made from the solid.
  if (isFluid) return { material: rest, form: 'derived' };

  for (const suffix of MAIN_SUFFIXES) {
    if (!rest.endsWith(suffix)) continue;
    const material = rest.slice(0, -suffix.length);
    // A hot ingot comes out of the blast furnace *before* the ingot; a double ingot is made from it.
    const form: MaterialFormKind =
      prefix === 'hot_' ? 'upstream' : prefix === 'double_' ? 'derived' : 'main';
    return { material, form };
  }

  for (const suffix of UPSTREAM_SUFFIXES) {
    if (!rest.endsWith(suffix)) continue;
    // Tiny and small piles are split off a full dust rather than feeding into it.
    const split = prefix === 'tiny_' || prefix === 'small_';
    return { material: rest.slice(0, -suffix.length), form: split ? 'derived' : 'upstream' };
  }

  if (UPSTREAM_PREFIXES.includes(prefix)) {
    return { material: rest.replace(/_(dust|ore)$/, ''), form: 'upstream' };
  }

  for (const suffix of DERIVED_SUFFIXES) {
    if (rest.endsWith(suffix)) return { material: rest.slice(0, -suffix.length), form: 'derived' };
  }

  if (prefix === 'long_' || prefix === 'dense_' || prefix === 'double_') {
    return { material: rest.replace(/_(rod|plate)$/, ''), form: 'derived' };
  }

  return NOT_A_MATERIAL;
}

/**
 * How many ingots' worth of material one of this shape holds, following GregTech's standard
 * amounts. Zero means we don't know. Order matters: the narrower patterns come first.
 */
const UNITS_BY_SHAPE: ReadonlyArray<[RegExp, number]> = [
  [/^tiny_.*_dust$/, 1 / 9],
  [/^small_.*_dust$/, 1 / 4],
  [/_nugget$/, 1 / 9],
  [/_block$/, 9],
  [/^double_.*_plate$/, 2],
  [/^dense_.*_plate$/, 9],
  [/_plate$/, 1],
  [/^long_.*_rod$/, 1],
  [/_rod$/, 1 / 2],
  [/_bolt$/, 1 / 8],
  [/_screw$/, 1 / 8],
  [/^small_.*_gear$/, 1],
  [/_gear$/, 4],
  [/_foil$/, 1 / 4],
  [/_ring$/, 1 / 4],
  [/_round$/, 1 / 9],
  [/_spring$/, 1],
  [/_frame$/, 2],
  [/^double_.*_ingot$/, 2],
  [/_fine_wire$/, 1 / 8],
  [/_single_wire$/, 1 / 2],
  [/_double_wire$/, 1],
  [/_quadruple_wire$/, 2],
  [/_octal_wire$/, 4],
  [/_hex_wire$/, 8],
];

/** A fluid material is measured in mB, and 144 mB is one ingot. */
const MB_PER_INGOT = 144;

export function materialUnits(id: string, isFluid: boolean): number {
  if (isFluid) return 1 / MB_PER_INGOT;
  const path = String(id).split(':').pop()!;
  for (const [pattern, units] of UNITS_BY_SHAPE) {
    if (pattern.test(path)) return units;
  }
  return 0;
}
