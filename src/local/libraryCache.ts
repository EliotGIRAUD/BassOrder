import {
  dbDeleteScan,
  dbGetScan,
  dbListScans,
  dbSaveScan,
  dbSetActiveScan,
  isTauri,
  type DbLibraryScan,
  type DbScanResult,
} from "../db";
import { getActiveUserId, readUserItem, removeUserItem, writeUserItem } from "../users/storage";
import type { GenreGroup, OrganizeMode, ScanResult, Track } from "./types";
import { DUPLICATE_FOLDER, DUPLICATE_GENRE, isDuplicateTrack } from "./duplicateFlags";
import { TRUNCATED_FOLDER, TRUNCATED_GENRE } from "./durationFlags";

const INDEX_SUFFIX = "libraries.v3";
const LEGACY_SUFFIX = "libraries.v1";
const SCAN_SUFFIX = (id: string) => `libraries.scan.${id}`;
const MAX_ANALYSES = 24;
const TOP_GENRES = 8;

export type GenrePeek = {
  genre: string;
  folder: string;
  count: number;
};

/** Étape qui a fait bouger le % de tri auto. */
export type DetectionEvent = {
  at: number;
  percent: number;
  delta: number;
  reason: string;
};

/** Entrée historique / liste — sans tracks (léger). */
export type SavedLibrary = {
  id: string;
  root: string;
  savedAt: number;
  selectedFolder: string | null;
  mode: OrganizeMode;
  fileCount: number;
  unreadCount: number;
  unknownCount: number;
  lookedUpCount: number;
  sortedPercent: number;
  groupCount: number;
  folderCount: number;
  durationSecs: number;
  topGenres: GenrePeek[];
  /** Chronologie des hausses / baisses de détection. */
  detectionLog?: DetectionEvent[];
};

type IndexFile = {
  version: 3;
  activeId: string | null;
  analyses: SavedLibrary[];
};

type LegacyV2 = {
  version: 2;
  activeId: string | null;
  analyses: Array<{
    id: string;
    root: string;
    savedAt: number;
    scan: ScanResult;
    selectedFolder: string | null;
    mode: OrganizeMode;
  }>;
};

type LegacyV1 = {
  version: 1;
  activeRoot?: string | null;
  libraries?: LegacyV2["analyses"];
};

const emptyIndex = (): IndexFile => ({
  version: 3,
  activeId: null,
  analyses: [],
});

let indexMem: IndexFile | null = null;
const scanMem = new Map<string, ScanResult>();

export function libraryKey(root: string): string {
  return root.replace(/[/\\]+$/, "").toLowerCase();
}

export function listLibraries(): SavedLibrary[] {
  return readIndex().analyses;
}

export function getActiveLibrary(): SavedLibrary | null {
  const cache = readIndex();
  if (cache.analyses.length === 0) {
    return null;
  }
  if (cache.activeId) {
    const match = cache.analyses.find((item) => item.id === cache.activeId);
    if (match) {
      return match;
    }
  }
  return cache.analyses[0] ?? null;
}

export function loadLibraryScan(id: string): ScanResult | null {
  const hit = scanMem.get(id);
  if (hit) {
    return hit;
  }
  try {
    const raw = readUserItem(SCAN_SUFFIX(id));
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw) as ScanResult;
    if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.groups)) {
      return null;
    }
    scanMem.set(id, parsed);
    return parsed;
  } catch {
    return null;
  }
}

/** Charge un scan depuis la mémoire, le localStorage, ou SQLite (lazy). */
export async function loadLibraryScanAsync(id: string): Promise<ScanResult | null> {
  const local = loadLibraryScan(id);
  if (local) {
    return local;
  }
  if (!isTauri()) {
    return null;
  }
  try {
    const result = await dbGetScan(id);
    if (!result) {
      return null;
    }
    const scan = fromDbScanResult(result);
    scanMem.set(id, scan);
    return scan;
  } catch {
    return null;
  }
}

export function setActiveAnalysis(id: string): SavedLibrary | null {
  const cache = readIndex();
  const match = cache.analyses.find((item) => item.id === id);
  if (!match) {
    return null;
  }
  cache.activeId = id;
  writeIndex(cache);
  const userId = getActiveUserId();
  if (userId && isTauri()) {
    void dbSetActiveScan(userId, id).catch(() => undefined);
  }
  return match;
}

