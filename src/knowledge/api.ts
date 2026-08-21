import { invoke } from "@tauri-apps/api/core";
import { isTauri } from "../local/api";
import { activateActiveSpotifyProfile } from "../spotify/api";
import { getActiveProfile } from "../spotify/profiles";
import type { KnowledgeDump } from "./types";

const EMPTY: KnowledgeDump = {
  version: 1,
  syncedAt: null,
  displayName: null,
  likedCount: 0,
  artists: {},
};

type CacheEntry = {
  profileId: string | null;
  dump: KnowledgeDump;
  at: number;
};

let mem: CacheEntry | null = null;
const TTL_MS = 90_000;

export function invalidateKnowledgeCache(): void {
  mem = null;
}

export async function fetchKnowledgeDump(force = false): Promise<KnowledgeDump> {
  if (!isTauri()) {
    return EMPTY;
  }
  const profileId = getActiveProfile()?.id ?? null;
  if (
    !force &&
    mem &&
    mem.profileId === profileId &&
    Date.now() - mem.at < TTL_MS
  ) {
    return mem.dump;
  }
  await activateActiveSpotifyProfile();
  const dump = await invoke<KnowledgeDump>("knowledge_dump");
  mem = { profileId, dump, at: Date.now() };
  return dump;
}

export type CloudKnowledgeSyncResult = {
  pushed: number;
  filled: number;
  lastSyncAt: number;
  profileId: string;
};

/** Push miroir + fill gaps depuis le pool cloud (Tauri). */
export async function syncKnowledgeCloud(
  userId: string,
): Promise<CloudKnowledgeSyncResult> {
  if (!isTauri()) {
    throw new Error("Sync knowledge disponible uniquement dans l’app.");
  }
  const result = await invoke<CloudKnowledgeSyncResult>("knowledge_cloud_sync", {
    userId,
  });
  invalidateKnowledgeCache();
  return result;
}

export { isTauri };
