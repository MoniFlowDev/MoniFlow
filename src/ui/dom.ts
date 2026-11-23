/** Small DOM helpers, so the view code can stay about what it is drawing. */

/** The one element matching a selector. Throws if the markup does not have it. */
export function need<T extends Element = HTMLElement>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`Missing element: ${selector}`);
  return element;
}

/** The one element matching a selector, or null. */
export function find<T extends Element = HTMLElement>(selector: string): T | null {
  return document.querySelector<T>(selector);
}

export function all<T extends Element = HTMLElement>(
  selector: string,
  root: ParentNode = document,
): T[] {
  return [...root.querySelectorAll<T>(selector)];
}

/** Mark exactly one option in a segmented control as active, by its data attribute. */
export function setActive(selector: string, attribute: string, value: string): void {
  for (const button of all(selector)) {
    button.classList.toggle('active', button.dataset[attribute] === value);
  }
}

/** Offer a generated file for download. */
export function download(filename: string, content: string, type = 'application/json'): void {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  // Give the click time to start before tearing the URL down.
  setTimeout(() => {
    URL.revokeObjectURL(url);
    link.remove();
  }, 500);
}

/** Read a chosen file as JSON, then clear the input so the same file can be picked again. */
export function readJsonFile<T = unknown>(
  input: HTMLInputElement,
  onLoad: (data: T) => void,
  onError: (message: string) => void,
): void {
  const file = input.files?.[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = () => {
    try {
      onLoad(JSON.parse(String(reader.result)) as T);
    } catch {
      onError('That file is not valid JSON');
    }
    input.value = '';
  };
  reader.readAsText(file);
}

/** A filename-safe version of a plan name. */
export function slugify(name: string): string {
  return name.replace(/[^\w-]+/g, '_');
}
