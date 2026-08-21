import { useEffect } from "react";
import { invokeDb, isTauri } from "./runtime";
import type {
  DbChanged,
  DbLibraryScan,
  DbSaveScanPayload,
  DbScanResult,
  DbSpotifyImport,
  DbSpotifyProfile,
  DbUser,
  LegacyFrontendPayload,
  MigrateResult,
} from "./types";

export async function dbGetPath(): Promise<string | null> {
  if (!isTauri()) return null;
  return invokeDb<string>("db_get_path");
}

export async function dbRevealPath(): Promise<string | null> {
  if (!isTauri()) return null;
  return invokeDb<string>("db_reveal_path");
}

export async function dbListUsers(): Promise<DbUser[]> {
  if (!isTauri()) return [];
  return invokeDb<DbUser[]>("db_list_users");
}

export async function dbUpsertUser(user: DbUser): Promise<DbUser> {
  return invokeDb<DbUser>("db_upsert_user", { user });
}

export async function dbDeleteUser(userId: string): Promise<void> {
  await invokeDb("db_delete_user", { userId });
}

export async function dbGetSession(): Promise<string | null> {
  if (!isTauri()) return null;
  return invokeDb<string | null>("db_get_session");
}

export async function dbSetSession(userId: string | null): Promise<void> {
  if (!isTauri()) return;
  await invokeDb("db_set_session", { userId });
}

export async function dbGetPrefs(userId: string): Promise<Record<string, unknown>> {
  if (!isTauri()) return {};
  return invokeDb("db_get_prefs", { userId });
}

export async function dbSetPrefs(
  userId: string,
  prefs: Record<string, unknown>,
): Promise<void> {
  if (!isTauri()) return;
  await invokeDb("db_set_prefs", { userId, prefs });
}

export async function dbListSpotifyProfiles(userId: string): Promise<DbSpotifyProfile[]> {
  if (!isTauri()) return [];
  return invokeDb("db_list_spotify_profiles", { userId });
}

export async function dbUpsertSpotifyProfile(
  profile: DbSpotifyProfile,
): Promise<DbSpotifyProfile> {
  return invokeDb("db_upsert_spotify_profile", { profile });
}

export async function dbDeleteSpotifyProfile(profileId: string): Promise<void> {
  await invokeDb("db_delete_spotify_profile", { profileId });
}

export async function dbSetActiveSpotifyProfile(
  userId: string,
  profileId: string,
): Promise<void> {
  await invokeDb("db_set_active_spotify_profile", { userId, profileId });
}

export async function dbListScans(userId: string): Promise<DbLibraryScan[]> {
  if (!isTauri()) return [];
  return invokeDb("db_list_scans", { userId });
}

export async function dbGetScan(scanId: string): Promise<DbScanResult | null> {
  if (!isTauri()) return null;
  return invokeDb("db_get_scan", { scanId });
}

export async function dbSaveScan(payload: DbSaveScanPayload): Promise<DbLibraryScan> {
  return invokeDb("db_save_scan", { payload });
}

export async function dbSetActiveScan(userId: string, scanId: string): Promise<void> {
  await invokeDb("db_set_active_scan", { userId, scanId });
}

export async function dbDeleteScan(scanId: string): Promise<void> {
  await invokeDb("db_delete_scan", { scanId });
}

export async function dbListSpotifyImports(userId: string): Promise<DbSpotifyImport[]> {
  if (!isTauri()) return [];
  return invokeDb("db_list_spotify_imports", { userId });
}

export async function dbUpsertSpotifyImport(
  importRow: DbSpotifyImport,
): Promise<DbSpotifyImport> {
  return invokeDb("db_upsert_spotify_import", { import: importRow });
}

export async function dbSetActiveSpotifyImport(
  userId: string,
  importId: string,
): Promise<void> {
  await invokeDb("db_set_active_spotify_import", { userId, importId });
}

export async function dbMigrateLegacy(
  payload: LegacyFrontendPayload,
): Promise<MigrateResult> {
  return invokeDb("db_migrate_legacy", { payload });
}

type Listener = (event: DbChanged) => void;
const listeners = new Set<Listener>();
let unlistenFn: (() => void) | null = null;
let listening = false;

async function ensureDbListener(): Promise<void> {
  if (!isTauri() || listening) return;
  listening = true;
  try {
    const { listen } = await import("@tauri-apps/api/event");
    unlistenFn = await listen<DbChanged>("db-changed", (event) => {
      for (const fn of listeners) {
        fn(event.payload);
      }
    });
  } catch {
    listening = false;
  }
}

export function subscribeDbChanged(fn: Listener): () => void {
  listeners.add(fn);
  void ensureDbListener();
  return () => {
    listeners.delete(fn);
    if (listeners.size === 0 && unlistenFn) {
      unlistenFn();
      unlistenFn = null;
      listening = false;
    }
  };
}

/** Invalide / rafraîchit quand l’entité DB change. */
export function useDbLive(
  entity: string | string[],
  onChange: () => void,
  enabled = true,
): void {
  useEffect(() => {
    if (!enabled || !isTauri()) return;
    const entities = Array.isArray(entity) ? entity : [entity];
    return subscribeDbChanged((ev) => {
      if (entities.includes(ev.entity) || entities.includes("*")) {
        onChange();
      }
    });
  }, [entity, onChange, enabled]);
}
