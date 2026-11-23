import { need } from './dom';

const DEFAULT_MS = 2600;

let hideTimer: ReturnType<typeof setTimeout> | null = null;

/** A brief message in the corner. A new one replaces whatever is showing. */
export function toast(message: string, ms = DEFAULT_MS): void {
  const element = need('#toast');
  element.textContent = message;
  element.hidden = false;

  if (hideTimer) clearTimeout(hideTimer);
  hideTimer = setTimeout(() => {
    hideTimer = null;
    element.hidden = true;
  }, ms);
}