export function rememberLibrary(entry: {
  root: string;
  scan: ScanResult;
  selectedFolder: string | null;
  mode: OrganizeMode;
  /** Pourquoi ce snapshot (affiché dans l’historique d’amélioration). */
  reason?: string;
}): SavedLibrary[] {
  const cache = readIndex();
  const fp = scanFingerprint(entry.scan);
  const active = cache.analyses.find((item) => item.id === cache.activeId);
  const sameRoot =
    cache.analyses.find(
      (item) => libraryKey(item.root) === libraryKey(entry.root),
    ) ?? null;
  const target =
    active && libraryKey(active.root) === libraryKey(entry.root)
      ? active
      : sameRoot;

  if (target && metaFingerprint(target) === fp) {
    target.selectedFolder = entry.selectedFolder;
    target.mode = entry.mode;
    writeIndex(cache);
    scanMem.set(target.id, entry.scan);
    persistScanToDb(target, entry.scan);
    return cache.analyses;
  }

  if (target) {
    const prevPct = target.sortedPercent;
    const nextPct = entry.scan.sortedPercent;
    const reason =
      entry.reason?.trim() ||
      (target.detectionLog && target.detectionLog.length > 0
        ? "Mise à jour"
        : "Analyse initiale");
    const log = [...(target.detectionLog ?? [])];
    if (log.length === 0 || nextPct !== prevPct) {
      log.push({
        at: Date.now(),
        percent: nextPct,
        delta: nextPct - prevPct,
        reason,
      });
    }
    const updated = buildMeta({
      id: target.id,
      root: entry.root,
      scan: entry.scan,
      selectedFolder: entry.selectedFolder,
      mode: entry.mode,
      savedAt: Date.now(),
      detectionLog: log.slice(-14),
    });
    const idx = cache.analyses.findIndex((item) => item.id === target.id);
    if (idx >= 0) {
      cache.analyses[idx] = updated;
    }
    cache.activeId = target.id;
    writeScan(target.id, entry.scan);
    writeIndex(cache);
    persistScanToDb(updated, entry.scan);
    return cache.analyses;
  }

  const id = newAnalysisId();
  const reason = entry.reason?.trim() || "Analyse initiale";
  const meta = buildMeta({
    id,
    root: entry.root,
    scan: entry.scan,
    selectedFolder: entry.selectedFolder,
    mode: entry.mode,
    savedAt: Date.now(),
    detectionLog: [
      {
        at: Date.now(),
        percent: entry.scan.sortedPercent,
        delta: entry.scan.sortedPercent,
        reason,
      },
    ],
  });
  writeScan(id, entry.scan);
  const nextList = [meta, ...cache.analyses];
  const kept = nextList.slice(0, MAX_ANALYSES);
  for (const item of nextList.slice(MAX_ANALYSES)) {
    dropScan(item.id);
  }
  cache.analyses = kept;
  cache.activeId = id;
  writeIndex(cache);
  persistScanToDb(meta, entry.scan);
  return cache.analyses;
}

export function forgetLibrary(idOrRoot: string): SavedLibrary[] {
  const cache = readIndex();
  const byId = cache.analyses.some((item) => item.id === idOrRoot);
  const removed = cache.analyses.filter((item) =>
    byId ? item.id === idOrRoot : libraryKey(item.root) === libraryKey(idOrRoot),
  );
  cache.analyses = cache.analyses.filter((item) =>
    byId ? item.id !== idOrRoot : libraryKey(item.root) !== libraryKey(idOrRoot),
  );
  for (const item of removed) {
    dropScan(item.id);
  }
  if (
    cache.activeId &&
    !cache.analyses.some((item) => item.id === cache.activeId)
  ) {
    cache.activeId = cache.analyses[0]?.id ?? null;
  }
  writeIndex(cache);
  return cache.analyses;
}

export function forgetAllAnalyses(): SavedLibrary[] {
  const cache = readIndex();
  for (const item of cache.analyses) {
    dropScan(item.id);
  }
  writeIndex(emptyIndex());
  return [];
}

export function buildMeta(entry: {
  id: string;
  root: string;
  scan: ScanResult;
  selectedFolder: string | null;
  mode: OrganizeMode;
  savedAt: number;
  detectionLog?: DetectionEvent[];
}): SavedLibrary {
  const topGenres = rankedGenrePeeks(entry.scan.groups);
  const folderCount = entry.scan.groups.filter(
    (g) =>
      g.genre !== "Sans genre" &&
      g.genre !== "Illisible" &&
      g.genre !== DUPLICATE_GENRE &&
      g.folder !== DUPLICATE_FOLDER,
  ).length;
  return {
    id: entry.id,
    root: entry.root,
    savedAt: entry.savedAt,
    selectedFolder: entry.selectedFolder,
    mode: entry.mode,
    fileCount: entry.scan.fileCount,
    unreadCount: entry.scan.unreadCount,
    unknownCount: entry.scan.unknownCount,
    lookedUpCount: entry.scan.lookedUpCount,
    sortedPercent: entry.scan.sortedPercent,
    groupCount: entry.scan.groups.length,
    folderCount,
    durationSecs: totalDuration(entry.scan.groups),
    topGenres,
    detectionLog: entry.detectionLog,
  };
}

