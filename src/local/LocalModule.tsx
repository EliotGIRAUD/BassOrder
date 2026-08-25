import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import i18n, { intlLocale, type AppLocale } from "../i18n";
import {
  confirmMove,
  ensureLibraryAccess,
  enrichGenres,
  isTauri,
  onLookupProgress,
  onScanProgress,
  organizeLibrary,
  pickMusicFolder,
  scanLibrary,
} from "./api";
import { AnalysisFeed } from "./AnalysisFeed";
import {
  forgetLibrary,
  getActiveLibrary,
  listLibraries,
  loadLibraryScan,
  loadLibraryScanAsync,
  rememberLibrary,
  setActiveAnalysis,
  type SavedLibrary,
} from "./libraryCache";
import { notifyHistoryChanged, subscribeHistoryChange, subscribeOpenAnalysis } from "./historyEvents";
import { ManualTriage } from "./ManualTriage";
import { OrganizeWizard } from "./OrganizeWizard";
import { startPreview, stopPreview } from "./player";
import { TrackPreview } from "./TrackPreview";
import { scanAdvice } from "./suggest";
import { clearWorkJob, setWorkJob } from "../ui/workStatus";
import type {
  GenreGroup,
  LookupProgress,
  OrganizeMode,
  OrganizeResult,
  ScanProgress,
  ScanResult,
  Track,
  RenameMode,
} from "./types";
import { useExperience } from "../ui/Experience";
import { PushEq, PushFill, PushRing } from "../ui/push";
import { CountUp, ScrambleText } from "../ui/motion";
import { VirtualList } from "../ui/VirtualList";
import { LocalBootSkeleton } from "../ui/skeleton";
import { TipPanel } from "../ui/AppTip";
import { DetectionTimeline } from "./DetectionTimeline";
import { useCollapsedPanel } from "./useCollapsedPanel";
import { markFirstRunDone } from "../onboarding/firstRun";
import { listProfiles } from "../spotify/profiles";
import { subscribeProfilesChange } from "../spotify/profileEvents";
import { useUserSession } from "../users/UserSession";
import {
  allLibraryTracks,
  isLikelyTruncatedDuration,
  isTruncatedStillInGenre,
  quarantineTruncatedTracks,
  truncatedTracksFrom,
  TRUNCATED_FOLDER,
  TRUNCATED_FOLDER_ID,
  TRUNCATED_GENRE,
} from "./durationFlags";
import {
  countableTracks,
  DUPLICATE_FOLDER,
  DUPLICATE_GENRE,
  duplicateKeeperMap,
  duplicateTracksFrom,
  isDuplicateTrack,
  quarantineDuplicateTracks,
} from "./duplicateFlags";
import {
  allJunkExcluded,
  describeExcludeChange,
  excludeAllJunk,
  INCLUDE_ALL_IMPORT,
  libraryWasteStats,
  loadImportExcludes,
  sameImportExcludes,
  saveImportExcludes,
  tracksForImport,
  type ImportExcludeOptions,
} from "./libraryWaste";

function appLoc(): "en-US" | "fr-FR" {
  return intlLocale((i18n.language.startsWith("fr") ? "fr" : "en") as AppLocale);
}

/** Identité stable (filtre artistes) — ne pas traduire. */
const UNKNOWN_ARTIST = "Artiste inconnu";

type LocalT = (key: string, options?: Record<string, unknown>) => string;

function displayPlanLabel(group: GenreGroup, t: LocalT): string {
  const raw =
    group.folder === TRUNCATED_FOLDER || group.folder === DUPLICATE_FOLDER
      ? group.genre
      : group.folder;
  return displayKnownLabel(raw, t);
}

function displayKnownLabel(value: string, t: LocalT): string {
  if (value === "Sans genre") {
    return t("genreUnknown");
  }
  if (value === "Illisible") {
    return t("genreUnreadable");
  }
  if (value === TRUNCATED_GENRE || value === TRUNCATED_FOLDER) {
    return t("detailTitleTrunc");
  }
  if (value === DUPLICATE_GENRE || value === DUPLICATE_FOLDER) {
    return t("detailTitleDupes");
  }
  return value;
}

function formatWasteParts(
  t: LocalT,
  duplicates: number,
  unread: number,
  truncated: number,
  shortTruncated = false,
): string[] {
  const parts: string[] = [];
  if (duplicates > 0) {
    parts.push(t("summaryDuplicates", { count: duplicates }));
  }
  if (unread > 0) {
    parts.push(t("summaryParasites", { count: unread }));
  }
  if (truncated > 0) {
    parts.push(
      t(shortTruncated ? "summaryTruncatedShort" : "summaryTruncated", {
        count: truncated,
      }),
    );
  }
  return parts;
}

function displayArtistName(name: string, t: LocalT): string {
  return name === UNKNOWN_ARTIST ? t("unknownArtist") : name;
}

type SortKey = "count" | "name";
type TrackSortKey = "title" | "artist" | "album" | "bpm" | "duration";

