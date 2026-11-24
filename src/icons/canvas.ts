/**
 * Canvas plumbing for drawing icons.
 *
 * Everything is drawn with smoothing off so 16x16 Minecraft textures scale up as crisp pixels,
 * and only the final downscale of a 3D render turns smoothing back on. `OffscreenCanvas` is used
 * where available, since none of this needs to be in the document.
 */

/** One icon in the atlas. A 16px texture scales 4x, which stays pixel-perfect. */
export const ICON_PX = 64;

/** Anything we can draw on and draw from. */
export type AnyCanvas = OffscreenCanvas | HTMLCanvasElement;
export type Drawable = AnyCanvas | ImageBitmap;

export function makeCanvas(width: number, height: number): AnyCanvas {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(width, height);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

type Context2D = OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D;

export function context(canvas: AnyCanvas, smooth = false): Context2D {
  const ctx = canvas.getContext('2d') as Context2D | null;
  if (!ctx) throw new Error('2D canvas context unavailable');
  ctx.imageSmoothingEnabled = smooth;
  return ctx;
}

/** Multiply a texture by a colour, keeping its alpha — how the game tints material textures. */
export function tinted(source: Drawable, color: string | null): AnyCanvas {
  const canvas = makeCanvas(source.width, source.height);
  const ctx = context(canvas);
  ctx.drawImage(source, 0, 0);
  if (!color) return canvas;
  ctx.globalCompositeOperation = 'multiply';
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.globalCompositeOperation = 'destination-in';
  ctx.drawImage(source, 0, 0);
  return canvas;
}

/** Flatten already-tinted layers into one square face, optionally darkened. */
export function stack(layers: readonly Drawable[], shade = 0): AnyCanvas {
  const size = Math.max(...layers.map((l) => l.width));
  const canvas = makeCanvas(size, size);
  const ctx = context(canvas);
  for (const layer of layers) {
    ctx.drawImage(layer, 0, 0, layer.width, layer.height, 0, 0, size, size);
  }
  if (shade) {
    ctx.globalCompositeOperation = 'source-atop';
    ctx.fillStyle = `rgba(0,0,0,${shade})`;
    ctx.fillRect(0, 0, size, size);
  }
  return canvas;
}

/** A flat item icon. `round` clips it to a circle, which is how fluids are drawn. */
export function flatIcon(layers: readonly Drawable[], round = false): AnyCanvas {
  const canvas = makeCanvas(ICON_PX, ICON_PX);
  const ctx = context(canvas);
  const inset = round ? Math.round(ICON_PX / 16) : 0;

  if (round) {
    ctx.beginPath();
    ctx.arc(ICON_PX / 2, ICON_PX / 2, ICON_PX / 2 - inset, 0, Math.PI * 2);
    ctx.clip();
  }

  const face = stack(layers);
  ctx.drawImage(
    face,
    0,
    0,
    face.width,
    face.height,
    inset,
    inset,
    ICON_PX - inset * 2,
    ICON_PX - inset * 2,
  );
  return canvas;
}

/**
 * An isometric block from its top, front and side faces. Drawn at double size with sharp pixels,
 * then scaled down smoothly so the diagonal edges do not alias.
 */
export function cubeIcon(
  top: readonly Drawable[],
  front: readonly Drawable[],
  side: readonly Drawable[],
): AnyCanvas {
  const big = ICON_PX * 2;
  const unit = big / 64;
  const scratch = makeCanvas(big, big);
  const ctx = context(scratch);

  // Each face is drawn through the 2D transform that skews a square into its isometric position.
  const face = (
    source: AnyCanvas,
    a: number,
    b: number,
    c: number,
    d: number,
    e: number,
    f: number,
  ): void => {
    const n = source.width;
    ctx.setTransform(a / n, b / n, c / n, d / n, e, f);
    ctx.drawImage(source, 0, 0);
  };

  face(stack(top), 28 * unit, 14 * unit, -28 * unit, 14 * unit, 32 * unit, 4 * unit);
  face(stack(front, 0.2), 28 * unit, 14 * unit, 0, 28 * unit, 4 * unit, 18 * unit);
  face(stack(side, 0.4), 28 * unit, -14 * unit, 0, 28 * unit, 32 * unit, 32 * unit);
  ctx.setTransform(1, 0, 0, 1, 0, 0);

  const out = makeCanvas(ICON_PX, ICON_PX);
  context(out, true).drawImage(scratch, 0, 0, big, big, 0, 0, ICON_PX, ICON_PX);
  return out;
}

/** Darkened copies of a texture, cached per texture so a repeated face is only shaded once. */
const shadeCache = new WeakMap<Drawable, Map<string, Drawable>>();

export function shadedTexture(texture: Drawable, shade: number): Drawable {
  if (shade >= 0.999) return texture;

  let cached = shadeCache.get(texture);
  if (!cached) shadeCache.set(texture, (cached = new Map()));
  const key = shade.toFixed(2);
  const existing = cached.get(key);
  if (existing) return existing;

  const canvas = makeCanvas(texture.width, texture.height);
  const ctx = context(canvas);
  ctx.drawImage(texture, 0, 0);
  ctx.globalCompositeOperation = 'source-atop';
  ctx.fillStyle = `rgba(0,0,0,${(1 - shade).toFixed(3)})`;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  cached.set(key, canvas);
  return canvas;
}

/** PNG bytes for a canvas, whichever API this canvas type offers. */
export async function toPngBlob(canvas: AnyCanvas): Promise<Blob> {
  if ('convertToBlob' in canvas) return canvas.convertToBlob({ type: 'image/png' });
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('toBlob failed'))),
      'image/png',
    );
  });
}
