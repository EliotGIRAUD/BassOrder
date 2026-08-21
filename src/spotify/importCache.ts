import {
  dbListSpotifyImports,
  dbSetActiveSpotifyImport,
  dbUpsertSpotifyImport,
  isTauri,
  type DbSpotifyImport,
} from "../db";
import { getActiveUserId, readUserItem, writeUserItem } from "../users/storage";
import type { KnowledgeGroup, KnowledgeStatus } from "./types";

const SUFFIX = "spotify.imports.v2";
const LEGACY_SUFFIX = "spotify.imports.v1";
const MAX_IMPORTS = 24;
const TOP_GENRES = 8;

export type ImportGenrePeek = {
  genre: string;
  folder: string;
  artistCount: number;
  likes: number;
};

/** Snapshot historique léger (sans listes d’artistes). */
export type SavedSpotifyImport = {
  id: string;
  profileId: string;
  profileName: string;
  displayName: string | null;
  avatarUrl: string | null;
  savedAt: number;
  syncedAt: string | null;
  likedCount: number;
  artistCount: number;
  classifiedArtists: number;
  groupCount: number;
  topGenres: ImportGenrePeek[];
};

type CacheFile = {
  version: 2;
  activeId: string | null;
  imports: SavedSpotifyImport[];
};

type LegacyV1 = {
  version: 1;
  activeId: string | null;
  imports: Array<{
    id: string;
    profileId: string;
    profileName: string;
    displayName: string | null;
    avatarUrl: string | null;
    savedAt: number;
    knowledge: KnowledgeStatus;
  }>;
};

const emptyCache = (): CacheFile => ({
  version: 2,
  activeId: null,
  imports: [],
});

let cacheMem: CacheFile | null = null;

/** Vide le cache mémoire (changement d’utilisateur BassOrder). */
export function __resetImportCacheMem(): void {
  cacheMem = null;
}

export function listImports(profileId?: string | null): SavedSpotifyImport[] {
  const all = readCache().imports;
  if (!profileId) {
    return all;
  }
  return all.filter((item) => item.profileId === profileId);
}

export function getActiveImport(): SavedSpotifyImport | null {
  const cache = readCache();
  if (cache.activeId) {
    const match = cache.imports.find((item) => item.id === cache.activeId);
    if (match) {
      return match;
    }
  }
  return cache.imports[0] ?? null;
}

export function setActiveImport(id: string): SavedSpotifyImport | null {
  const cache = readCache();
  const match = cache.imports.find((item) => item.id === id);
  if (!match) {
    return null;
  }
  cache.activeId = id;
  writeCache(cache);
  const userId = getActiveUserId();
  if (userId && isTauri()) {
    void dbSetActiveSpotifyImport(userId, id).catch(() => undefined);
  }
  return match;
}

export function rememberImport(entry: {
  profileId: string;
  profileName: string;
  displayName: string | null;
  avatarUrl: string | null;
  knowledge: KnowledgeStatus;
}): SavedSpotifyImport[] {
  const cache = readCache();
  const fp = knowledgeFingerprint(entry.knowledge);
  const active = cache.imports.find((item) => item.id === cache.activeId);

  if (
    active &&
    active.profileId === entry.profileId &&
    importFingerprint(active) === fp
  ) {
    active.profileName = entry.profileName;
    active.displayName = entry.displayName;
    active.avatarUrl = entry.avatarUrl;
    Object.assign(active, summarizeKnowledge(entry.knowledge));
    writeCache(cache);
    return cache.imports;
  }

  const next: SavedSpotifyImport = {
    id: newImportId(),
    profileId: entry.profileId,
    profileName: entry.profileName,
    displayName: entry.displayName,
    avatarUrl: entry.avatarUrl,
    savedAt: Date.now(),
    ...summarizeKnowledge(entry.knowledge),
  };
  cache.imports = [next, ...cache.imports].slice(0, MAX_IMPORTS);
  cache.activeId = next.id;
  writeCache(cache);
  return cache.imports;
}

export function forgetImport(id: string): SavedSpotifyImport[] {
  const cache = readCache();
  cache.imports = cache.imports.filter((item) => item.id !== id);
  if (cache.activeId && !cache.imports.some((item) => item.id === cache.activeId)) {
    cache.activeId = cache.imports[0]?.id ?? null;
  }
  writeCache(cache);
  return cache.imports;
}

export function forgetImportsForProfile(profileId: string): SavedSpotifyImport[] {
  const cache = readCache();
  cache.imports = cache.imports.filter((item) => item.profileId !== profileId);
  if (cache.activeId && !cache.imports.some((item) => item.id === cache.activeId)) {
    cache.activeId = cache.imports[0]?.id ?? null;
  }
  writeCache(cache);
  return cache.imports;
}

export function forgetAllImports(): SavedSpotifyImport[] {
  writeCache(emptyCache());
  return [];
}

function summarizeKnowledge(knowledge: KnowledgeStatus): Omit<
  SavedSpotifyImport,
  "id" | "profileId" | "profileName" | "displayName" | "avatarUrl" | "savedAt"
> {
  const topGenres = [...knowledge.groups]
    .sort((a, b) => b.likes - a.likes)
    .slice(0, TOP_GENRES)
    .map((g) => ({
      genre: g.genre,
      folder: g.folder,
      artistCount: g.artistCount,
      likes: g.likes,
    }));
  return {
    syncedAt: knowledge.syncedAt,
    likedCount: knowledge.likedCount,
    artistCount: knowledge.artistCount,
    classifiedArtists: knowledge.classifiedArtists,
    groupCount: knowledge.groups.length,
    topGenres,
  };
}

