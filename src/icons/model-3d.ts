/**
 * Rendering a Minecraft block model the way the inventory shows it.
 *
 * A model is a list of boxes, each with up to six textured faces. To draw one we put its corners
 * through the same camera the game uses for item slots (a fixed rotation and scale), drop the faces
 * pointing away from us, sort what's left back-to-front, and paint each quad by solving for the 2D
 * affine transform that maps its texture onto its projected corners. That is exact for a
 * parallelogram, which every axis-aligned box face projects to under this camera.
 *
 * This is what makes an anvil, a hopper or a GregTech machine look like itself instead of a flat
 * square of its side texture.
 */
import {
  context,
  ICON_PX,
  makeCanvas,
  shadedTexture,
  type AnyCanvas,
  type Drawable,
} from './canvas';

/** The inventory camera from `minecraft:block/block`. */
const DEFAULT_GUI: Required<DisplayTransform> = {
  rotation: [30, 225, 0],
  translation: [0, 0, 0],
  scale: [0.625, 0.625, 0.625],
};

/** The game's fixed per-direction face brightness. */
const FACE_SHADE: Record<string, number> = {
  up: 1.0,
  down: 0.5,
  north: 0.8,
  south: 0.8,
  west: 0.6,
  east: 0.6,
};

/** Model space is 0..16 per axis, with 8 at the centre. */
const MODEL_SIZE = 16;
const MODEL_CENTRE = 8;

/** Texture coordinates are in 16ths regardless of the texture's real resolution. */
const UV_UNITS = 16;

export type Vec3 = [number, number, number];
export type Direction = 'north' | 'south' | 'east' | 'west' | 'up' | 'down';

export interface DisplayTransform {
  rotation?: Vec3;
  translation?: Vec3;
  scale?: Vec3;
}

export interface ModelFace {
  texture?: string;
  /** `[u1, v1, u2, v2]` in 16ths; absent means derive it from the box's own geometry. */
  uv?: number[];
  /** Texture rotation in degrees, a multiple of 90. */
  rotation?: number;
  tintindex?: number;
}

export interface ModelElement {
  from?: Vec3;
  to?: Vec3;
  faces?: Partial<Record<Direction, ModelFace>>;
  rotation?: { angle?: number; axis?: 'x' | 'y' | 'z'; origin?: Vec3 };
  shade?: boolean;
}

/** Resolves a face's texture reference to something drawable, or null to skip the face. */
export type TextureLookup = (ref: string) => Drawable | null;

/** Face corners as `[top-left, top-right, bottom-right, bottom-left]` in texture orientation. */
function faceCorners(dir: Direction, from: Vec3, to: Vec3): Vec3[] | null {
  const [fx, fy, fz] = from;
  const [tx, ty, tz] = to;
  switch (dir) {
    case 'north':
      return [
        [tx, ty, fz],
        [fx, ty, fz],
        [fx, fy, fz],
        [tx, fy, fz],
      ];
    case 'south':
      return [
        [fx, ty, tz],
        [tx, ty, tz],
        [tx, fy, tz],
        [fx, fy, tz],
      ];
    case 'west':
      return [
        [fx, ty, fz],
        [fx, ty, tz],
        [fx, fy, tz],
        [fx, fy, fz],
      ];
    case 'east':
      return [
        [tx, ty, tz],
        [tx, ty, fz],
        [tx, fy, fz],
        [tx, fy, tz],
      ];
    case 'up':
      return [
        [fx, ty, fz],
        [tx, ty, fz],
        [tx, ty, tz],
        [fx, ty, tz],
      ];
    case 'down':
      return [
        [fx, fy, tz],
        [tx, fy, tz],
        [tx, fy, fz],
        [fx, fy, fz],
      ];
    default:
      return null;
  }
}

/** The UVs the game assumes when a face does not give any: the box projected onto that face. */
function defaultUv(dir: Direction, from: Vec3, to: Vec3): number[] {
  const [fx, fy, fz] = from;
  const [tx, ty, tz] = to;
  const S = MODEL_SIZE;
  switch (dir) {
    case 'north':
      return [S - tx, S - ty, S - fx, S - fy];
    case 'south':
      return [fx, S - ty, tx, S - fy];
    case 'west':
      return [fz, S - ty, tz, S - fy];
    case 'east':
      return [S - tz, S - ty, S - fz, S - fy];
    case 'up':
      return [fx, fz, tx, tz];
    case 'down':
      return [fx, S - tz, tx, S - fz];
    default:
      return [0, 0, S, S];
  }
}

