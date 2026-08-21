import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { SpotifyStatus, SpotifySyncProgress } from "./types";
import { isTauri } from "../local/api";
import {
  getActiveProfile,
  readActiveClientId,
  saveProfile,
  touchActiveClientId,
} from "./profiles";

export function readStoredClientId(): string {
  return readActiveClientId();
}

export function storeClientId(id: string): void {
  touchActiveClientId(id);
}

export function rememberProfile(
  name: string,
  clientId: string,
  meta?: Parameters<typeof saveProfile>[2],
) {
  return saveProfile(name, clientId, meta);
}

/** Bascule session Spotify + dictionnaire vers ce profil (fichiers séparés). */
export async function activateSpotifyProfile(profileId: string): Promise<void> {
  if (!isTauri() || !profileId.trim()) {
    return;
  }
  await invoke("activate_spotify_profile", { profileId: profileId.trim() });
}

export async function activateActiveSpotifyProfile(): Promise<void> {
  const active = getActiveProfile();
  if (active) {
    await activateSpotifyProfile(active.id);
  }
}

export async function spotifyStatusSummary(): Promise<SpotifyStatus> {
  await activateActiveSpotifyProfile();
  return invoke<SpotifyStatus>("spotify_status_summary");
}

export async function spotifyStatus(): Promise<SpotifyStatus> {
  await activateActiveSpotifyProfile();
  return invoke<SpotifyStatus>("spotify_status");
}

/** Charge les noms d’artistes d’un dossier (après le boot léger). */
export async function fetchGroupArtists(folder: string): Promise<string[]> {
  if (!isTauri() || !folder.trim()) {
    return [];
  }
  return invoke<string[]>("knowledge_group_artists", { folder: folder.trim() });
}

/** Boot Spotify : résumé immédiat, puis groupes en fond. */
export async function spotifyBoot(
  onSummary: (status: SpotifyStatus) => void,
): Promise<SpotifyStatus> {
  const summary = await spotifyStatusSummary();
  onSummary(summary);
  let full = await spotifyStatus();
  // Reprise silencieuse (refresh token) — jamais d’ouverture navigateur ici.
  if (!full.connected) {
    try {
      full = await spotifyResumeSession();
      onSummary(full);
    } catch {
      /* session absente / tokens illisibles → UI de reconnexion */
    }
  }
  return full;
}

/** Refresh token sans OAuth navigateur. Échoue si pas de session lisible. */
export async function spotifyResumeSession(): Promise<SpotifyStatus> {
  await activateActiveSpotifyProfile();
  return invoke<SpotifyStatus>("spotify_resume_session");
}

export async function spotifyConnect(clientId: string): Promise<SpotifyStatus> {
  storeClientId(clientId);
  await activateActiveSpotifyProfile();
  return invoke<SpotifyStatus>("spotify_connect", { clientId });
}

export async function spotifySyncLikes(): Promise<SpotifyStatus> {
  await activateActiveSpotifyProfile();
  return invoke<SpotifyStatus>("spotify_sync_likes");
}

export async function spotifyEnrichKnowledge(): Promise<SpotifyStatus> {
  await activateActiveSpotifyProfile();
  return invoke<SpotifyStatus>("spotify_enrich_knowledge");
}

export async function spotifyDisconnect(): Promise<SpotifyStatus> {
  await activateActiveSpotifyProfile();
  return invoke<SpotifyStatus>("spotify_disconnect");
}

export function onSpotifySyncProgress(
  handler: (progress: SpotifySyncProgress) => void,
): Promise<() => void> {
  return listen<SpotifySyncProgress>("spotify-sync-progress", (event) => {
    handler(event.payload);
  });
}

export { isTauri };