export function LocalModule({
  active = true,
  onOpenSpotify,
}: {
  active?: boolean;
  onOpenSpotify?: () => void;
}) {
  const { t, i18n } = useTranslation("local");
  const loc = intlLocale((i18n.language.startsWith("fr") ? "fr" : "en") as AppLocale);
  const tauri = isTauri();
  const fx = useExperience();
  const { user } = useUserSession();
  const [hasSpotify, setHasSpotify] = useState(() => listProfiles().length > 0);
  const [restored] = useState(() => {
    const meta = getActiveLibrary();
    if (!meta) {
      return null;
    }
    const scan = loadLibraryScan(meta.id);
    return { meta, scan };
  });
  const [root, setRoot] = useState<string | null>(restored?.meta.root ?? null);
  const [scan, setScan] = useState<ScanResult | null>(
    restored?.scan ? ingestScan(restored.scan) : null,
  );
  const [mode, setMode] = useState<OrganizeMode>(restored?.meta.mode ?? "copy");
  const [activeId, setActiveId] = useState<string | null>(restored?.meta.id ?? null);
  const [busy, setBusy] = useState<"pick" | "scan" | "lookup" | "organize" | null>(
    null,
  );
  const [lookup, setLookup] = useState<LookupProgress | null>(null);
  const [scanProgress, setScanProgress] = useState<ScanProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<OrganizeResult | null>(null);
  const [selectedFolder, setSelectedFolder] = useState<string | null>(
    restored?.meta.selectedFolder ?? null,
  );
  const [sortKey, setSortKey] = useState<SortKey>("count");
  const [trackSortKey, setTrackSortKey] = useState<TrackSortKey>("title");
  const [excludeCollapsed, toggleExcludeCollapsed] = useCollapsedPanel(
    "bassorder.ui.excludePanel.collapsed",
    true,
  );
  const [artistFilter, setArtistFilter] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [triageOpen, setTriageOpen] = useState(false);
  const [organizeOpen, setOrganizeOpen] = useState(false);
  const [exclude, setExclude] = useState<ImportExcludeOptions>(() =>
    loadImportExcludes(),
  );
  const [excludePulse, setExcludePulse] = useState(0);
  const [excludeHistory, setExcludeHistory] = useState<ImportExcludeOptions[]>(
    [],
  );
  const [preview, setPreview] = useState<{ track: Track; queue: Track[] } | null>(
    null,
  );
  const [recents, setRecents] = useState<SavedLibrary[]>(listLibraries);
  /** Raison de la prochaine sauvegarde historique (amélioration détection). */
  const saveReasonRef = useRef(t("jobScan"));

  useEffect(() => {
    if (!restored?.meta || restored.scan) {
      return;
    }
    let cancelled = false;
    void loadLibraryScanAsync(restored.meta.id).then((full) => {
      if (cancelled || !full) {
        return;
      }
      setScan(ingestScan(full));
      setRoot(restored.meta.root);
      setSelectedFolder(
        restored.meta.selectedFolder ?? defaultPlanFolder(full),
      );
    });
    return () => {
      cancelled = true;
    };
  }, [restored]);

  const tracks = useMemo(
    () => (scan ? allLibraryTracks(scan.groups) : []),
    [scan],
  );

  const truncatedGroup = useMemo((): GenreGroup | null => {
    const list = truncatedTracksFrom(tracks).filter((t) => !isDuplicateTrack(t));
    if (list.length === 0) {
      return null;
    }
    return {
      genre: TRUNCATED_GENRE,
      folder: TRUNCATED_FOLDER,
      tracks: list,
    };
  }, [tracks]);

  const duplicateGroup = useMemo((): GenreGroup | null => {
    const list = duplicateTracksFrom(tracks);
    if (list.length === 0) {
      return null;
    }
    return {
      genre: DUPLICATE_GENRE,
      folder: DUPLICATE_FOLDER,
      tracks: list,
    };
  }, [tracks]);

  const duplicateCount = duplicateGroup?.tracks.length ?? 0;
  const uniqueTracks = useMemo(() => countableTracks(tracks), [tracks]);

  const truncatedPendingCount = useMemo(
    () =>
      tracks.filter(isTruncatedStillInGenre).filter((t) => !isDuplicateTrack(t))
        .length,
    [tracks],
  );

  function patchExclude(
    next: ImportExcludeOptions,
    mode: "toggle" | "all" | "restore" = "toggle",
  ) {
    if (sameImportExcludes(exclude, next)) {
      fx.toast({
        kind: "hint",
        title: t("toastNoChange"),
        body: allJunkExcluded(waste, exclude)
          ? t("toastNoChangeAllOut")
          : t("toastNoChangeAlready"),
      });
      return;
    }
    setExcludeHistory((h) => [...h.slice(-11), exclude]);
    setExclude(next);
    saveImportExcludes(next);
    setExcludePulse((n) => n + 1);
    const msg = describeExcludeChange(exclude, next, waste, mode);
    fx.toast(msg);
    if (mode === "all" || mode === "restore") {
      fx.flash();
    }
  }

  function undoExclude() {
    const prev = excludeHistory[excludeHistory.length - 1];
    if (!prev) {
      fx.toast({
        kind: "hint",
        title: t("toastNothingToUndo"),
        body: t("toastNothingToUndoBody"),
      });
      return;
    }
    setExcludeHistory((h) => h.slice(0, -1));
    setExclude(prev);
    saveImportExcludes(prev);
    setExcludePulse((n) => n + 1);
    fx.flash();
    fx.toast({
      kind: "hint",
      title: t("toastPrevStep"),
      body: t("toastPrevStepBody"),
    });
  }

  function assignManual(trackPath: string, folder: string, genre: string) {
    if (!scan) {
      return;
    }
    saveReasonRef.current = t("reasonManual");
    const nextTracks = tracks.map((t) =>
      t.path === trackPath ? { ...t, folder, genre } : t,
    );
    setScan(rebuildScan(scan, nextTracks));
    const left = unknownTracks.filter((t) => t.path !== trackPath).length;
    fx.toast({
      kind: "ok",
      title: `→ ${folder}`,
      body: left > 0 ? t("toastStillUnknown", { count: left }) : t("toastNothingLeft"),
    });
  }

  function isolateTruncated(paths?: string[]) {
    if (!scan) {
      return;
    }
    const only = paths ? new Set(paths) : undefined;
    const before = tracks
      .filter(isTruncatedStillInGenre)
      .filter((t) => !isDuplicateTrack(t))
      .filter((t) => (only ? only.has(t.path) : true)).length;
    if (before === 0) {
      fx.toast({
        kind: "hint",
        title: t("toastAlreadyIsolated"),
        body: t("toastAlreadyIsolatedBody"),
      });
      return;
    }
    saveReasonRef.current = t("reasonIsolate");
    const isolatePaths = new Set(
      tracks
        .filter(isTruncatedStillInGenre)
        .filter((t) => !isDuplicateTrack(t))
        .filter((t) => (only ? only.has(t.path) : true))
        .map((t) => t.path),
    );
    const nextTracks = quarantineTruncatedTracks(tracks, isolatePaths);
    setScan(rebuildScan(scan, nextTracks));
    setSelectedFolder(TRUNCATED_FOLDER);
    setArtistFilter(null);
    fx.toast({
      kind: "ok",
      title: t("toastIsolated", { count: before }),
      body: t("toastIsolatedBody"),
    });
  }

  useEffect(() => {
    if (!tauri || !root) {
      return;
    }
    void ensureLibraryAccess(root).catch(() => {
      /* aperçu / covers bloqués jusqu’à un nouveau scan */
    });
  }, [tauri, root]);

  const sortedGroups = useMemo(() => {
    if (!scan) {
      return [];
    }
    const q = query.trim().toLowerCase();
    const filtered = q
      ? scan.groups.filter(
          (g) =>
            g.genre.toLowerCase().includes(q) ||
            g.folder.toLowerCase().includes(q),
        )
      : scan.groups;

    // Masquer les vues spéciales : elles ont déjà une ligne dédiée en tête
    // + masquer Illisible si on l’exclut de l’import.
    return [...filtered]
      .filter((g) => {
        if (g.folder === TRUNCATED_FOLDER || g.folder === DUPLICATE_FOLDER) {
          return false;
        }
        if (exclude.parasites && g.genre === "Illisible") {
          return false;
        }
        return true;
      })
      .sort((a, b) => {
        if (sortKey === "name") {
          return a.genre.localeCompare(b.genre, loc, { sensitivity: "base" });
        }
        return (
          b.tracks.length - a.tracks.length ||
          a.genre.localeCompare(b.genre, loc, { sensitivity: "base" })
        );
      });
  }, [scan, sortKey, query, exclude.parasites]);

  const selectedGroup = useMemo(() => {
    if (selectedFolder === TRUNCATED_FOLDER_ID || selectedFolder === TRUNCATED_FOLDER) {
      return truncatedGroup;
    }
    if (selectedFolder === DUPLICATE_FOLDER) {
      return duplicateGroup;
    }
    return (
      sortedGroups.find((g) => g.folder === selectedFolder) ??
      sortedGroups[0] ??
      null
    );
  }, [sortedGroups, selectedFolder, truncatedGroup, duplicateGroup]);

  const maxCount = useMemo(
    () =>
      Math.max(
        1,
        ...sortedGroups.map((g) => g.tracks.length),
        truncatedGroup?.tracks.length ?? 0,
        duplicateGroup?.tracks.length ?? 0,
      ),
    [sortedGroups, truncatedGroup, duplicateGroup],
  );

  const readyFolders = useMemo(
    () =>
      scan?.groups.filter(
        (g) =>
          g.genre !== "Sans genre" &&
          g.genre !== "Illisible" &&
          g.genre !== DUPLICATE_GENRE &&
          g.folder !== DUPLICATE_FOLDER,
      ).length ?? 0,
    [scan],
  );

  const unknownTracks = useMemo(
    () =>
      scan?.groups
        .filter((g) => g.genre === "Sans genre")
        .flatMap((g) => g.tracks) ?? [],
    [scan],
  );

  useEffect(() => {
    if (busy === "scan") {
      const detail =
        scanProgress && scanProgress.total > 0
          ? `${scanProgress.done}/${scanProgress.total}`
          : scanProgress?.label;
      setWorkJob(
        "local-scan",
        t("jobScan"),
        detail,
        scanProgress && scanProgress.total > 0
          ? { done: scanProgress.done, total: scanProgress.total }
          : undefined,
      );
      return () => clearWorkJob("local-scan");
    }
    if (busy === "lookup") {
      const detail =
        lookup && lookup.total > 0
          ? `${lookup.done}/${lookup.total}`
          : undefined;
      setWorkJob(
        "local-lookup",
        t("jobLookup"),
        detail,
        lookup && lookup.total > 0
          ? { done: lookup.done, total: lookup.total }
          : undefined,
      );
      return () => clearWorkJob("local-lookup");
    }
    if (busy === "organize") {
      setWorkJob("local-organize", t("jobOrganize"));
      return () => clearWorkJob("local-organize");
    }
    clearWorkJob("local-scan");
    clearWorkJob("local-lookup");
    clearWorkJob("local-organize");
  }, [busy, scanProgress, lookup]);

  useEffect(() => {
    if (!tauri) {
      return;
    }
    let offLookup: (() => void) | undefined;
    let offScan: (() => void) | undefined;
    void onLookupProgress((progress) => {
      setLookup(progress);
    }).then((fn) => {
      offLookup = fn;
    });
    void onScanProgress((progress) => {
      setScanProgress(progress);
    }).then((fn) => {
      offScan = fn;
    });
    return () => {
      offLookup?.();
      offScan?.();
    };
  }, [tauri]);

  useEffect(() => {
    if (!selectedGroup) {
      return;
    }
    if (selectedFolder !== selectedGroup.folder) {
      setSelectedFolder(selectedGroup.folder);
    }
  }, [selectedGroup, selectedFolder]);

  useEffect(() => {
    if (!scan) {
      return;
    }
    const timer = window.setTimeout(() => {
      setRecents(
        rememberLibrary({
          root: scan.root,
          scan,
          selectedFolder,
          mode,
          reason: saveReasonRef.current,
        }),
      );
      setActiveId(getActiveLibrary()?.id ?? null);
      notifyHistoryChanged();
      markFirstRunDone(user?.id);
    }, 450);
    return () => window.clearTimeout(timer);
  }, [scan, selectedFolder, mode, user?.id]);

  useEffect(() => {
    const offOpen = subscribeOpenAnalysis((lib) => {
      applySaved(lib, false);
    });
    const offChange = subscribeHistoryChange(() => {
      const next = listLibraries();
      setRecents(next);
      const active = getActiveLibrary();
      setActiveId(active?.id ?? null);
      if (activeId && !next.some((item) => item.id === activeId)) {
        applySaved(active, false);
      }
    });
    return () => {
      offOpen();
      offChange();
    };
  }, [activeId]);

  useEffect(() => {
    setHasSpotify(listProfiles().length > 0);
    return subscribeProfilesChange(() => {
      setHasSpotify(listProfiles().length > 0);
    });
  }, []);

  function applySaved(lib: SavedLibrary | null, toast: boolean) {
    if (!lib) {
      setError(null);
      setResult(null);
      setLookup(null);
      setQuery("");
      setRoot(null);
      setScan(null);
      setMode("copy");
      setActiveId(null);
      setSelectedFolder(null);
      setArtistFilter(null);
      return;
    }
    void (async () => {
      const full = (await loadLibraryScanAsync(lib.id)) ?? loadLibraryScan(lib.id);
      if (!full) {
        fx.toast({
          kind: "warn",
          title: t("toastIncomplete"),
          body: t("toastIncompleteBody"),
        });
        return;
      }
      setError(null);
      setResult(null);
      setLookup(null);
      setQuery("");
      setRoot(lib.root);
      setScan(ingestScan(full));
      setMode(lib.mode);
      setActiveId(lib.id);
      setSelectedFolder(lib.selectedFolder ?? defaultPlanFolder(full));
      setArtistFilter(null);
      setActiveAnalysis(lib.id);
      if (tauri) {
        void ensureLibraryAccess(lib.root).catch(() => {
          /* aperçu bloqué tant que le dossier n’est pas ré-autorisé */
        });
      }
      if (toast) {
        fx.toast({
          kind: "ok",
          title: t("toastReopened"),
          body: t("toastReopenedBody", {
            count: lib.fileCount,
            percent: lib.sortedPercent,
            when: formatSavedAt(lib.savedAt),
          }),
        });
      }
    })();
  }

  function forgetSaved(idOrRoot: string) {
    const next = forgetLibrary(idOrRoot);
    setRecents(next);
    notifyHistoryChanged();
    const stillOpen = next.find((item) => item.id === activeId);
    if (!stillOpen) {
      applySaved(next[0] ?? null, false);
    }
    fx.toast({
      kind: "hint",
      title: t("toastRemovedHistory"),
      body: t("toastRemovedHistoryBody"),
    });
  }

  async function chooseFolder() {
    if (!tauri) {
      setError(t("needDesktopHint"));
      fx.toast({
        kind: "warn",
        title: t("toastNeedDesktop"),
        body: t("toastNeedDesktopBody"),
      });
      return;
    }
    setError(null);
    setResult(null);
    setLookup(null);
    setQuery("");
    setBusy("pick");
    try {
      const folder = await pickMusicFolder();
      if (!folder) {
        return;
      }
      setRoot(folder);
      setScan(null);
      setArtistFilter(null);
      setBusy("scan");
      setScanProgress(null);
      fx.toast({
        kind: "go",
        title: t("toastScanTitle"),
        body: t("toastScanBody"),
      });
      const next = ingestScan(await scanLibrary(folder));
      saveReasonRef.current = t("reasonInitial");
      setScan(next);
      setExcludeHistory([]);
      setSelectedFolder(defaultPlanFolder(next));
      setArtistFilter(null);
      const wasteNow = libraryWasteStats(allLibraryTracks(next.groups));
      const advice = scanAdvice(
        wasteNow.pool,
        wasteNow.usefulPercent,
        next.unknownCount,
        wasteNow.lossCount,
      );
      fx.flash();
      fx.toast({ kind: "hint", title: advice.title, body: advice.body });
      const dupes = duplicateTracksFrom(allLibraryTracks(next.groups)).length;
      if (dupes > 0) {
        fx.toast({
          kind: "hint",
          title: t("toastDupesCulled", { count: dupes }),
          body: t("toastDupesCulledBody"),
        });
      }
    } catch (err) {
      setError(toMessage(err));
      fx.toast({ kind: "warn", title: t("toastScanInterrupted"), body: toMessage(err) });
    } finally {
      setBusy(null);
      setScanProgress(null);
    }
  }

  async function rescan() {
    if (!root) {
      return;
    }
    setError(null);
    setResult(null);
    setLookup(null);
    setBusy("scan");
    setScanProgress(null);
    try {
      const next = ingestScan(await scanLibrary(root));
      saveReasonRef.current = t("reasonRescan");
      setScan(next);
      setExcludeHistory([]);
      setSelectedFolder(defaultPlanFolder(next));
      setArtistFilter(null);
      const wasteNow = libraryWasteStats(allLibraryTracks(next.groups));
      const advice = scanAdvice(
        wasteNow.pool,
        wasteNow.usefulPercent,
        next.unknownCount,
        wasteNow.lossCount,
      );
      fx.toast({
        kind: "ok",
        title: t("toastScanUpdated"),
        body: advice.body,
      });
      const dupes = duplicateTracksFrom(allLibraryTracks(next.groups)).length;
      if (dupes > 0) {
        fx.toast({
          kind: "hint",
          title: t("toastDupesCulled", { count: dupes }),
          body: t("toastDupesCulledBodyShort"),
        });
      }
    } catch (err) {
      setError(toMessage(err));
      fx.toast({
        kind: "warn",
        title: t("toastCannotRefresh"),
        body: toMessage(err),
      });
    } finally {
      setBusy(null);
      setScanProgress(null);
    }
  }

  async function guessGenres() {
    if (!scan) {
      return;
    }
    const before = scan.sortedPercent;
    setError(null);
    setResult(null);
    setBusy("lookup");
    fx.toast({
      kind: "go",
      title: t("toastLookupTitle"),
      body: t("toastLookupBody"),
    });
    try {
      const extras = duplicateTracksFrom(tracks);
      const enriched = await enrichGenres(scan.root, uniqueTracks);
      const next = rebuildScan(enriched, [
        ...allLibraryTracks(enriched.groups),
        ...extras,
      ]);
      saveReasonRef.current = t("reasonAutoDetect");
      setScan(next);
      setSelectedFolder(defaultPlanFolder(next));
      const delta = next.sortedPercent - before;
      fx.flash();
      fx.toast({
        kind: delta > 0 ? "ok" : "hint",
        title: t("toastLookupDone", { percent: next.sortedPercent }),
        body:
          delta > 0
            ? t("toastLookupDelta", {
                count: next.unknownCount,
                delta,
                unknown: next.unknownCount,
              })
            : t("toastLookupFew"),
      });
    } catch (err) {
      setError(toMessage(err));
      fx.toast({
        kind: "warn",
        title: t("toastLookupInterrupted"),
        body: toMessage(err),
      });
    } finally {
      setBusy(null);
      setLookup(null);
    }
  }

  async function organize(
    destination: string,
    renameMode: RenameMode,
    isolateTruncated: boolean,
  ) {
    const toWrite = tracksForImport(tracks, exclude);
    if (!scan || toWrite.length === 0) {
      fx.toast({
        kind: "warn",
        title: t("toastNothingToImport"),
        body: t("toastNothingToImportBody"),
      });
      return;
    }
    if (mode === "move") {
      fx.toast({
        kind: "warn",
        title: t("toastWillMove"),
        body: t("toastWillMoveBody"),
      });
      const ok = await confirmMove(toWrite.length, destination);
      if (!ok) {
        fx.toast({
          kind: "hint",
          title: t("toastMoveCancelled"),
          body: t("toastMoveCancelledBody"),
        });
        return;
      }
    }
    setError(null);
    setBusy("organize");
    const doIsolate = isolateTruncated && !exclude.truncated;
    const truncatedGoing = doIsolate
      ? toWrite.filter((t) => isLikelyTruncatedDuration(t.durationSecs)).length
      : 0;
    const skippedJunk = tracks.length - toWrite.length;
    fx.toast({
      kind: "go",
      title: mode === "copy" ? t("toastCopying") : t("toastMoving"),
      body:
        skippedJunk > 0
          ? t("toastOrganizeBodySkipped", {
              path: shortPath(destination),
              count: skippedJunk,
            })
          : truncatedGoing > 0
            ? t("toastOrganizeBodyTruncated", {
                path: shortPath(destination),
                count: truncatedGoing,
              })
            : renameMode === "keep"
              ? t("toastOrganizeBodyKeep", { path: shortPath(destination) })
              : t("toastOrganizeBodyRename", { path: shortPath(destination) }),
    });
    try {
      const next = await organizeLibrary(
        scan.root,
        destination,
        mode,
        toWrite.map((track) => {
          const cut =
            doIsolate && isLikelyTruncatedDuration(track.durationSecs);
          return {
            path: track.path,
            folder: cut ? TRUNCATED_FOLDER : track.folder,
            title: track.title,
            artist: track.artist,
          };
        }),
        renameMode,
      );
      setResult(next);
      setOrganizeOpen(false);
      fx.flash();
      const movedOrCopied = next.copied + next.moved;
      fx.toast({
        kind: next.errors.length > 0 ? "warn" : "ok",
        title:
          next.copied > 0
            ? t("resultCopied", { count: next.copied })
            : next.moved > 0
              ? t("resultMoved", { count: next.moved })
              : t("toastAlreadyInPlace"),
        body:
          next.errors.length > 0
            ? t("resultErrors", { count: next.errors.length })
            : t("toastOrganizeReady", { path: shortPath(next.destination) }),
      });
      if (mode === "move" && movedOrCopied > 0) {
        fx.toast({
          kind: "hint",
          title: t("toastPathsStale"),
          body: t("toastPathsStaleBody"),
        });
      }
    } catch (err) {
      setError(toMessage(err));
      fx.toast({ kind: "warn", title: t("toastOrganizeFail"), body: toMessage(err) });
    } finally {
      setBusy(null);
    }
  }

  const youtubeDump = Boolean(
    scan && scan.unknownCount > 0 && scan.unknownCount === scan.fileCount,
  );
  const allUnknown = Boolean(
    scan && scan.unknownCount === scan.fileCount && scan.fileCount > 0,
  );

  const coverage = scan?.sortedPercent ?? 0;
  const waste = useMemo(() => libraryWasteStats(tracks, exclude), [tracks, exclude]);
  const junkAllOut = allJunkExcluded(waste, exclude);
  const ringCoverage = waste.pool > 0 ? waste.usefulPercent : coverage;
  const importTracks = useMemo(
    () => tracksForImport(tracks, exclude),
    [tracks, exclude],
  );
  const detectionEvents = useMemo(() => {
    const active = getActiveLibrary();
    if (!scan || !active) {
      return [];
    }
    if (active.root.replace(/[/\\]+$/, "").toLowerCase() !== scan.root.replace(/[/\\]+$/, "").toLowerCase()) {
      return [];
    }
    if (active.detectionLog && active.detectionLog.length > 0) {
      return active.detectionLog;
    }
    /* Anciennes analyses : ligne de départ pour que le bloc soit visible */
    return [
      {
        at: active.savedAt,
        percent: active.sortedPercent,
        delta: active.sortedPercent,
        reason: t("reasonCurrentState"),
      },
    ];
  }, [scan, recents, activeId, t]);

  useEffect(() => {
    if (!scan || !selectedFolder) {
      return;
    }
    const hideTruncated =
      exclude.truncated &&
      (selectedFolder === TRUNCATED_FOLDER ||
        selectedFolder === TRUNCATED_FOLDER_ID);
    const hideDupes =
      exclude.duplicates && selectedFolder === DUPLICATE_FOLDER;
    const hideParasites =
      exclude.parasites &&
      scan.groups.some(
        (g) => g.folder === selectedFolder && g.genre === "Illisible",
      );
    if (hideTruncated || hideDupes || hideParasites) {
      setSelectedFolder(defaultPlanFolder(scan));
      setArtistFilter(null);
    }
  }, [exclude, scan, selectedFolder]);

  return (
    <section className="local-stage" data-module="local">
      <header className="local-topbar">
        <div className="local-topbar-copy">
          <p className="eyebrow">{t("eyebrow")}</p>
          <h2>
            <ScrambleText text={t("title")} />
          </h2>
          <p className="local-lede">{t("lede")}</p>
        </div>
        {root && (
          <p className="local-path" title={root}>
            <span className="local-path-dot" />
            <span className="local-path-label">{t("analyzedFolder")}</span>
            <span className="local-path-value">{root}</span>
          </p>
        )}
        <div className="local-toolbar">
          <button
            type="button"
            className="btn-primary"
            onClick={chooseFolder}
            disabled={busy !== null}
          >
            {busy === "pick" || busy === "scan"
              ? t("analyzing")
              : root
                ? t("chooseOtherFolder")
                : t("chooseFolder")}
            <TipPanel side="bottom">{t("chooseFolderTip")}</TipPanel>
          </button>
          {root && (
            <button
              type="button"
              className="btn-ghost"
              onClick={rescan}
              disabled={busy !== null}
            >
              {busy === "scan" ? t("refreshingAnalysis") : t("refreshAnalysis")}
              <TipPanel side="bottom">{t("refreshTip")}</TipPanel>
            </button>
          )}
          {root && (
            <button
              type="button"
              className="btn-ghost"
              onClick={() => (activeId ? forgetSaved(activeId) : forgetSaved(root))}
              disabled={busy !== null}
            >
              {t("removeFromHistory")}
              <TipPanel side="bottom">{t("removeFromHistoryTip")}</TipPanel>
            </button>
          )}
        </div>
      </header>

      {!tauri && (
        <p className="local-hint">{t("needDesktopHint")}</p>
      )}

      {error && <p className="local-error">{error}</p>}

      {!scan && busy === "pick" && <LocalBootSkeleton />}

      {!scan && !busy && (
        <div className="local-empty">
          <div className="empty-visual" aria-hidden>
            <span className="empty-ring" />
            <span className="empty-ring empty-ring-2" />
            <PushEq
              bars={16}
              hint={false}
              active={active}
              className="push-eq--sm"
              label={t("eqDecorLabel")}
            />
          </div>
          <h3>
            {recents.length > 0 ? t("emptyTitleResume") : t("emptyTitleStart")}
          </h3>
          <p>
            {recents.length > 0 ? t("emptyBodyResume") : t("emptyBodyStart")}
          </p>
          <ol className="local-steps">
            <li>{t("step1")}</li>
            <li>{t("step2")}</li>
            <li>{t("step3")}</li>
          </ol>
          <button
            type="button"
            className="btn-primary local-empty-cta"
            onClick={() => void chooseFolder()}
            disabled={busy !== null}
          >
            {t("chooseFolder")}
          </button>
        </div>
      )}

      {busy === "scan" && <AnalysisFeed mode="scan" scan={scanProgress} />}

      {busy === "lookup" && <AnalysisFeed mode="lookup" lookup={lookup} />}

      {scan && busy !== "scan" && busy !== "lookup" && (
        <div className="local-workbench">
          {onOpenSpotify && !hasSpotify && (
            <div className="local-spotify-nudge fx-frame fx-frame--mid">
              <span className="spin-border" aria-hidden />
              <div className="local-spotify-nudge-copy">
                <strong>{t("spotifyNudgeTitle")}</strong>
                <p>{t("spotifyNudgeBody")}</p>
              </div>
              <button
                type="button"
                className="btn-accent"
                onClick={onOpenSpotify}
              >
                {t("spotifyNudgeCta")}
              </button>
            </div>
          )}
          <div className="local-workbench-chrome">
          <div className="kpi-grid" aria-label={t("kpiSummaryAria")}>
            <div
              className={`kpi kpi-hero fx-frame fx-frame--loud${ringCoverage >= 85 ? " is-accent" : ""}${waste.lossPercent > 0 ? " has-loss" : ""}`}
            >
              <span className="spin-border" aria-hidden />
              <PushRing
                percent={ringCoverage}
                lossPercent={waste.lossPercent}
                active={active}
              />
              <div className="kpi-copy">
                <span className="kpi-value">
                  <CountUp value={ringCoverage} suffix="%" />
                </span>
                <span className="kpi-label">{t("kpiSorted")}</span>
                <span className="kpi-hint">
                  {scan.unknownCount > 0
                    ? t("kpiStillUnknown", { count: scan.unknownCount })
                    : ringCoverage >= 85
                      ? t("kpiGoalReached")
                      : t("kpiGoalHint")}
                </span>
                {waste.lossCount > 0 && (
                  <span
                    className="kpi-loss"
                    title={formatWasteParts(
                      t,
                      waste.duplicates,
                      waste.unread,
                      waste.truncated,
                    ).join(" · ")}
                  >
                    <strong>
                      {t("kpiLossPercent", { percent: waste.lossPercent })}
                    </strong>
                    <em>
                      {formatWasteParts(
                        t,
                        waste.duplicates,
                        waste.unread,
                        waste.truncated,
                      ).join(" · ")}
                    </em>
                  </span>
                )}
                {waste.lossCount === 0 && waste.excludedCount > 0 && (
                  <span
                    className="kpi-loss is-excluded"
                    title={formatWasteParts(
                      t,
                      exclude.duplicates ? waste.duplicates : 0,
                      exclude.parasites ? waste.unread : 0,
                      exclude.truncated ? waste.truncated : 0,
                    ).join(" · ")}
                  >
                    <strong>{t("kpiZeroLossBar")}</strong>
                    <em>
                      {t("kpiExcludedRecount", { count: waste.excludedCount })}
                    </em>
                  </span>
                )}
              </div>
            </div>
            <Metric
              label={t("metricTracks")}
              value={waste.pool > 0 ? waste.pool : scan.fileCount}
              hint={
                waste.excludedCount > 0
                  ? t("metricTracksHintExcluded", { count: waste.excludedCount })
                  : duplicateCount > 0
                    ? t("metricTracksHintDupes", { count: duplicateCount })
                    : t("metricTracksHintOk")
              }
              delay={1}
            />
            <Metric
              label={t("metricFolders")}
              value={readyFolders}
              hint={
                scan.unknownCount > 0
                  ? t("metricFoldersHintUnknown", { count: scan.unknownCount })
                  : t("metricFoldersHintOk")
              }
              delay={2}
            />
            {waste.lossCount > 0 ? (
              <Metric
                label={t("metricLoss")}
                value={waste.lossCount}
                hint={`${waste.lossPercent}% · ${formatWasteParts(
                  t,
                  waste.duplicates,
                  waste.unread,
                  waste.truncated,
                ).join(" · ")}`}
                delay={3}
                tone="danger"
              />
            ) : waste.excludedCount > 0 ? (
              <Metric
                label={t("metricExcluded")}
                value={waste.excludedCount}
                hint={t("metricExcludedHint", {
                  parts: formatWasteParts(
                    t,
                    exclude.duplicates ? waste.duplicates : 0,
                    exclude.parasites ? waste.unread : 0,
                    exclude.truncated ? waste.truncated : 0,
                  ).join(" · "),
                })}
                delay={3}
              />
            ) : (
              <Metric
                label={t("metricGenres")}
                value={
                  scan.groups.filter(
                    (g) => g.folder !== DUPLICATE_FOLDER && g.genre !== DUPLICATE_GENRE,
                  ).length
                }
                hint={t("metricGenresHint")}
                delay={3}
              />
            )}
          </div>

          {detectionEvents.length > 0 && (
            <DetectionTimeline events={detectionEvents} compact />
          )}

          {(waste.duplicates > 0 || waste.unread > 0 || waste.truncated > 0) && (
            <section
              className={`exclude-panel fx-frame fx-frame--soft${excludeCollapsed ? " is-collapsed" : ""}`}
              aria-label={t("excludeAria")}
            >
              <span className="spin-border" aria-hidden />
              <button
                type="button"
                className="panel-collapse-toggle"
                aria-expanded={!excludeCollapsed}
                onClick={toggleExcludeCollapsed}
              >
                <span className="panel-collapse-chevron" aria-hidden>
                  {excludeCollapsed ? "▸" : "▾"}
                </span>
                <span className="exclude-panel-title">{t("excludeTitle")}</span>
                {excludeCollapsed && (
                  <span className="panel-collapse-summary">
                    {[
                      exclude.duplicates && waste.duplicates > 0
                        ? t("summaryDuplicates", { count: waste.duplicates })
                        : null,
                      exclude.truncated && waste.truncated > 0
                        ? t("summaryTruncatedShort", { count: waste.truncated })
                        : null,
                      exclude.parasites && waste.unread > 0
                        ? t("summaryParasites", { count: waste.unread })
                        : null,
                    ]
                      .filter(Boolean)
                      .join(" · ") || t("excludeNothingYet")}
                  </span>
                )}
                <span className="panel-collapse-hint">
                  {excludeCollapsed ? t("expand") : t("collapse")}
                </span>
              </button>
              {!excludeCollapsed && (
                <>
              <div className="exclude-panel-copy">
                <p>{t("excludeHelp")}</p>
              </div>
              <div className="exclude-panel-toggles">
                {waste.duplicates > 0 && (
                  <label className="organize-check">
                    <input
                      type="checkbox"
                      checked={exclude.duplicates}
                      onChange={(e) =>
                        patchExclude({
                          ...exclude,
                          duplicates: e.target.checked,
                        })
                      }
                    />
                    <span>
                      {t("duplicates")} <em>({waste.duplicates})</em>
                    </span>
                  </label>
                )}
                {waste.unread > 0 && (
                  <label className="organize-check">
                    <input
                      type="checkbox"
                      checked={exclude.parasites}
                      onChange={(e) =>
                        patchExclude({
                          ...exclude,
                          parasites: e.target.checked,
                        })
                      }
                    />
                    <span>
                      {t("parasites")} <em>({waste.unread})</em>
                    </span>
                  </label>
                )}
                {waste.truncated > 0 && (
                  <label className="organize-check">
                    <input
                      type="checkbox"
                      checked={exclude.truncated}
                      onChange={(e) =>
                        patchExclude({
                          ...exclude,
                          truncated: e.target.checked,
                        })
                      }
                    />
                    <span>
                      {t("truncated")} <em>({waste.truncated})</em>
                    </span>
                  </label>
                )}
                <button
                  type="button"
                  className="btn-ghost exclude-undo-btn"
                  onClick={undoExclude}
                  disabled={excludeHistory.length === 0}
                  title={
                    excludeHistory.length === 0
                      ? t("undoNoneTitle")
                      : t("undoPrevTitle")
                  }
                >
                  {t("undo")}
                  <TipPanel side="bottom">{t("undoTip")}</TipPanel>
                </button>
                <button
                  type="button"
                  className={
                    junkAllOut
                      ? "btn-ghost exclude-all-btn is-restore"
                      : "btn-primary exclude-all-btn"
                  }
                  onClick={() => {
                    if (junkAllOut) {
                      patchExclude(INCLUDE_ALL_IMPORT, "restore");
                    } else {
                      patchExclude(excludeAllJunk(waste), "all");
                    }
                  }}
                >
                  {junkAllOut ? t("reincludeAll") : t("excludeAll")}
                  <TipPanel side="bottom">
                    {junkAllOut ? t("reincludeAllTip") : t("excludeAllTip")}
                  </TipPanel>
                </button>
              </div>
              <p
                key={excludePulse}
                className="exclude-panel-foot"
                aria-live="polite"
              >
                {t("importPlanned")}{" "}
                <strong>{t("importTracks", { count: importTracks.length })}</strong>
                {tracks.length - importTracks.length > 0 ? (
                  <>
                    {" "}
                    ·{" "}
                    <span className="exclude-panel-left">
                      {t("importLeftAside", {
                        count: tracks.length - importTracks.length,
                      })}
                    </span>
                  </>
                ) : (
                  <> {t("importAllGoing")}</>
                )}
              </p>
                </>
              )}
            </section>
          )}

          <div className="command-deck fx-frame fx-frame--loud">
            <span className="spin-border" aria-hidden />
            <div className="command-copy">
              <h3>{t("nextTitle")}</h3>
              <p className="local-note">
                {scan.unknownCount > 0
                  ? youtubeDump
                    ? t("nextYoutube")
                    : t("nextUnknown")
                  : readyFolders === 0
                    ? t("nextNoReady")
                    : t("nextReady", {
                        count: readyFolders,
                        folders: readyFolders,
                        tracks: scan.fileCount,
                        dupes:
                          duplicateCount > 0
                            ? t("dupesIgnored", { count: duplicateCount })
                            : "",
                      })}
              </p>
              <p className="live-hint">
                {
                  scanAdvice(
                    waste.pool || scan.fileCount,
                    ringCoverage,
                    scan.unknownCount,
                    waste.lossCount,
                  ).body
                }
              </p>
            </div>
            <div className="local-actions">
              {scan.unknownCount > 0 ? (
                <button
                  type="button"
                  className="btn-accent btn-glow"
                  onClick={guessGenres}
                  disabled={busy !== null}
                >
                  {t("guessGenres")}
                  <TipPanel side="bottom">{t("guessGenresTip")}</TipPanel>
                </button>
              ) : (
                <button
                  type="button"
                  className="btn-primary btn-glow"
                  onClick={() => {
                    setOrganizeOpen(true);
                    fx.toast({
                      kind: "go",
                      title: t("toastImportTitle"),
                      body: t("toastImportBody"),
                    });
                  }}
                  disabled={
                    busy !== null ||
                    allUnknown ||
                    readyFolders === 0 ||
                    importTracks.length === 0
                  }
                  title={
                    readyFolders === 0
                      ? t("importDisabledNoFolders")
                      : importTracks.length === 0
                        ? t("importDisabledAllExcluded")
                        : t("importDisabledOk")
                  }
                >
                  {busy === "organize"
                    ? t("importSortWriting")
                    : t("importSort", {
                        folders: readyFolders,
                        tracks: importTracks.length,
                      })}
                  <TipPanel side="bottom">{t("importSortTip")}</TipPanel>
                </button>
              )}
              {scan.unknownCount > 0 && (
                <button
                  type="button"
                  className="btn-ghost"
                  onClick={() => {
                    setTriageOpen(true);
                    fx.toast({
                      kind: "go",
                      title: t("toastManualTitle"),
                      body: t("toastManualBody"),
                    });
                  }}
                  disabled={busy !== null}
                >
                  {t("manualSort", { count: scan.unknownCount })}
                  <TipPanel side="bottom">{t("manualSortTip")}</TipPanel>
                </button>
              )}
              {scan.unknownCount > 0 && (
                <button
                  type="button"
                  className="btn-ghost"
                  onClick={() => {
                    setOrganizeOpen(true);
                    fx.toast({
                      kind: "go",
                      title: t("toastImportTitle"),
                      body: t("toastImportBody"),
                    });
                  }}
                  disabled={
                    busy !== null ||
                    allUnknown ||
                    readyFolders === 0 ||
                    importTracks.length === 0
                  }
                  title={
                    readyFolders === 0
                      ? t("importDisabledNoFolders")
                      : importTracks.length === 0
                        ? t("importDisabledAllExcluded")
                        : t("importDisabledOk")
                  }
                >
                  {busy === "organize"
                    ? t("importSortWriting")
                    : t("importSort", {
                        folders: readyFolders,
                        tracks: importTracks.length,
                      })}
                  <TipPanel side="bottom">{t("importSortTip")}</TipPanel>
                </button>
              )}
            </div>
            <p className="action-legend">
              {scan.unknownCount > 0 ? t("actionLegendGuessFirst") : t("actionLegend")}
            </p>
          </div>

          {result && <ResultBanner result={result} />}
          </div>

          {scan.fileCount === 0 ? (
            <p className="local-note">{t("noAudioFound")}</p>
          ) : !active ? (
            <p className="local-note">
              {t("analysisInMemory", { count: scan.fileCount })}
            </p>
          ) : (
            <div className="plan-workspace">
              <aside className="plan-folders fx-frame fx-frame--mid">
                <span className="spin-border" aria-hidden />
                <div className="plan-folders-tools">
                  <input
                    type="search"
                    className="plan-search"
                    placeholder={t("searchGenrePlaceholder")}
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    aria-label={t("searchGenreAria")}
                  />
                  <div
                    className="mode-toggle sort-toggle"
                    role="group"
                    aria-label={t("sortAria")}
                  >
                    <button
                      type="button"
                      className={sortKey === "count" ? "is-active" : ""}
                      onClick={() => setSortKey("count")}
                      title={t("sortByCountTitle")}
                    >
                      {t("sortByCount")}
                    </button>
                    <button
                      type="button"
                      className={sortKey === "name" ? "is-active" : ""}
                      onClick={() => setSortKey("name")}
                      title={t("sortByNameTitle")}
                    >
                      {t("sortByName")}
                    </button>
                  </div>
                </div>

                {truncatedGroup && !exclude.truncated && (
                  <FolderRow
                    group={truncatedGroup}
                    index={0}
                    active={
                      selectedFolder === TRUNCATED_FOLDER_ID ||
                      selectedFolder === TRUNCATED_FOLDER
                    }
                    live={active}
                    maxCount={maxCount}
                    totalFiles={scan.fileCount}
                    warn
                    pendingCount={truncatedPendingCount}
                    onSelect={() => {
                      setSelectedFolder(TRUNCATED_FOLDER);
                      setArtistFilter(null);
                      setTrackSortKey("duration");
                    }}
                  />
                )}
                {duplicateGroup && !exclude.duplicates && (
                  <FolderRow
                    group={duplicateGroup}
                    index={0}
                    active={selectedFolder === DUPLICATE_FOLDER}
                    live={active}
                    maxCount={maxCount}
                    totalFiles={scan.fileCount}
                    skip
                    onSelect={() => {
                      setSelectedFolder(DUPLICATE_FOLDER);
                      setArtistFilter(null);
                      setTrackSortKey("title");
                    }}
                  />
                )}
                <VirtualList
                  className="folder-list"
                  items={sortedGroups}
                  estimateSize={88}
                  threshold={24}
                  getKey={(group) => group.folder}
                >
                  {(group, index) => (
                    <FolderRow
                      group={group}
                      index={index}
                      active={selectedGroup?.folder === group.folder}
                      live={active}
                      maxCount={maxCount}
                      totalFiles={scan.fileCount}
                      onSelect={() => setSelectedFolder(group.folder)}
                    />
                  )}
                </VirtualList>
                {sortedGroups.length === 0 && (
                  <p className="folder-empty">{t("noGenreForFilter")}</p>
                )}
              </aside>

              <div className="plan-detail fx-frame fx-frame--soft" key={selectedGroup?.folder}>
                <span className="spin-border" aria-hidden />
                {selectedGroup ? (
                  <FolderDetail
                    group={selectedGroup}
                    root={scan.root}
                    libraryTracks={tracks}
                    artistFilter={artistFilter}
                    onArtistFilter={setArtistFilter}
                    trackSortKey={trackSortKey}
                    onTrackSortKeyChange={setTrackSortKey}
                    pendingIsolateCount={
                      selectedGroup.folder === TRUNCATED_FOLDER
                        ? truncatedPendingCount
                        : 0
                    }
                    onIsolate={(paths) => isolateTruncated(paths)}
                    onPreview={(track, queue) => {
                      startPreview(track.path);
                      setPreview({ track, queue });
                      fx.toast({
                        kind: "go",
                        title: track.title || track.fileName,
                        body: "Preview — espace pour pause",
                      });
                    }}
                  />
                ) : (
                  <p className="local-note">{t("selectFolderLeft")}</p>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {preview && (
        <TrackPreview
          track={preview.track}
          queue={preview.queue}
          onChange={(track) => setPreview({ track, queue: preview.queue })}
          onClose={() => {
            stopPreview();
            setPreview(null);
          }}
        />
      )}

      {triageOpen && scan && (
        <ManualTriage
          unknown={unknownTracks}
          folders={scan.groups}
          onAssign={assignManual}
          onClose={() => setTriageOpen(false)}
          onPreview={(track) => {
            startPreview(track.path);
            setPreview({ track, queue: unknownTracks });
            fx.toast({
              kind: "go",
              title: track.title || track.fileName,
              body: "Preview — espace pour pause",
            });
          }}
        />
      )}

      {organizeOpen && scan && (
        <OrganizeWizard
          scan={scan}
          trackCount={importTracks.length}
          folderCount={readyFolders}
          truncatedCount={waste.truncated}
          duplicateCount={waste.duplicates}
          parasiteCount={waste.unread}
          exclude={exclude}
          onExcludeChange={patchExclude}
          sampleTrack={
            importTracks.find((t) => /^\d{1,3}[\s.\-_]/.test(t.fileName)) ??
            importTracks[0] ??
            null
          }
          mode={mode}
          onModeChange={setMode}
          busy={busy === "organize"}
          onClose={() => {
            if (busy !== "organize") {
              setOrganizeOpen(false);
            }
          }}
          onConfirm={(destination, renameMode, isolateTruncated) => {
            void organize(destination, renameMode, isolateTruncated);
          }}
        />
      )}
    </section>
  );
}

function Metric({
  label,
  value,
  hint,
  delay = 0,
  tone,
}: {
  label: string;
  value: number;
  hint?: string;
  delay?: number;
  tone?: "danger";
}) {
  return (
    <div
      className={`kpi fx-frame fx-frame--soft${tone === "danger" ? " is-loss" : ""}`}
      style={{ animationDelay: `${0.08 + delay * 0.07}s` }}
    >
      <span className="spin-border" aria-hidden />
      <span className="kpi-value">
        <CountUp value={value} />
      </span>
      <span className="kpi-label">{label}</span>
      {hint && <span className="kpi-hint">{hint}</span>}
    </div>
  );
}

function FolderRow({
  group,
  index,
  active,
  live = true,
  maxCount,
  totalFiles,
  warn = false,
  skip = false,
  pendingCount,
  onSelect,
}: {
  group: GenreGroup;
  index: number;
  active: boolean;
  live?: boolean;
  maxCount: number;
  totalFiles: number;
  warn?: boolean;
  skip?: boolean;
  pendingCount?: number;
  onSelect: () => void;
}) {
  const { t } = useTranslation("local");
  const share = totalFiles > 0 ? Math.round((group.tracks.length / totalFiles) * 100) : 0;
  const bar = Math.max(6, Math.round((group.tracks.length / maxCount) * 100));
  const special =
    warn ||
    skip ||
    group.genre === "Sans genre" ||
    group.genre === "Illisible" ||
    group.folder === TRUNCATED_FOLDER ||
    group.folder === DUPLICATE_FOLDER;
  const label = displayPlanLabel(group, t);
  const stillInGenres = pendingCount ?? 0;

  return (
    <button
      type="button"
      className={`folder-row${active ? " is-active" : ""}${special ? " is-special" : ""}${warn ? " is-warn" : ""}${skip ? " is-skip" : ""}`}
      onClick={onSelect}
      style={{ animationDelay: `${Math.min(index, 12) * 0.03}s` }}
      title={
        skip
          ? t("folderSkipTitle")
          : warn
            ? t("folderWarnTitle")
            : undefined
      }
    >
      <div className="folder-row-top">
        <span className="folder-icon" aria-hidden />
        <span className="folder-name">{label}</span>
        <span className="folder-count">{group.tracks.length}</span>
      </div>
      <PushFill value={bar} className="folder-bar" active={live} />
      <div className="folder-row-meta">
        <span>
          {skip
            ? t("folderSkipMeta")
            : warn
              ? stillInGenres > 0
                ? t("folderWarnPending", { count: stillInGenres })
                : t("folderWarnIsolated")
              : t("folderShare", { percent: share })}
        </span>
        {!warn && !skip && <span className="folder-path">/{group.folder}</span>}
      </div>
    </button>
  );
}

function FolderDetail({
  group,
  root: _root,
  libraryTracks,
  artistFilter,
  onArtistFilter,
  trackSortKey,
  onTrackSortKeyChange,
  pendingIsolateCount = 0,
  onIsolate,
  onPreview,
}: {
  group: GenreGroup;
  root: string;
  libraryTracks: Track[];
  artistFilter: string | null;
  onArtistFilter: (artist: string | null) => void;
  trackSortKey: TrackSortKey;
  onTrackSortKeyChange: (key: TrackSortKey) => void;
  pendingIsolateCount?: number;
  onIsolate?: (paths?: string[]) => void;
  onPreview: (track: Track, queue: Track[]) => void;
}) {
  const { t } = useTranslation("local");
  const trackSortOptions: { key: TrackSortKey; label: string }[] = [
    { key: "title", label: t("colTitle") },
    { key: "artist", label: t("colArtist") },
    { key: "album", label: t("colAlbum") },
    { key: "bpm", label: t("colBpm") },
    { key: "duration", label: t("colDuration") },
  ];
  const artistEntries = useMemo(() => {
    const map = new Map<string, number>();
    for (const track of group.tracks) {
      const name = trackArtistName(track);
      map.set(name, (map.get(name) ?? 0) + 1);
    }
    return [...map.entries()].sort(
      (a, b) => b[1] - a[1] || a[0].localeCompare(b[0], appLoc()),
    );
  }, [group.tracks]);

  const artists = artistEntries.slice(0, 12);

  const isTruncatedView = group.folder === TRUNCATED_FOLDER;
  const isDuplicateView = group.folder === DUPLICATE_FOLDER;
  const keepers = useMemo(
    () => (isDuplicateView ? duplicateKeeperMap(libraryTracks) : new Map<string, Track>()),
    [isDuplicateView, libraryTracks],
  );

  const visibleTracks = useMemo(() => {
    if (!artistFilter) {
      return group.tracks;
    }
    const pool = isTruncatedView || isDuplicateView ? group.tracks : libraryTracks;
    return pool.filter((track) => sameArtist(trackArtistName(track), artistFilter));
  }, [artistFilter, group.tracks, libraryTracks, isTruncatedView, isDuplicateView]);

  const sortedTracks = useMemo(
    () => sortTracks(visibleTracks, trackSortKey),
    [visibleTracks, trackSortKey],
  );

  const pendingVisible = useMemo(
    () => sortedTracks.filter(isTruncatedStillInGenre),
    [sortedTracks],
  );

  function toggleArtist(name: string) {
    onArtistFilter(artistFilter && sameArtist(artistFilter, name) ? null : name);
  }

  return (
    <>
      <header className="plan-detail-header">
        <div>
          <p className="plan-detail-kicker">
            {isDuplicateView
              ? t("detailKickerDupes")
              : isTruncatedView
                ? pendingIsolateCount > 0
                  ? t("detailKickerTruncPending")
                  : t("detailKickerTruncReady")
                : artistFilter
                  ? t("detailKickerArtist")
                  : t("detailKickerFolder")}
          </p>
          <h4>
            {isDuplicateView
              ? t("detailTitleDupes")
              : isTruncatedView
                ? t("detailTitleTrunc")
                : artistFilter
                  ? displayArtistName(artistFilter, t)
                  : displayPlanLabel(group, t)}
          </h4>
          <p
            className="plan-detail-path"
            title={
              isDuplicateView
                ? t("detailHintDupes")
                : isTruncatedView
                  ? t("detailHintTrunc")
                  : artistFilter
                    ? t("detailHintArtist", { artist: displayArtistName(artistFilter, t) })
                    : t("detailHintFolder", { folder: group.folder })
            }
          >
            {isDuplicateView
              ? t("detailPathDupes")
              : isTruncatedView
                ? pendingIsolateCount > 0
                  ? t("detailPathTruncPending", { count: pendingIsolateCount })
                  : t("detailPathTruncReady")
                : artistFilter
                  ? t("detailPathArtist", { count: sortedTracks.length })
                  : t("detailPathImport", { folder: group.folder })}
          </p>
        </div>
        <div className="plan-detail-stats">
          <span>{t("detailTracksCount", { count: sortedTracks.length })}</span>
          {!artistFilter && (
            <span>{t("detailArtistsCount", { count: artistEntries.length })}</span>
          )}
          {artistFilter && (
            <button
              type="button"
              className="artist-filter-clear"
              onClick={() => onArtistFilter(null)}
            >
              {t("showAll")}
            </button>
          )}
        </div>
      </header>

      {isTruncatedView && (
        <div className="truncated-actions">
          <p className="local-note local-note-warn">{t("truncNote")}</p>
          {onIsolate && pendingVisible.length > 0 && (
            <button
              type="button"
              className="btn btn-secondary truncated-isolate-btn"
              onClick={() => onIsolate(pendingVisible.map((tr) => tr.path))}
            >
              {artistFilter
                ? t("isolateArtist", {
                    count: pendingVisible.length,
                    artist: displayArtistName(artistFilter, t),
                  })
                : t("isolateOthers", { count: pendingVisible.length })}
            </button>
          )}
          {onIsolate && pendingIsolateCount === 0 && (
            <p className="local-note">{t("alreadyOnlyTrunc")}</p>
          )}
        </div>
      )}

      {isDuplicateView && (
        <div className="truncated-actions">
          <p className="local-note local-note-skip">{t("dupeNote")}</p>
        </div>
      )}

      {artists.length > 0 && (
        <div className="artist-chips" aria-label={t("artistsAria")}>
          {artists.map(([name, count]) => {
            const active = !!artistFilter && sameArtist(artistFilter, name);
            return (
              <button
                key={name}
                type="button"
                className={`artist-chip${active ? " is-active" : ""}`}
                aria-pressed={active}
                title={t("artistChipTitle", {
                  name: displayArtistName(name, t),
                })}
                onClick={() => toggleArtist(name)}
              >
                {displayArtistName(name, t)}
                <em>{count}</em>
              </button>
            );
          })}
        </div>
      )}

      <div className="track-sort-bar">
        <span className="track-sort-label">{t("sortLabel")}</span>
        <div
          className="mode-toggle sort-toggle track-sort-toggle"
          role="group"
          aria-label={t("trackSortAria")}
        >
          {trackSortOptions.map(({ key, label }) => (
            <button
              key={key}
              type="button"
              className={trackSortKey === key ? "is-active" : ""}
              onClick={() => onTrackSortKeyChange(key)}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <ul className="track-table">
        {sortedTracks.slice(0, 100).map((track, i) => {
          const truncated = isLikelyTruncatedDuration(track.durationSecs);
          const pending = isTruncatedStillInGenre(track);
          const keeper = keepers.get(track.path);
          return (
            <li
              key={track.path}
              style={{ animationDelay: `${Math.min(i, 16) * 0.025}s` }}
            >
              <div className={`track-row-wrap${truncated ? " is-truncated" : ""}${isDuplicateView ? " is-duplicate" : ""}`}>
                <button
                  type="button"
                  className={`track-row${truncated ? " is-truncated" : ""}${isDuplicateView ? " is-duplicate" : ""}`}
                  onClick={() => onPreview(track, sortedTracks)}
                >
                  <span className="track-play" aria-hidden>
                    ▶
                  </span>
                  <span className="track-title">
                    <span className="track-title-text">
                      {track.title || track.fileName}
                    </span>
                    {(track.bpm != null || track.musicalKey) && (
                      <span className="track-dj-meta">
                        {track.bpm != null && <em>{track.bpm} BPM</em>}
                        {track.musicalKey && <em>{track.musicalKey}</em>}
                      </span>
                    )}
                  </span>
                  <span className="track-artist">
                    {isDuplicateView
                      ? [
                          displayArtistName(track.artist?.trim() || UNKNOWN_ARTIST, t),
                          keeper
                            ? t("copyOf", { file: keeper.fileName })
                            : t("copy"),
                        ].join(" · ")
                      : isTruncatedView
                        ? [
                            displayArtistName(track.artist?.trim() || UNKNOWN_ARTIST, t),
                            pending ? track.folder : t("isolated"),
                          ]
                            .filter(Boolean)
                            .join(" · ")
                        : artistFilter
                          ? [
                              track.genre
                                ? displayKnownLabel(track.genre, t)
                                : null,
                              track.album,
                            ]
                              .filter(Boolean)
                              .join(" · ") || track.fileName
                          : displayArtistName(
                              track.artist?.trim() || UNKNOWN_ARTIST,
                              t,
                            )}
                    {track.durationSecs != null && (
                      <em
                        className={
                          truncated ? "track-duration is-truncated" : "track-duration"
                        }
                      >
                        {" · "}
                        {formatDuration(track.durationSecs)}
                        {truncated ? " ⚠" : ""}
                      </em>
                    )}
                  </span>
                  <span className="track-file" title={track.fileName}>
                    {isDuplicateView
                      ? track.fileName
                      : isTruncatedView
                        ? pending
                          ? displayKnownLabel(track.folder, t)
                          : t("detailTitleTrunc")
                        : track.fileName}
                  </span>
                </button>
                {isTruncatedView && pending && onIsolate && (
                  <button
                    type="button"
                    className="track-isolate-btn"
                    title={t("isolateTitle")}
                    onClick={() => onIsolate([track.path])}
                  >
                    {t("isolate")}
                  </button>
                )}
              </div>
            </li>
          );
        })}
        {sortedTracks.length === 0 && (
          <li className="track-more">{t("noTracksForArtist")}</li>
        )}
        {sortedTracks.length > 100 && (
          <li className="track-more">
            {t("moreTracks", {
              count: sortedTracks.length - 100,
              suffix: artistFilter
                ? t("moreTracksArtist")
                : t("moreTracksFolder"),
            })}
          </li>
        )}
      </ul>
    </>
  );
}

function trackArtistName(track: Track): string {
  return track.artist?.trim() || UNKNOWN_ARTIST;
}

function sameArtist(a: string, b: string): boolean {
  return a.localeCompare(b, appLoc(), { sensitivity: "base" }) === 0;
}

function sortTracks(tracks: Track[], key: TrackSortKey): Track[] {
  return [...tracks].sort((a, b) => {
    const byTitle = () =>
      (a.title || a.fileName).localeCompare(b.title || b.fileName, appLoc(), {
        sensitivity: "base",
      });

    if (key === "bpm") {
      if (a.bpm == null && b.bpm == null) return byTitle();
      if (a.bpm == null) return 1;
      if (b.bpm == null) return -1;
      return a.bpm - b.bpm || byTitle();
    }

    if (key === "duration") {
      const ad = a.durationSecs;
      const bd = b.durationSecs;
      if (ad == null && bd == null) return byTitle();
      if (ad == null) return 1;
      if (bd == null) return -1;
      const aTrunc = isLikelyTruncatedDuration(ad) ? 0 : 1;
      const bTrunc = isLikelyTruncatedDuration(bd) ? 0 : 1;
      return aTrunc - bTrunc || ad - bd || byTitle();
    }

    const left =
      key === "title"
        ? a.title?.trim() || a.fileName
        : key === "artist"
          ? a.artist?.trim() || ""
          : a.album?.trim() || "";
    const right =
      key === "title"
        ? b.title?.trim() || b.fileName
        : key === "artist"
          ? b.artist?.trim() || ""
          : b.album?.trim() || "";

    if (!left && !right) return byTitle();
    if (!left) return 1;
    if (!right) return -1;
    return (
      left.localeCompare(right, appLoc(), { sensitivity: "base" }) || byTitle()
    );
  });
}

function ResultBanner({ result }: { result: OrganizeResult }) {
  const { t } = useTranslation("local");
  return (
    <div className="local-result">
      {result.destination && (
        <span className="local-result-dest" title={result.destination}>
          → {shortPath(result.destination)}
        </span>
      )}
      {result.copied > 0 && (
        <span>{t("resultCopied", { count: result.copied })}</span>
      )}
      {result.moved > 0 && (
        <span>{t("resultMoved", { count: result.moved })}</span>
      )}
      {result.skipped > 0 && (
        <span>{t("resultSkipped", { count: result.skipped })}</span>
      )}
      {result.copied === 0 && result.moved === 0 && result.skipped > 0 && (
        <span>{t("resultNothing")}</span>
      )}
      {result.errors.length > 0 && (
        <>
          <p className="local-note local-note-warn">
            {t("resultErrors", { count: result.errors.length })}
          </p>
          <ul>
            {result.errors.slice(0, 12).map((item) => (
              <li key={item}>{item}</li>
            ))}
            {result.errors.length > 12 && (
              <li>{t("resultMoreErrors", { count: result.errors.length - 12 })}</li>
            )}
          </ul>
        </>
      )}
    </div>
  );
}

function shortPath(path: string): string {
  const parts = path.replace(/\//g, "\\").split("\\").filter(Boolean);
  if (parts.length <= 3) {
    return path;
  }
  return `${parts[0]}\\…\\${parts.slice(-2).join("\\")}`;
}

function formatSavedAt(ts: number): string {
  const delta = Date.now() - ts;
  if (delta < 60_000) {
    return i18n.t("savedJustNow", { ns: "local" });
  }
  if (delta < 3_600_000) {
    const m = Math.max(1, Math.round(delta / 60_000));
    return i18n.t("savedMinutesAgo", { ns: "local", count: m });
  }
  if (delta < 86_400_000) {
    const h = Math.max(1, Math.round(delta / 3_600_000));
    return i18n.t("savedHoursAgo", { ns: "local", count: h });
  }
  return new Date(ts).toLocaleString(appLoc(), {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatDuration(secs: number): string {
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function defaultPlanFolder(scan: ScanResult): string | null {
  const skip = new Set([TRUNCATED_FOLDER, DUPLICATE_FOLDER]);
  return (
    scan.groups.find((g) => !skip.has(g.folder))?.folder ??
    scan.groups[0]?.folder ??
    null
  );
}

function ingestScan(scan: ScanResult): ScanResult {
  return rebuildScan(scan, allLibraryTracks(scan.groups));
}

function rebuildScan(scan: ScanResult, allTracks: Track[]): ScanResult {
  const nextTracks = quarantineDuplicateTracks(allTracks);
  const map = new Map<string, GenreGroup>();
  for (const track of nextTracks) {
    const key = track.folder.toLowerCase();
    let group = map.get(key);
    if (!group) {
      group = { genre: track.genre, folder: track.folder, tracks: [] };
      map.set(key, group);
    }
    group.tracks.push({
      ...track,
      genre: group.genre,
      folder: group.folder,
    });
  }
  const groups = [...map.values()].sort(
    (a, b) =>
      b.tracks.length - a.tracks.length ||
      a.genre.localeCompare(b.genre, appLoc(), { sensitivity: "base" }),
  );
  const counted = countableTracks(nextTracks);
  const unknownCount = counted.filter((tr) => tr.genre === "Sans genre").length;
  const unreadCount = counted.filter((tr) => tr.genre === "Illisible").length;
  const sorted = counted.length - unknownCount - unreadCount;
  return {
    ...scan,
    groups,
    unknownCount,
    unreadCount,
    fileCount: counted.length,
    sortedPercent:
      counted.length === 0 ? 0 : Math.round((sorted * 100) / counted.length),
  };
}

function toMessage(err: unknown): string {
  if (typeof err === "string") {
    return err;
  }
  if (err instanceof Error) {
    return err.message;
  }
  return i18n.t("genericError", { ns: "local" });
}