function rotateAround(p: Vec3, origin: Vec3, axis: 'x' | 'y' | 'z', degrees: number): Vec3 {
  const a = (degrees * Math.PI) / 180;
  const cos = Math.cos(a);
  const sin = Math.sin(a);
  const x = p[0] - origin[0];
  const y = p[1] - origin[1];
  const z = p[2] - origin[2];

  const r: Vec3 =
    axis === 'x'
      ? [x, y * cos - z * sin, y * sin + z * cos]
      : axis === 'y'
        ? [x * cos + z * sin, y, -x * sin + z * cos]
        : [x * cos - y * sin, x * sin + y * cos, z];

  return [r[0] + origin[0], r[1] + origin[1], r[2] + origin[2]];
}

type Matrix3 = [Vec3, Vec3, Vec3];

/** The display rotation matrix, matching JOML's `rotationXYZ` (Rx · Ry · Rz) as the game uses it. */
function displayMatrix(rotation: Vec3): Matrix3 {
  const [ax, ay, az] = rotation.map((d) => (d * Math.PI) / 180) as Vec3;
  const [cx, sx] = [Math.cos(ax), Math.sin(ax)];
  const [cy, sy] = [Math.cos(ay), Math.sin(ay)];
  const [cz, sz] = [Math.cos(az), Math.sin(az)];

  const rx: Matrix3 = [
    [1, 0, 0],
    [0, cx, -sx],
    [0, sx, cx],
  ];
  const ry: Matrix3 = [
    [cy, 0, sy],
    [0, 1, 0],
    [-sy, 0, cy],
  ];
  const rz: Matrix3 = [
    [cz, -sz, 0],
    [sz, cz, 0],
    [0, 0, 1],
  ];

  const multiply = (a: Matrix3, b: Matrix3): Matrix3 =>
    a.map((row) =>
      b[0]!.map((_, j) => row.reduce((sum, v, k) => sum + v * b[k]![j]!, 0)),
    ) as Matrix3;

  return multiply(multiply(rx, ry), rz);
}

interface Quad {
  /** Corners in camera space, in texture order. */
  corners: Vec3[];
  texture: Drawable;
  /** Average depth, for back-to-front painting. */
  depth: number;
  uv: number[];
  /** Texture rotation in quarter turns. */
  turns: number;
  shade: number;
}

export function renderModel3D(
  elements: readonly ModelElement[] | null | undefined,
  textureFor: TextureLookup,
  gui?: DisplayTransform,
): AnyCanvas | null {
  const view = { ...DEFAULT_GUI, ...gui };
  const rotation = displayMatrix(view.rotation);
  const scale = view.scale;
  const translation = view.translation;

  /** Model space -> camera space, normalised so the block spans roughly -0.5..0.5. */
  const toCamera = (p: Vec3): Vec3 => {
    const v: Vec3 = [
      ((p[0] - MODEL_CENTRE) / MODEL_SIZE) * scale[0],
      ((p[1] - MODEL_CENTRE) / MODEL_SIZE) * scale[1],
      ((p[2] - MODEL_CENTRE) / MODEL_SIZE) * scale[2],
    ];
    return [0, 1, 2].map(
      (i) =>
        rotation[i]![0] * v[0] +
        rotation[i]![1] * v[1] +
        rotation[i]![2] * v[2] +
        translation[i]! / MODEL_SIZE,
    ) as Vec3;
  };

  const quads = collectQuads(elements, textureFor, toCamera);
  if (!quads.length) return null;
  quads.sort((a, b) => a.depth - b.depth);

  return paint(quads);
}

function collectQuads(
  elements: readonly ModelElement[] | null | undefined,
  textureFor: TextureLookup,
  toCamera: (p: Vec3) => Vec3,
): Quad[] {
  const quads: Quad[] = [];

  for (const element of elements ?? []) {
    if (!element?.from || !element.to || !element.faces) continue;
    const spin = element.rotation?.angle ? element.rotation : null;

    for (const [dir, face] of Object.entries(element.faces) as [Direction, ModelFace][]) {
      const texture = face?.texture ? textureFor(face.texture) : null;
      if (!texture) continue;

      let corners = faceCorners(dir, element.from, element.to);
      if (!corners) continue;
      if (spin) {
        corners = corners.map((p) =>
          rotateAround(p, spin.origin ?? [8, 8, 8], spin.axis ?? 'y', spin.angle!),
        );
      }
      const projected = corners.map(toCamera);

      // Outward normal is down x right; the face is visible when it points at the camera (+z).
      const across: Vec3 = [
        projected[1]![0] - projected[0]![0],
        projected[1]![1] - projected[0]![1],
        projected[1]![2] - projected[0]![2],
      ];
      const down: Vec3 = [
        projected[3]![0] - projected[0]![0],
        projected[3]![1] - projected[0]![1],
        projected[3]![2] - projected[0]![2],
      ];
      const normalZ = down[0] * across[1] - down[1] * across[0];
      if (normalZ <= 1e-7) continue;

      quads.push({
        corners: projected,
        texture,
        depth: projected.reduce((sum, p) => sum + p[2], 0) / projected.length,
        uv: face.uv?.length === 4 ? face.uv : defaultUv(dir, element.from, element.to),
        turns: (((Number(face.rotation) || 0) / 90) | 0) & 3,
        shade: element.shade === false ? 1 : (FACE_SHADE[dir] ?? 1),
      });
    }
  }
  return quads;
}

