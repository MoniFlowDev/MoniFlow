/**
 * In-app `prompt()` and `confirm()`.
 *
 * The native ones are blocked in some browsers and in embedded views, and they cannot be styled
 * or made to carry a dangerous-action warning. This is the same thing as a `<dialog>`: it resolves
 * to the entered text, `true` for a plain confirmation, or `null` if it was cancelled.
 */
import { need } from './dom';

export interface AskOptions {
  title: string;
  message?: string;
  /** Initial text to show an input for. Omit for a yes/no confirmation. */
  input?: string;
  okLabel?: string;
  /** Style the confirm button as destructive. */
  danger?: boolean;
}

export function ask(options: AskOptions): Promise<string | true | null> {
  const { title, message = '', input, okLabel = 'OK', danger = false } = options;

  return new Promise((resolve) => {
    const dialog = need<HTMLDialogElement>('#askDialog');
    const form = need<HTMLFormElement>('#askForm');
    const field = need<HTMLInputElement>('#askInput');
    const confirm = need<HTMLButtonElement>('#askOk');
    const cancel = need<HTMLButtonElement>('#askCancel');

    need('#askTitle').textContent = title;
    need('#askMessage').textContent = message;
    field.hidden = input == null;
    field.value = input ?? '';
    confirm.textContent = okLabel;
    confirm.classList.toggle('danger-fill', danger);

    // Every path out goes through here, so the handlers are always detached exactly once.
    let settled = false;
    const finish = (result: string | true | null): void => {
      if (settled) return;
      settled = true;
      form.onsubmit = null;
      cancel.onclick = null;
      dialog.onclose = null;
      if (dialog.open) dialog.close();
      resolve(result);
    };

    form.onsubmit = (event) => {
      event.preventDefault();
      finish(input == null ? true : field.value);
    };
    cancel.onclick = () => finish(null);
    // Covers Escape and any other way the dialog can be dismissed.
    dialog.onclose = () => finish(null);

    dialog.showModal();
    if (input == null) {
      confirm.focus();
    } else {
      field.focus();
      field.select();
    }
  });
}

/** A yes/no confirmation. Resolves true only if confirmed. */
export async function confirmAction(
  options: Omit<AskOptions, 'input'>,
): Promise<boolean> {
  return (await ask(options)) === true;
}

/** A text prompt. Resolves null if cancelled. */
export async function promptText(
  options: AskOptions & { input: string },
): Promise<string | null> {
  const result = await ask(options);
  return typeof result === 'string' ? result : null;
}
