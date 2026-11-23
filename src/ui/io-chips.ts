/**
 * A recipe's ingredients and products as a row of chips.
 *
 * Most chips just say how much of what. The interesting ones are the ingredients that come back:
 * a tool shows its fractional cost ("1/256 Iron Mortar") rather than a whole item, a kept item
 * says so, and something handed back after crafting is marked as returned. Those three are the
 * difference between a crafting chain's real cost and a nonsensical one.
 */
import { formatAmount, formatNumber } from '../core/format';
import { escapeHtml } from '../core/html';
import { itemNameHtml } from '../core/item-names';
import type { ItemKey, RecipeIO } from '../core/types';
import { itemDot } from './badges';

interface Chip {
  amount: string;
  className: string;
  title: string;
}

function describe(io: RecipeIO): Chip {
  if (io.uses) {
    const about = io.usesEstimated ? 'about ' : '';
    const caveat = io.usesEstimated
      ? ' (estimated: re-export with exporter v8 for exact durability)'
      : '';
    return {
      amount: `1/${formatNumber(io.uses)}`,
      className: ' tool',
      title: `${io.item} — tool with ${about}${io.uses.toLocaleString()} uses; one use per craft${caveat}`,
    };
  }
  if (io.kept) {
    return { amount: 'kept', className: ' kept', title: `${io.item} — not used up` };
  }
  if (io.returned) {
    return {
      amount: formatAmount(Number(io.amount), io.fluid),
      className: ' returned',
      title: `${io.item} — given back after crafting`,
    };
  }
  return {
    amount: formatAmount(Number(io.amount), io.fluid),
    className: '',
    title: io.item,
  };
}

/** `highlight` marks the chip for the item currently being chosen in the picker. */
export function ioChips(list: readonly RecipeIO[], highlight?: ItemKey): string {
  return list
    .map((io) => {
      const chip = describe(io);
      const highlighted = io.item === highlight ? ' hl' : '';
      const chance =
        io.chance != null && Number(io.chance) !== 100
          ? ` <span class="muted">${io.chance}%</span>`
          : '';

      return (
        `<span class="chip${highlighted}${chip.className}" title="${escapeHtml(chip.title)}">` +
        `${itemDot(io.item, !!io.fluid, 'chip-dot')}` +
        `<span class="amt">${chip.amount}</span> ${itemNameHtml(io.item)}${chance}</span>`
      );
    })
    .join('');
}
