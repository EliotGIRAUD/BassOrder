import type { SavedLibrary } from "./libraryCache";

const openers = new Set<(lib: SavedLibrary) => void>();
const changers = new Set<() => void>();

export function subscribeOpenAnalysis(handler: (lib: SavedLibrary) => void): () => void {
  openers.add(handler);
  return () => {
    openers.delete(handler);
  };
}

export function requestOpenAnalysis(lib: SavedLibrary): void {
  openers.forEach((handler) => handler(lib));
}

export function subscribeHistoryChange(handler: () => void): () => void {
  changers.add(handler);
  return () => {
    changers.delete(handler);
  };
}

export function notifyHistoryChanged(): void {
  changers.forEach((handler) => handler());
}