function knowledgeFingerprint(knowledge: KnowledgeStatus): string {
  return [
    knowledge.syncedAt ?? "",
    knowledge.likedCount,
    knowledge.artistCount,
    knowledge.classifiedArtists,
    knowledge.groups.length,
  ].join("|");
}

function importFingerprint(item: SavedSpotifyImport): string {
  return [
    item.syncedAt ?? "",
    item.likedCount,
    item.artistCount,
    item.classifiedArtists,
    item.groupCount,
  ].join("|");
}

function newImportId(): string {
  return `s-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function readCache(): CacheFile {
  if (cacheMem) {
    return cacheMem;
  }
  try {
    const rawV2 = readUserItem(SUFFIX);
    if (rawV2) {
      const parsed = JSON.parse(rawV2) as CacheFile;
      if (parsed?.version === 2 && Array.isArray(parsed.imports)) {
        cacheMem = {
          version: 2,
          activeId: typeof parsed.activeId === "string" ? parsed.activeId : null,
          imports: parsed.imports.filter(isSavedImport),
        };
        return cacheMem;
      }
    }

    const migrated = migrateLegacy();
    if (migrated) {
      cacheMem = migrated;
      writeCache(migrated);
      return migrated;
    }
  } catch {
    /* ignore */
  }
  cacheMem = emptyCache();
  return cacheMem;
}

function writeCache(cache: CacheFile): void {
  cacheMem = cache;
  if (!isTauri()) {
    try {
      writeUserItem(SUFFIX, JSON.stringify(cache));
    } catch {
      if (cache.imports.length <= 1) {
        return;
      }
      writeCache({
        ...cache,
        imports: cache.imports.slice(0, cache.imports.length - 1),
      });
      return;
    }
  }
  persistImportsToDb(cache);
}

function persistImportsToDb(cache: CacheFile): void {
  if (!isTauri()) return;
  const userId = getActiveUserId();
  if (!userId) return;
  for (const item of cache.imports) {
    const row: DbSpotifyImport = {
      id: item.id,
      userId,
      profileId: item.profileId,
      profileName: item.profileName,
      displayName: item.displayName,
      avatarUrl: item.avatarUrl,
      savedAt: item.savedAt,
      syncedAt: item.syncedAt,
      likedCount: item.likedCount,
      artistCount: item.artistCount,
      classifiedArtists: item.classifiedArtists,
      groupCount: item.groupCount,
      topGenres: item.topGenres,
      isActive: cache.activeId === item.id,
    };
    void dbUpsertSpotifyImport(row).catch(() => undefined);
  }
}

export async function hydrateImportsFromDb(): Promise<void> {
  if (!isTauri()) return;
  const userId = getActiveUserId();
  if (!userId) {
    cacheMem = emptyCache();
    return;
  }
  try {
    const rows = await dbListSpotifyImports(userId);
    if (rows.length === 0) {
      cacheMem = emptyCache();
      return;
    }
    const imports: SavedSpotifyImport[] = rows.map((r) => ({
      id: r.id,
      profileId: r.profileId,
      profileName: r.profileName,
      displayName: r.displayName,
      avatarUrl: r.avatarUrl,
      savedAt: r.savedAt,
      syncedAt: r.syncedAt,
      likedCount: r.likedCount,
      artistCount: r.artistCount,
      classifiedArtists: r.classifiedArtists,
      groupCount: r.groupCount,
      topGenres: r.topGenres,
    }));
    cacheMem = {
      version: 2,
      activeId: rows.find((r) => r.isActive)?.id ?? imports[0]?.id ?? null,
      imports,
    };
  } catch {
    /* keep mem */
  }
}

function migrateLegacy(): CacheFile | null {
  try {
    const raw = readUserItem(LEGACY_SUFFIX);
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw) as LegacyV1;
    if (parsed?.version !== 1 || !Array.isArray(parsed.imports)) {
      return null;
    }
    const imports = parsed.imports
      .filter(
        (item) =>
          item &&
          typeof item.id === "string" &&
          item.knowledge &&
          Array.isArray(item.knowledge.groups),
      )
      .slice(0, MAX_IMPORTS)
      .map((item) => ({
        id: item.id,
        profileId: item.profileId,
        profileName: item.profileName,
        displayName: item.displayName,
        avatarUrl: item.avatarUrl,
        savedAt: item.savedAt,
        ...summarizeKnowledge(item.knowledge),
      }));
    return {
      version: 2,
      activeId:
        typeof parsed.activeId === "string" &&
        imports.some((i) => i.id === parsed.activeId)
          ? parsed.activeId
          : imports[0]?.id ?? null,
      imports,
    };
  } catch {
    return null;
  }
}

function isSavedImport(value: unknown): value is SavedSpotifyImport {
  if (!value || typeof value !== "object") {
    return false;
  }
  const item = value as SavedSpotifyImport;
  return (
    typeof item.id === "string" &&
    typeof item.profileId === "string" &&
    typeof item.savedAt === "number" &&
    typeof item.likedCount === "number" &&
    Array.isArray(item.topGenres)
  );
}

export type { KnowledgeGroup };
