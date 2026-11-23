/**
 * Exporting the graph as a standalone SVG file.
 *
 * The live graph relies on the page's stylesheet and carries interaction-only bits (hit areas,
 * flow animations, buttons). A file has to stand on its own, so the clone gets a real viewBox, a
 * minimal inline stylesheet, and none of the interactive extras.
 */
import type { Bounds } from './coordinates';
import { SVG_NS } from './svg';

const PADDING = 40;
/** Extra height so the legend baked into the page does not clip the drawing. */
const EXTRA_HEIGHT = 80;

/** Only what the exported drawing needs, since the page's stylesheet will not be there. */
const STYLES = `
  svg{background:#0b1117;font-family:system-ui,'Segoe UI',sans-serif}
  .card{fill:#18222d;stroke:#354a5f}
  .flow{fill:none;opacity:.6;stroke-linecap:round}
  .g-label rect{fill:#0e141bdd;stroke:#2a3a4b}
  .g-label text{font:11px Consolas,monospace;fill:#9fb0c2}
  .g-text{fill:#e3ebf3}`;

/** Elements that only make sense in the live, interactive graph. */
const INTERACTIVE_ONLY = '.anim, .hit, .g-btn, .g-ico';
/** Transient state classes. */
const TRANSIENT = ['hot', 'dim'];

export function exportGraphSvg(svg: SVGSVGElement, bounds: Bounds): string {
  const clone = svg.cloneNode(true) as SVGSVGElement;

  const width = bounds.width + PADDING * 2;
  const height = bounds.height + PADDING * 2 + EXTRA_HEIGHT;
  clone.setAttribute(
    'viewBox',
    `${bounds.minX - PADDING} ${bounds.minY - PADDING} ${width} ${height}`,
  );
  clone.setAttribute('width', String(width));
  clone.setAttribute('height', String(height));

  // The root group carries the pan/zoom transform, which the viewBox now handles.
  clone.querySelector('g')?.removeAttribute('transform');

  clone.querySelectorAll(INTERACTIVE_ONLY).forEach((node) => node.remove());
  clone.classList.remove('hovering');
  for (const className of TRANSIENT) {
    clone.querySelectorAll(`.${className}`).forEach((node) => node.classList.remove(className));
  }

  const style = document.createElementNS(SVG_NS, 'style');
  style.textContent = STYLES;
  clone.insertBefore(style, clone.firstChild);

  return new XMLSerializer().serializeToString(clone);
}
