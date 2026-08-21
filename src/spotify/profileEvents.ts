import type { SpotifyProfile } from "./profiles";
import type { SavedSpotifyImport } from "./importCache";

const profileChangers = new Set<() => void>();
const profileOpeners = new Set<(profile: SpotifyProfile) => void>();
const importChangers = new Set<() => void>();
const importOpeners = new Set<(item: SavedSpotifyImport) => void>();

export function subscribeProfilesChange(handler: () => void): () => void {
  profileChangers.add(handler);
  return () => {
    profileChangers.delete(handler);
  };
}

export function notifyProfilesChanged(): void {
  profileChangers.forEach((handler) => handler());
}

export function subscribeOpenProfile(handler: (profile: SpotifyProfile) => void): () => void {
  profileOpeners.add(handler);
  return () => {
    profileOpeners.delete(handler);
  };
}

export function requestOpenProfile(profile: SpotifyProfile): void {
  profileOpeners.forEach((handler) => handler(profile));
}

export function subscribeImportsChange(handler: () => void): () => void {
  importChangers.add(handler);
  return () => {
    importChangers.delete(handler);
  };
}

export function notifyImportsChanged(): void {
  importChangers.forEach((handler) => handler());
}

export function subscribeOpenImport(handler: (item: SavedSpotifyImport) => void): () => void {
  importOpeners.add(handler);
  return () => {
    importOpeners.delete(handler);
  };
}

export function requestOpenImport(item: SavedSpotifyImport): void {
  importOpeners.forEach((handler) => handler(item));
}
