export type SearchKind =
  | "nav"
  | "profile"
  | "import"
  | "library"
  | "artist"
  | "genre";

const artistOpeners = new Set<(name: string) => void>();
const genreOpeners = new Set<(label: string) => void>();
const focusers = new Set<() => void>();

export function subscribeOpenArtist(handler: (name: string) => void): () => void {
  artistOpeners.add(handler);
  return () => {
    artistOpeners.delete(handler);
  };
}

export function requestOpenArtist(name: string): void {
  artistOpeners.forEach((handler) => handler(name));
}

export function subscribeOpenGenre(handler: (label: string) => void): () => void {
  genreOpeners.add(handler);
  return () => {
    genreOpeners.delete(handler);
  };
}

export function requestOpenGenre(label: string): void {
  genreOpeners.forEach((handler) => handler(label));
}

export function subscribeFocusSearch(handler: () => void): () => void {
  focusers.add(handler);
  return () => {
    focusers.delete(handler);
  };
}

export function requestFocusSearch(): void {
  focusers.forEach((handler) => handler());
}