function rankedGenrePeeks(groups: GenreGroup[]): GenrePeek[] {
  const named = groups.filter(
    (g) =>
      g.genre !== "Sans genre" &&
      g.genre !== "Illisible" &&
      g.genre !== DUPLICATE_GENRE &&
      g.genre !== TRUNCATED_GENRE &&
      g.folder !== DUPLICATE_FOLDER &&
      g.folder !== TRUNCATED_FOLDER,
  );
  const source = named.length > 0 ? named : groups;
  return [...source]
    .sort((a, b) => b.tracks.length - a.tracks.length)
    .slice(0, TOP_GENRES)
    .map((g) => ({
      genre: g.genre,
      folder: g.folder,
      count: g.tracks.length,
    }));
}

function totalDuration(groups: GenreGroup[]): number {
  let sum = 0;
  for (const group of groups) {
    for (const track of group.tracks) {
      if (isDuplicateTrack(track)) {
        continue;
      }
      sum += track.durationSecs ?? 0;
    }
  }
  return sum;
}

function scanFingerprint(scan: ScanResult): string {
  return [
    libraryKey(scan.root),
    scan.fileCount,
    scan.sortedPercent,
    scan.unknownCount,
    scan.unreadCount,
    scan.lookedUpCount,
    scan.groups.length,
  ].join("|");
}

function metaFingerprint(meta: SavedLibrary): string {
  return [
    libraryKey(meta.root),
    meta.fileCount,
    meta.sortedPercent,
    meta.unknownCount,
    meta.unreadCount,
    meta.lookedUpCount,
    meta.groupCount,
  ].join("|");
}

