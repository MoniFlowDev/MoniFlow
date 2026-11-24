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

/** A filename-safe version of a plan name. */
export function slugify(name: string): string {
  return name.replace(/[^\w-]+/g, '_');
}
