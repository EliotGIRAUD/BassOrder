import type {
  DbLibraryScan,
  DbSaveScanPayload,
  DbScanResult,
  DbSpotifyImport,
  DbSpotifyProfile,
  DbUser,
  LegacyFrontendPayload,
} from "./types";
import { dbMigrateLegacy } from "./client";
import { isTauri } from "./runtime";
import { wipeAbsorbedLocalStorage } from "../users/storage";

const USERS_KEY = "bassorder.users.v1";
const SESSION_KEY = "bassorder.session.userId";
const FLAG = "bassorder.db.frontendMigrated.v1";

function safeParse<T>(raw: string | null): T | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function userKey(userId: string, suffix: string): string {
  return `bassorder.u.${userId}.${suffix}`;
}

function collectUsers(): DbUser[] {
  const store = safeParse<{ users?: DbUser[] }>(localStorage.getItem(USERS_KEY));
  const users = Array.isArray(store?.users) ? store.users : [];
  return users
    .filter((u) => u && typeof u.id === "string")
    .map((u) => ({
      id: u.id,
      name: u.name ?? "Utilisateur",
      color: u.color ?? "#5EC4B0",
      avatarUrl:
        typeof (u as { avatarUrl?: unknown }).avatarUrl === "string"
          ? ((u as { avatarUrl: string }).avatarUrl.trim() || null)
          : null,
      createdAt: Number(u.createdAt) || Date.now(),
      lastUsedAt: Number(u.lastUsedAt) || Date.now(),
    }));
}

function collectPrefs(userId: string): Record<string, unknown> | null {
  const raw = localStorage.getItem(userKey(userId, "prefs.v1"));
  const parsed = safeParse<Record<string, unknown>>(raw);
  if (parsed) return parsed;
  const legacy = safeParse<Record<string, unknown>>(
    localStorage.getItem("bassorder.prefs.v1"),
  );
  return legacy;
}

function collectProfiles(userId: string): {
  activeId: string | null;
  profiles: DbSpotifyProfile[];
} | null {
  const raw =
    localStorage.getItem(userKey(userId, "spotify.profiles.v1")) ??
    localStorage.getItem("bassorder.spotify.profiles.v1");
  const parsed = safeParse<{
    activeId?: string | null;
    profiles?: Array<Record<string, unknown>>;
  }>(raw);
  if (!parsed?.profiles?.length) return null;
  const profiles: DbSpotifyProfile[] = parsed.profiles
    .filter((p) => typeof p.id === "string" && typeof p.clientId === "string")
    .map((p) => ({
      id: String(p.id),
      userId,
      name: String(p.name ?? "Spotify"),
      clientId: String(p.clientId),
      createdAt: Number(p.createdAt) || Date.now(),
      lastUsedAt: Number(p.lastUsedAt) || Date.now(),
      displayName: (p.displayName as string | null) ?? null,
      avatarUrl: (p.avatarUrl as string | null) ?? null,
      lastSyncedAt: (p.lastSyncedAt as number | null) ?? null,
      likedCount: Number(p.likedCount) || 0,
      artistCount: Number(p.artistCount) || 0,
      groupCount: Number(p.groupCount) || 0,
      isActive: parsed.activeId === p.id,
    }));
  return {
    activeId: typeof parsed.activeId === "string" ? parsed.activeId : null,
    profiles,
  };
}

function collectLibraries(userId: string): {
  activeId: string | null;
  scans: DbSaveScanPayload[];
} | null {
  const raw =
    localStorage.getItem(userKey(userId, "libraries.v3")) ??
    localStorage.getItem("bassorder.libraries.v1");
  const index = safeParse<{
    activeId?: string | null;
    analyses?: Array<Record<string, unknown>>;
    version?: number;
  }>(raw);
  if (!index?.analyses?.length) return null;

  const scans: DbSaveScanPayload[] = [];
  for (const meta of index.analyses) {
    if (typeof meta.id !== "string") continue;
    const scanRaw =
      localStorage.getItem(userKey(userId, `libraries.scan.${meta.id}`)) ??
      localStorage.getItem(`bassorder.u.${userId}.libraries.scan.${meta.id}`);
    const result = safeParse<DbScanResult>(scanRaw);
    if (!result?.groups) continue;

    const scan: DbLibraryScan = {
      id: meta.id,
      userId,
      root: String(meta.root ?? result.root),
      savedAt: Number(meta.savedAt) || Date.now(),
      selectedFolder: (meta.selectedFolder as string | null) ?? null,
      mode: String(meta.mode ?? "copy"),
      fileCount: Number(meta.fileCount ?? result.fileCount) || 0,
      unreadCount: Number(meta.unreadCount ?? result.unreadCount) || 0,
      unknownCount: Number(meta.unknownCount ?? result.unknownCount) || 0,
      lookedUpCount: Number(meta.lookedUpCount ?? result.lookedUpCount) || 0,
      sortedPercent: Number(meta.sortedPercent ?? result.sortedPercent) || 0,
      groupCount: Number(meta.groupCount ?? result.groups.length) || 0,
      folderCount: Number(meta.folderCount) || 0,
      durationSecs: Number(meta.durationSecs) || 0,
      topGenres: Array.isArray(meta.topGenres)
        ? (meta.topGenres as DbLibraryScan["topGenres"])
        : [],
      detectionLog: Array.isArray(meta.detectionLog)
        ? (meta.detectionLog as DbLibraryScan["detectionLog"])
        : [],
      isActive: index.activeId === meta.id,
    };
    scans.push({ scan, result });
  }
  if (scans.length === 0) return null;
  return {
    activeId: typeof index.activeId === "string" ? index.activeId : null,
    scans,
  };
}

