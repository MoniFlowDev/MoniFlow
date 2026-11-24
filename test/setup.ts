import { vi } from 'vitest';

// sv-router preloads links with an IntersectionObserver, which jsdom does not implement.
if (typeof window !== 'undefined') {
  vi.stubGlobal(
    'IntersectionObserver',
    class {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    },
  );
}
