import type { ItemKey } from './types';

/**
 * A stable colour per item, so the same fluid is the same colour on every line of the graph
 * without anyone having to assign one. Fluids are pushed into the cyan-to-blue range to tell
 * them apart from items at a glance.
 */
export function itemColor(name: ItemKey, fluid?: boolean): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  const hue = fluid ? 180 + (hash % 70) : hash % 360;
  return `hsl(${hue} ${fluid ? 70 : 62}% ${fluid ? 60 : 62}%)`;
}