function collectImports(userId: string): {
  activeId: string | null;
  imports: DbSpotifyImport[];
} | null {
  const raw =
    localStorage.getItem(userKey(userId, "spotify.imports.v2")) ??
    localStorage.getItem(userKey(userId, "spotify.imports.v1")) ??
    localStorage.getItem("bassorder.spotify.imports.v1");
  const parsed = safeParse<{
    activeId?: string | null;
    imports?: Array<Record<string, unknown>>;
  }>(raw);
  if (!parsed?.imports?.length) return null;

  const imports: DbSpotifyImport[] = parsed.imports
    .filter((item) => typeof item.id === "string")
    .map((item) => ({
      id: String(item.id),
      userId,
      profileId: String(item.profileId ?? ""),
      profileName: String(item.profileName ?? "Spotify"),
      displayName: (item.displayName as string | null) ?? null,
      avatarUrl: (item.avatarUrl as string | null) ?? null,
      savedAt: Number(item.savedAt) || Date.now(),
      syncedAt: (item.syncedAt as string | null) ?? null,
      likedCount: Number(item.likedCount) || 0,
      artistCount: Number(item.artistCount) || 0,
      classifiedArtists: Number(item.classifiedArtists) || 0,
      groupCount: Number(item.groupCount) || 0,
      topGenres: Array.isArray(item.topGenres)
        ? (item.topGenres as DbSpotifyImport["topGenres"])
        : [],
      isActive: parsed.activeId === item.id,
    }));
  return {
    activeId: typeof parsed.activeId === "string" ? parsed.activeId : null,
    imports,
  };
}

export function buildLegacyPayload(): LegacyFrontendPayload {
  const users = collectUsers();
  const sessionUserId = localStorage.getItem(SESSION_KEY)?.trim() || null;

  const prefsByUser: LegacyFrontendPayload["prefsByUser"] = {};
  const profilesByUser: LegacyFrontendPayload["profilesByUser"] = {};
  const librariesByUser: LegacyFrontendPayload["librariesByUser"] = {};
  const importsByUser: LegacyFrontendPayload["importsByUser"] = {};

  const ids = users.length > 0 ? users.map((u) => u.id) : ["_legacy_"];
  for (const userId of ids) {
    const prefs = collectPrefs(userId === "_legacy_" ? "" : userId);
    if (prefs) {
      // Pour _legacy_ on mappe sur premier user plus tard ; stocke sous clé temporaire
      prefsByUser[userId === "_legacy_" ? (users[0]?.id ?? "legacy") : userId] =
        prefs;
    }
    const uid = userId === "_legacy_" ? (users[0]?.id ?? "legacy") : userId;
    const profiles = collectProfiles(userId === "_legacy_" ? uid : userId);
    if (profiles) profilesByUser[uid] = profiles;
    const libs = collectLibraries(userId === "_legacy_" ? uid : userId);
    if (libs) librariesByUser[uid] = libs;
    const imports = collectImports(userId === "_legacy_" ? uid : userId);
    if (imports) importsByUser[uid] = imports;
  }

  // Aussi tenter clés scopées pour chaque user réel
  for (const user of users) {
    const prefs = collectPrefs(user.id);
    if (prefs) prefsByUser[user.id] = prefs;
    const profiles = collectProfiles(user.id);
    if (profiles) profilesByUser[user.id] = profiles;
    const libs = collectLibraries(user.id);
    if (libs) librariesByUser[user.id] = libs;
    const imports = collectImports(user.id);
    if (imports) importsByUser[user.id] = imports;
  }

  return {
    users,
    sessionUserId,
    prefsByUser,
    profilesByUser,
    librariesByUser,
    importsByUser,
  };
}

let migratePromise: Promise<void> | null = null;

/** Migration one-shot localStorage → SQLite puis purge LS. Idempotente. */
export function ensureFrontendMigrated(): Promise<void> {
  if (!isTauri()) return Promise.resolve();
  if (localStorage.getItem(FLAG) === "1") {
    wipeAbsorbedLocalStorage();
    return Promise.resolve();
  }
  if (migratePromise) return migratePromise;

  migratePromise = (async () => {
    try {
      const payload = buildLegacyPayload();
      await dbMigrateLegacy(payload);
      localStorage.setItem(FLAG, "1");
      wipeAbsorbedLocalStorage();
    } catch (err) {
      console.warn("[BassOrder] migration DB:", err);
    } finally {
      migratePromise = null;
    }
  })();

  return migratePromise;
}
