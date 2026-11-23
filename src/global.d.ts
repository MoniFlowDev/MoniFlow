/**
 * The File System Access API, which TypeScript's DOM library does not yet declare.
 * Only the narrow slice the icon builder uses: picking a folder to read.
 */
interface DirectoryPickerOptions {
  /** Remembers the last folder chosen under this id. */
  id?: string;
  mode?: 'read' | 'readwrite';
}

interface Window {
  showDirectoryPicker?: (options?: DirectoryPickerOptions) => Promise<FileSystemDirectoryHandle>;
}
