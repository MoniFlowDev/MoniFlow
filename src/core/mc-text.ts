/**
 * Minecraft colour codes. Item names come out of the game with `§` formatting in them
 * ("§5Advanced §lAlloy§r"), which we want to both strip (for plain text and sorting) and
 * render (so a GregTech material keeps its colour in the UI).
 */
import { escapeHtml } from './html';

/** Code -> CSS colour. Black and dark blue are lifted so they stay readable on a dark background. */
const COLORS: Record<string, string | null> = {
  '0': '#8a8a8a',
  '1': '#5b6cff',
  '2': '#00c000',
  '3': '#00c0c0',
  '4': '#d23a3a',
  '5': '#c040c0',
  '6': '#ffaa00',
  '7': '#bdbdbd',
  '8': '#7a7a7a',
  '9': '#6f7cff',
  a: '#55ff55',
  b: '#55ffff',
  c: '#ff5555',
  d: '#ff55ff',
  e: '#ffff55',
  f: null,
};

const CODE = /§([0-9a-fk-or])/gi;
const ANY_CODE = /§[0-9a-fk-orx]/gi;

interface Style {
  color: string | null;
  bold: boolean;
  italic: boolean;
  underline: boolean;
  strike: boolean;
  obfuscated: boolean;
}

interface Segment extends Style {
  text: string;
}

const PLAIN: Style = {
  color: null,
  bold: false,
  italic: false,
  underline: false,
  strike: false,
  obfuscated: false,
};

export function stripFormatting(text: unknown): string {
  return String(text ?? '').replace(ANY_CODE, '');
}

/** Split formatted text into runs that share a style. */
export function toSegments(text: unknown): Segment[] {
  const str = String(text ?? '');
  const segments: Segment[] = [];
  let style: Style = PLAIN;
  let cursor = 0;

  const pushUpTo = (end: number): void => {
    if (end > cursor) segments.push({ ...style, text: str.slice(cursor, end) });
  };

  CODE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = CODE.exec(str)) !== null) {
    pushUpTo(match.index);
    const code = match[1]!.toLowerCase();
    // A colour code resets every other style, the way Minecraft does it.
    if (code in COLORS) style = { ...PLAIN, color: COLORS[code]! };
    else if (code === 'l') style = { ...style, bold: true };
    else if (code === 'o') style = { ...style, italic: true };
    else if (code === 'n') style = { ...style, underline: true };
    else if (code === 'm') style = { ...style, strike: true };
    else if (code === 'k') style = { ...style, obfuscated: true };
    else if (code === 'r') style = PLAIN;
    cursor = match.index + 2;
  }
  pushUpTo(str.length);
  return segments;
}

function isPlain(s: Segment): boolean {
  return !s.color && !s.bold && !s.italic && !s.underline && !s.strike;
}

/** Escaped HTML with a `<span>` per styled run. Unstyled text comes back as bare escaped text. */
export function toHtml(text: unknown): string {
  const segments = toSegments(text);
  if (segments.length === 1 && isPlain(segments[0]!)) return escapeHtml(segments[0]!.text);
  return segments
    .map((seg) => {
      const css: string[] = [];
      if (seg.color) css.push(`color:${seg.color}`);
      if (seg.bold) css.push('font-weight:700');
      if (seg.italic) css.push('font-style:italic');
      const decoration = [seg.underline && 'underline', seg.strike && 'line-through']
        .filter(Boolean)
        .join(' ');
      if (decoration) css.push(`text-decoration:${decoration}`);
      const text = escapeHtml(seg.text);
      return css.length ? `<span style="${css.join(';')}">${text}</span>` : text;
    })
    .join('');
}