function paint(quads: readonly Quad[]): AnyCanvas {
  // Drawn at double size with pixels sharp, then scaled down smoothly.
  const big = ICON_PX * 2;
  const scratch = makeCanvas(big, big);
  const ctx = context(scratch);

  for (const quad of quads) {
    const screen = quad.corners.map((v) => [big / 2 + v[0] * big, big / 2 - v[1] * big] as const);

    // Texture corners in pixels, rotated by the face's quarter turns.
    const perUnit = quad.texture.width / UV_UNITS;
    const [u1, v1, u2, v2] = quad.uv as [number, number, number, number];
    const unrotated = [
      [u1, v1],
      [u2, v1],
      [u2, v2],
      [u1, v2],
    ] as const;
    const tex = [0, 1, 2, 3].map((i) => {
      const [u, v] = unrotated[(i + quad.turns) % 4]!;
      return [u * perUnit, v * perUnit] as const;
    });

    const transform = affineFit(tex, screen);
    if (!transform) continue;

    // Clip to the face, grown a hair so adjacent faces leave no seam between them.
    const cx = screen.reduce((s, p) => s + p[0], 0) / 4;
    const cy = screen.reduce((s, p) => s + p[1], 0) / 4;
    const grow = (0.4 * big) / 64;

    ctx.save();
    ctx.beginPath();
    screen.forEach(([x, y], i) => {
      const dx = x - cx;
      const dy = y - cy;
      const length = Math.hypot(dx, dy) || 1;
      const gx = x + (dx / length) * grow;
      const gy = y + (dy / length) * grow;
      if (i) ctx.lineTo(gx, gy);
      else ctx.moveTo(gx, gy);
    });
    ctx.closePath();
    ctx.clip();
    ctx.setTransform(...transform);
    ctx.drawImage(shadedTexture(quad.texture, quad.shade), 0, 0);
    ctx.restore();
  }

  const out = makeCanvas(ICON_PX, ICON_PX);
  context(out, true).drawImage(scratch, 0, 0, big, big, 0, 0, ICON_PX, ICON_PX);
  return out;
}

type Affine = [a: number, b: number, c: number, d: number, e: number, f: number];

/**
 * The 2D affine transform taking texture space to the quad's projected corners. Exact, because
 * every axis-aligned box face projects to a parallelogram under this camera. Null if the quad is
 * degenerate (edge-on, or a zero-area UV).
 */
function affineFit(
  tex: ReadonlyArray<readonly [number, number]>,
  screen: ReadonlyArray<readonly [number, number]>,
): Affine | null {
  const du1 = tex[1]![0] - tex[0]![0];
  const dv1 = tex[1]![1] - tex[0]![1];
  const du3 = tex[3]![0] - tex[0]![0];
  const dv3 = tex[3]![1] - tex[0]![1];
  const det = du1 * dv3 - du3 * dv1;
  if (Math.abs(det) < 1e-9) return null;

  const ex1 = screen[1]![0] - screen[0]![0];
  const ey1 = screen[1]![1] - screen[0]![1];
  const ex3 = screen[3]![0] - screen[0]![0];
  const ey3 = screen[3]![1] - screen[0]![1];

  const a = (ex1 * dv3 - ex3 * dv1) / det;
  const c = (ex3 * du1 - ex1 * du3) / det;
  const b = (ey1 * dv3 - ey3 * dv1) / det;
  const d = (ey3 * du1 - ey1 * du3) / det;
  const e = screen[0]![0] - a * tex[0]![0] - c * tex[0]![1];
  const f = screen[0]![1] - b * tex[0]![0] - d * tex[0]![1];

  return [a, b, c, d, e, f];
}