function newAnalysisId(): string {
  return `a-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function writeScan(id: string, scan: ScanResult): void {
  scanMem.set(id, scan);
  if (!isTauri()) {
    try {
      writeUserItem(SCAN_SUFFIX(id), JSON.stringify(scan));
    } catch {
      /* quota */
    }
  }
}

function persistScanToDb(meta: SavedLibrary, scan: ScanResult): void {
  if (!isTauri()) return;
  const userId = getActiveUserId();
  if (!userId) return;
  const active = readIndex().activeId === meta.id;
  const payload = {
    scan: {
      id: meta.id,
      userId,
      root: meta.root,
      savedAt: meta.savedAt,
      selectedFolder: meta.selectedFolder,
      mode: meta.mode,
      fileCount: meta.fileCount,
      unreadCount: meta.unreadCount,
      unknownCount: meta.unknownCount,
      lookedUpCount: meta.lookedUpCount,
      sortedPercent: meta.sortedPercent,
      groupCount: meta.groupCount,
      folderCount: meta.folderCount,
      durationSecs: meta.durationSecs,
      topGenres: meta.topGenres,
      detectionLog: meta.detectionLog ?? [],
      isActive: active,
    },
    result: {
      root: scan.root,
      fileCount: scan.fileCount,
      unreadCount: scan.unreadCount,
      unknownCount: scan.unknownCount,
      lookedUpCount: scan.lookedUpCount,
      sortedPercent: scan.sortedPercent,
      groups: scan.groups.map((g) => ({
        genre: g.genre,
        folder: g.folder,
        tracks: g.tracks.map((t) => ({
          path: t.path,
          fileName: t.fileName,
          title: t.title,
          artist: t.artist,
          album: t.album,
          year: t.year,
          genre: t.genre,
          folder: t.folder,
          durationSecs: t.durationSecs,
          bpm: t.bpm,
          musicalKey: t.musicalKey ?? null,
          bitrateKbps: t.bitrateKbps,
        })),
      })),
    },
  };
  void dbSaveScan(payload).catch(() => undefined);
}

/** Hydrate index + scans depuis SQLite pour l’utilisateur actif. */
export async function hydrateLibrariesFromDb(): Promise<void> {
  if (!isTauri()) return;
  const userId = getActiveUserId();
  if (!userId) return;
  try {
    const rows = await dbListScans(userId);
    if (rows.length === 0) return;
    const analyses: SavedLibrary[] = rows.map(fromDbScan);
    const activeId = rows.find((r) => r.isActive)?.id ?? analyses[0]?.id ?? null;
    indexMem = { version: 3, activeId, analyses };
    for (const row of rows.slice(0, MAX_ANALYSES)) {
      const result = await dbGetScan(row.id);
      if (result) {
        const scan = fromDbScanResult(result);
        scanMem.set(row.id, scan);
      }
    }
  } catch {
    /* keep local */
  }
}

function fromDbScan(row: DbLibraryScan): SavedLibrary {
  return {
    id: row.id,
    root: row.root,
    savedAt: row.savedAt,
    selectedFolder: row.selectedFolder,
    mode: (row.mode as OrganizeMode) || "copy",
    fileCount: row.fileCount,
    unreadCount: row.unreadCount,
    unknownCount: row.unknownCount,
    lookedUpCount: row.lookedUpCount,
    sortedPercent: row.sortedPercent,
    groupCount: row.groupCount,
    folderCount: row.folderCount,
    durationSecs: row.durationSecs,
    topGenres: row.topGenres,
    detectionLog: row.detectionLog,
  };
}

function fromDbScanResult(result: DbScanResult): ScanResult {
  return {
    root: result.root,
    fileCount: result.fileCount,
    unreadCount: result.unreadCount,
    unknownCount: result.unknownCount,
    lookedUpCount: result.lookedUpCount,
    sortedPercent: result.sortedPercent,
    groups: result.groups as GenreGroup[],
  };
}

function dropScan(id: string): void {
  scanMem.delete(id);
  removeUserItem(SCAN_SUFFIX(id));
  if (isTauri()) {
    void dbDeleteScan(id).catch(() => undefined);
  }
}

function readIndex(): IndexFile {
  if (indexMem) {
    return indexMem;
  }
  try {
    const rawV3 = readUserItem(INDEX_SUFFIX);
    if (rawV3) {
      const parsed = JSON.parse(rawV3) as IndexFile;
      if (parsed?.version === 3 && Array.isArray(parsed.analyses)) {
        indexMem = {
          version: 3,
          activeId: typeof parsed.activeId === "string" ? parsed.activeId : null,
          analyses: parsed.analyses.filter(isSavedLibrary),
        };
        return indexMem;
      }
    }

    const migrated = migrateLegacy();
    if (migrated) {
      indexMem = migrated;
      writeIndex(migrated);
      return migrated;
    }
  } catch {
    /* ignore */
  }
  indexMem = emptyIndex();
  return indexMem;
}

function writeIndex(cache: IndexFile): void {
  indexMem = cache;
  if (!isTauri()) {
    try {
      writeUserItem(INDEX_SUFFIX, JSON.stringify(cache));
    } catch {
      if (cache.analyses.length <= 1) {
        return;
      }
      const dropped = cache.analyses[cache.analyses.length - 1];
      if (dropped) {
        dropScan(dropped.id);
      }
      writeIndex({
        ...cache,
        analyses: cache.analyses.slice(0, cache.analyses.length - 1),
      });
    }
  }
}

function migrateLegacy(): IndexFile | null {
  try {
    const raw = readUserItem(LEGACY_SUFFIX);
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw) as LegacyV2 | LegacyV1;
    let rows: LegacyV2["analyses"] = [];
    let activeId: string | null = null;

    if (parsed?.version === 2 && Array.isArray((parsed as LegacyV2).analyses)) {
      const v2 = parsed as LegacyV2;
      rows = v2.analyses.filter((item) => item?.scan && Array.isArray(item.scan.groups));
      activeId = typeof v2.activeId === "string" ? v2.activeId : null;
    } else if (
      parsed?.version === 1 &&
      Array.isArray((parsed as LegacyV1).libraries)
    ) {
      const v1 = parsed as LegacyV1;
      rows = (v1.libraries ?? []).filter(
        (item) => item?.scan && Array.isArray(item.scan.groups),
      );
      const active =
        rows.find(
          (item) =>
            v1.activeRoot && libraryKey(item.root) === libraryKey(v1.activeRoot),
        ) ?? rows[0];
      activeId = active?.id ?? null;
    } else {
      return null;
    }

    const analyses: SavedLibrary[] = [];
    for (const row of rows.slice(0, MAX_ANALYSES)) {
      const id =
        row.id || `legacy-${row.savedAt}-${libraryKey(row.root)}`;
      writeScan(id, row.scan);
      analyses.push(
        buildMeta({
          id,
          root: row.root,
          scan: row.scan,
          selectedFolder: row.selectedFolder,
          mode: row.mode ?? "copy",
          savedAt: row.savedAt,
        }),
      );
    }

    return {
      version: 3,
      activeId:
        activeId && analyses.some((a) => a.id === activeId)
          ? activeId
          : analyses[0]?.id ?? null,
      analyses,
    };
  } catch {
    return null;
  }
}

function isSavedLibrary(value: unknown): value is SavedLibrary {
  if (!value || typeof value !== "object") {
    return false;
  }
  const lib = value as SavedLibrary;
  return (
    typeof lib.id === "string" &&
    typeof lib.root === "string" &&
    typeof lib.savedAt === "number" &&
    typeof lib.fileCount === "number" &&
    Array.isArray(lib.topGenres)
  );
}

/** Utilitaire tests / debug : invalide les caches mémoire. */
export function __resetLibraryCacheMem(): void {
  indexMem = null;
  scanMem.clear();
}

export type { Track };
