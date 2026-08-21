import { useEffect, useMemo, useRef, useState } from "react";
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

type SortKey = "count" | "name";
type TrackSortKey = "title" | "artist" | "album" | "bpm" | "duration";

const TRACK_SORT_OPTIONS: { key: TrackSortKey; label: string }[] = [
  { key: "title", label: "Titre" },
  { key: "artist", label: "Artiste" },
  { key: "album", label: "Album" },
  { key: "bpm", label: "BPM" },
  { key: "duration", label: "Durée" },
];

export function LocalModule({ active = true }: { active?: boolean }) {
  const tauri = isTauri();
  const fx = useExperience();
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
  const saveReasonRef = useRef("Analyse du dossier");

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
        title: "Aucun changement",
        body: allJunkExcluded(waste, exclude)
          ? "Tout est déjà hors barre et hors import. Clique « Tout réintégrer » ou « Annuler » pour les revoir."
          : "Ce filtre était déjà appliqué.",
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
        title: "Rien à annuler",
        body: "Aucun filtre précédent. Décoche une case ou clique « Tout réintégrer ».",
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
      title: "Étape précédente",
      body: "La barre et le plan sont revenus en arrière. Tes fichiers n’ont pas été modifiés.",
    });
  }

  function assignManual(trackPath: string, folder: string, genre: string) {
    if (!scan) {
      return;
    }
    saveReasonRef.current = "Classement manuel";
    const nextTracks = tracks.map((t) =>
      t.path === trackPath ? { ...t, folder, genre } : t,
    );
    setScan(rebuildScan(scan, nextTracks));
    const left = unknownTracks.filter((t) => t.path !== trackPath).length;
    fx.toast({
      kind: "ok",
      title: `→ ${folder}`,
      body: left > 0 ? `${left} titre${left > 1 ? "s" : ""} encore sans genre` : "Plus rien à trier.",
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
        title: "Déjà isolés",
        body: "Tous ces titres 3:00 sont déjà uniquement dans « Coupés à 3:00 ».",
      });
      return;
    }
    saveReasonRef.current = "Isolation des fichiers coupés à 3:00";
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
      title: `${before} titre${before > 1 ? "s" : ""} isolé${before > 1 ? "s" : ""}`,
      body: "Retirés des dossiers genre — uniquement dans « Coupés à 3:00 ».",
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
          return a.genre.localeCompare(b.genre, "fr", { sensitivity: "base" });
        }
        return (
          b.tracks.length - a.tracks.length ||
          a.genre.localeCompare(b.genre, "fr", { sensitivity: "base" })
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
        "Analyse du dossier",
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
        "Détection des genres",
        detail,
        lookup && lookup.total > 0
          ? { done: lookup.done, total: lookup.total }
          : undefined,
      );
      return () => clearWorkJob("local-lookup");
    }
    if (busy === "organize") {
      setWorkJob("local-organize", "Écriture sur le disque");
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
    }, 450);
    return () => window.clearTimeout(timer);
  }, [scan, selectedFolder, mode]);

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
          title: "Analyse incomplète",
          body: "Le détail des titres n’est plus en cache — relance une analyse.",
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
          title: "Analyse rouverte",
          body: `${lib.fileCount} titre${lib.fileCount > 1 ? "s" : ""} · ${lib.sortedPercent}% déjà classés · ${formatSavedAt(lib.savedAt)}`,
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
      title: "Retiré de l’historique",
      body: "Cette analyse n’apparaît plus ici. Tes fichiers sur le disque n’ont pas été modifiés.",
    });
  }

  async function chooseFolder() {
    if (!tauri) {
      setError(
        "Ouvre BassOrder avec pnpm tauri dev — le navigateur ne peut pas lire ta musique.",
      );
      fx.toast({
        kind: "warn",
        title: "Fenêtre desktop requise",
        body: "Relance avec pnpm tauri dev pour lire ta bibliothèque.",
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
        title: "Analyse du dossier",
        body: "Lecture des infos des titres (artiste, genre…). Aucun fichier n’est déplacé pour l’instant.",
      });
      const next = ingestScan(await scanLibrary(folder));
      saveReasonRef.current = "Analyse initiale";
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
          title: `${dupes} doublon${dupes > 1 ? "s" : ""} écarté${dupes > 1 ? "s" : ""}`,
          body: "Copies du même morceau : hors comptage, hors import. Le meilleur exemplaire reste classé.",
        });
      }
    } catch (err) {
      setError(toMessage(err));
      fx.toast({ kind: "warn", title: "Analyse interrompue", body: toMessage(err) });
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
      saveReasonRef.current = "Rescan du dossier";
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
        title: "Analyse à jour",
        body: advice.body,
      });
      const dupes = duplicateTracksFrom(allLibraryTracks(next.groups)).length;
      if (dupes > 0) {
        fx.toast({
          kind: "hint",
          title: `${dupes} doublon${dupes > 1 ? "s" : ""} écarté${dupes > 1 ? "s" : ""}`,
          body: "Copies du même morceau : hors comptage, hors import.",
        });
      }
    } catch (err) {
      setError(toMessage(err));
      fx.toast({
        kind: "warn",
        title: "Impossible d’actualiser",
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
      title: "Détection des genres",
      body: "On croise noms de fichiers, base Spotify, puis catalogues en ligne. Aucun fichier n’est déplacé.",
    });
    try {
      const extras = duplicateTracksFrom(tracks);
      const enriched = await enrichGenres(scan.root, uniqueTracks);
      const next = rebuildScan(enriched, [
        ...allLibraryTracks(enriched.groups),
        ...extras,
      ]);
      saveReasonRef.current = "Détection auto des genres";
      setScan(next);
      setSelectedFolder(defaultPlanFolder(next));
      const delta = next.sortedPercent - before;
      fx.flash();
      fx.toast({
        kind: delta > 0 ? "ok" : "hint",
        title: `${next.sortedPercent}% des titres classés`,
        body:
          delta > 0
            ? `+${delta} points. Encore ${next.unknownCount} titre${next.unknownCount > 1 ? "s" : ""} à ranger à la main si besoin.`
            : "Peu de nouveaux genres trouvés. Utilise « Classer manuellement » pour le reste.",
      });
    } catch (err) {
      setError(toMessage(err));
      fx.toast({
        kind: "warn",
        title: "Détection des genres interrompue",
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
        title: "Rien à importer",
        body: "Tout est exclu (parasites, coupés, doublons…) ou il n’y a aucun titre.",
      });
      return;
    }
    if (mode === "move") {
      fx.toast({
        kind: "warn",
        title: "Tu vas déplacer des fichiers",
        body: "Les titres quitteront leur emplacement actuel. Une fenêtre de confirmation va s’ouvrir.",
      });
      const ok = await confirmMove(toWrite.length, destination);
      if (!ok) {
        fx.toast({
          kind: "hint",
          title: "Déplacement annulé",
          body: "Aucun fichier n’a été modifié.",
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
      title: mode === "copy" ? "Copie en cours" : "Déplacement en cours",
      body:
        skippedJunk > 0
          ? `Vers ${shortPath(destination)} · ${skippedJunk} exclu${skippedJunk > 1 ? "s" : ""} (merde / doublons)`
          : truncatedGoing > 0
            ? `Vers ${shortPath(destination)} · ${truncatedGoing} → Coupés à 3:00`
            : renameMode === "keep"
              ? `Vers ${shortPath(destination)}…`
              : `Vers ${shortPath(destination)} · renommage propre…`,
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
            ? `${next.copied} copié${next.copied > 1 ? "s" : ""}`
            : next.moved > 0
              ? `${next.moved} déplacé${next.moved > 1 ? "s" : ""}`
              : "Déjà en place",
        body:
          next.errors.length > 0
            ? `${next.errors.length} erreur${next.errors.length > 1 ? "s" : ""}. ${
                mode === "move"
                  ? "Actualise l’analyse : certains chemins ont changé."
                  : "Vérifie le bandeau d’erreurs."
              }`
            : truncatedGoing > 0
              ? `Prêt · dossier « Coupés à 3:00 » dans ${shortPath(next.destination)}.`
              : `Prêt dans ${shortPath(next.destination)}.`,
      });
      if (mode === "move" && movedOrCopied > 0) {
        fx.toast({
          kind: "hint",
          title: "Chemins à jour ?",
          body: "Après un déplacement, clique « Actualiser l’analyse » sur le dossier source (ou analyse la destination).",
        });
      }
    } catch (err) {
      setError(toMessage(err));
      fx.toast({ kind: "warn", title: "Organisation impossible", body: toMessage(err) });
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
        reason: "État actuel (relance une détection pour détailler)",
      },
    ];
  }, [scan, recents, activeId]);

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
          <p className="eyebrow">Musique sur ton ordinateur</p>
          <h2>
            <ScrambleText text="Fichiers locaux" />
          </h2>
          <p className="local-lede">
            On lit ton dossier (sans réutiliser tes anciens sous-dossiers), on
            propose un classement par genre BassOrder, puis tu
            décides de copier ou déplacer. Rien n’est modifié tant que tu ne
            confirmes pas.
          </p>
        </div>
        {root && (
          <p className="local-path" title={root}>
            <span className="local-path-dot" />
            <span className="local-path-label">Dossier analysé</span>
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
              ? "Analyse en cours…"
              : root
                ? "Choisir un autre dossier"
                : "Choisir un dossier de musique"}
            <TipPanel side="bottom">
              Ouvre l’explorateur Windows pour choisir le dossier à analyser
            </TipPanel>
          </button>
          {root && (
            <button
              type="button"
              className="btn-ghost"
              onClick={rescan}
              disabled={busy !== null}
            >
              {busy === "scan" ? "Nouvelle analyse…" : "Actualiser l’analyse"}
              <TipPanel side="bottom">
                Relance la lecture des titres (tags, genres). Ne déplace aucun fichier.
              </TipPanel>
            </button>
          )}
          {root && (
            <button
              type="button"
              className="btn-ghost"
              onClick={() => (activeId ? forgetSaved(activeId) : forgetSaved(root))}
              disabled={busy !== null}
            >
              Retirer de l’historique
              <TipPanel side="bottom">
                Enlève cette analyse de l’historique. Tes fichiers sur le disque ne sont pas touchés.
              </TipPanel>
            </button>
          )}
        </div>
      </header>

      {!tauri && (
        <p className="local-hint">
          Pour analyser un dossier Windows, ouvre BassOrder en application
          bureau (pas dans le navigateur seul). Lance{" "}
          <code>pnpm tauri dev</code> depuis PowerShell.
        </p>
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
              label="Égaliseur décoratif"
            />
          </div>
          <h3>
            {recents.length > 0
              ? "Reprendre une analyse déjà faite"
              : "Par où commencer ?"}
          </h3>
          <p>
            {recents.length > 0
              ? "Tes analyses précédentes sont dans Historique (menu de gauche). Tu peux aussi choisir un nouveau dossier ici — on lit les infos des titres sans rien déplacer."
              : "Clique sur « Choisir un dossier de musique ». BassOrder ignore ta structure actuelle, lit tags / titres / artistes, propose un plan de genres, puis attend ton accord avant d’écrire quoi que ce soit sur le disque."}
          </p>
          <ol className="local-steps">
            <li>Choisir le dossier à analyser</li>
            <li>Vérifier / compléter les genres proposés</li>
            <li>Copier ou déplacer les titres dans les dossiers (quand tu es prêt)</li>
          </ol>
        </div>
      )}

      {busy === "scan" && <AnalysisFeed mode="scan" scan={scanProgress} />}

      {busy === "lookup" && <AnalysisFeed mode="lookup" lookup={lookup} />}

      {scan && busy !== "scan" && busy !== "lookup" && (
        <div className="local-workbench">
          <div className="local-workbench-chrome">
          <div className="kpi-grid" aria-label="Résumé de l’analyse">
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
                <span className="kpi-label">Titres déjà classés</span>
                <span className="kpi-hint">
                  {scan.unknownCount > 0
                    ? `Encore ${scan.unknownCount} sans genre (inconnus) — pas 100 %`
                    : ringCoverage >= 85
                      ? "Objectif 85 % atteint — tu peux créer les dossiers"
                      : "Objectif conseillé : au moins 85 %"}
                </span>
                {waste.lossCount > 0 && (
                  <span className="kpi-loss" title={waste.parts.join(" · ")}>
                    <strong>{waste.lossPercent}%</strong> de perte
                    <em>{waste.parts.join(" · ")}</em>
                  </span>
                )}
                {waste.lossCount === 0 && waste.excludedCount > 0 && (
                  <span className="kpi-loss is-excluded" title={waste.excludedParts.join(" · ")}>
                    <strong>0%</strong> de perte dans la barre
                    <em>
                      {waste.excludedCount} exclu
                      {waste.excludedCount > 1 ? "s" : ""} · Annuler pour
                      recompter
                    </em>
                  </span>
                )}
              </div>
            </div>
            <Metric
              label="Titres comptés"
              value={waste.pool > 0 ? waste.pool : scan.fileCount}
              hint={
                waste.excludedCount > 0
                  ? `Hors ${waste.excludedCount} exclu${waste.excludedCount > 1 ? "s" : ""} (réintégrables)`
                  : duplicateCount > 0
                    ? `Dont ${duplicateCount} doublon${duplicateCount > 1 ? "s" : ""} encore dans la barre`
                    : "Fichiers audio valides dans le dossier"
              }
              delay={1}
            />
            <Metric
              label="Dossiers à créer"
              value={readyFolders}
              hint={
                scan.unknownCount > 0
                  ? `${scan.unknownCount} titre${scan.unknownCount > 1 ? "s" : ""} encore sans genre`
                  : "Tous les titres ont un dossier"
              }
              delay={2}
            />
            {waste.lossCount > 0 ? (
              <Metric
                label="Perte"
                value={waste.lossCount}
                hint={`${waste.lossPercent}% · ${waste.parts.join(" · ")}`}
                delay={3}
                tone="danger"
              />
            ) : waste.excludedCount > 0 ? (
              <Metric
                label="Exclus"
                value={waste.excludedCount}
                hint={`${waste.excludedParts.join(" · ")} · Annuler pour recompter`}
                delay={3}
              />
            ) : (
              <Metric
                label="Genres détectés"
                value={
                  scan.groups.filter(
                    (g) => g.folder !== DUPLICATE_FOLDER && g.genre !== DUPLICATE_GENRE,
                  ).length
                }
                hint="Groupes proposés dans le plan"
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
              aria-label="Exclure de l’import"
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
                <span className="exclude-panel-title">Nettoyer l’import</span>
                {excludeCollapsed && (
                  <span className="panel-collapse-summary">
                    {[
                      exclude.duplicates && waste.duplicates > 0
                        ? `${waste.duplicates} doublon${waste.duplicates > 1 ? "s" : ""}`
                        : null,
                      exclude.truncated && waste.truncated > 0
                        ? `${waste.truncated} coupé${waste.truncated > 1 ? "s" : ""}`
                        : null,
                      exclude.parasites && waste.unread > 0
                        ? `${waste.unread} parasite${waste.unread > 1 ? "s" : ""}`
                        : null,
                    ]
                      .filter(Boolean)
                      .join(" · ") || "Rien exclu pour l’instant"}
                  </span>
                )}
                <span className="panel-collapse-hint">
                  {excludeCollapsed ? "Déplier" : "Réduire"}
                </span>
              </button>
              {!excludeCollapsed && (
                <>
              <div className="exclude-panel-copy">
                <p>
                  Coche ce que tu ne veux <strong>pas</strong> copier ni
                  déplacer — ça disparaît aussi du plan. Les fichiers restent
                  sur le disque, ils ne polluent juste plus le tri.{" "}
                  <strong>Tout exclure</strong> les retire aussi de la barre.{" "}
                  <strong>Annuler</strong> ou <strong>Tout réintégrer</strong>{" "}
                  pour revenir en arrière.
                </p>
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
                      Doublons <em>({waste.duplicates})</em>
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
                      Parasites <em>({waste.unread})</em>
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
                      Coupés 3:00 <em>({waste.truncated})</em>
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
                      ? "Pas encore d’étape à annuler"
                      : "Revenir au filtre précédent"
                  }
                >
                  Annuler
                  <TipPanel side="bottom">
                    Revient à l’étape d’avant (barre + plan). Rien n’est
                    modifié sur le disque.
                  </TipPanel>
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
                  {junkAllOut ? "Tout réintégrer" : "Tout exclure"}
                  <TipPanel side="bottom">
                    {junkAllOut
                      ? "Remet doublons, parasites et coupés 3:00 dans la barre et le plan."
                      : "Retire doublons, parasites et coupés 3:00 de la barre, du plan et de l’import."}
                  </TipPanel>
                </button>
              </div>
              <p
                key={excludePulse}
                className="exclude-panel-foot"
                aria-live="polite"
              >
                Import prévu :{" "}
                <strong>
                  {importTracks.length} titre
                  {importTracks.length > 1 ? "s" : ""}
                </strong>
                {tracks.length - importTracks.length > 0 ? (
                  <>
                    {" "}
                    ·{" "}
                    <span className="exclude-panel-left">
                      {tracks.length - importTracks.length} laissé
                      {tracks.length - importTracks.length > 1 ? "s" : ""} de
                      côté (hors plan)
                    </span>
                  </>
                ) : (
                  <>
                    {" "}
                    · tout le plan partira à l’import
                  </>
                )}
              </p>
                </>
              )}
            </section>
          )}

          <div className="command-deck fx-frame fx-frame--loud">
            <span className="spin-border" aria-hidden />
            <div className="command-copy">
              <h3>Que faire ensuite ?</h3>
              <p className="local-note">
                {scan.unknownCount > 0
                  ? youtubeDump
                    ? "Beaucoup de titres sans genre (souvent des dumps YouTube). Lance d’abord la détection auto, puis classe manuellement ce qui reste."
                    : "Certains titres n’ont pas de genre clair. Complète automatiquement, puis range le reste à la main si besoin."
                  : readyFolders === 0
                    ? "Aucun dossier genre prêt. Classe d’abord des titres (hors « Sans genre » / « Illisible »), puis importe."
                    : `Prêt à importer : ${readyFolders} dossier${readyFolders > 1 ? "s" : ""} genre · ${scan.fileCount} titre${scan.fileCount > 1 ? "s" : ""}${
                        duplicateCount > 0
                          ? ` · ${duplicateCount} doublon${duplicateCount > 1 ? "s" : ""} ignoré${duplicateCount > 1 ? "s" : ""}`
                          : ""
                      }. Tu choisiras où créer la bibliothèque triée sur ton PC.`}
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
              {scan.unknownCount > 0 && (
                <>
                  <button
                    type="button"
                    className="btn-accent"
                    onClick={guessGenres}
                    disabled={busy !== null}
                  >
                    Deviner les genres automatiquement
                    <TipPanel side="bottom">
                      Cherche les genres via Spotify, noms de fichiers, iTunes / Deezer. Ne déplace aucun fichier.
                    </TipPanel>
                  </button>
                  <button
                    type="button"
                    className="btn-primary"
                    onClick={() => {
                      setTriageOpen(true);
                      fx.toast({
                        kind: "go",
                        title: "Classement manuel",
                        body: "Clique un dossier puis confirme. Touches 1–9 = validation directe. Esc ferme.",
                      });
                    }}
                    disabled={busy !== null}
                  >
                    Classer manuellement ({scan.unknownCount})
                    <TipPanel side="bottom">
                      Range un par un les titres encore sans genre
                    </TipPanel>
                  </button>
                </>
              )}
              <button
                type="button"
                className="btn-primary btn-glow"
                onClick={() => {
                  setOrganizeOpen(true);
                  fx.toast({
                    kind: "go",
                    title: "Importer le tri",
                    body: "Choisis où créer la bibliothèque, copie ou déplacement, puis lance.",
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
                    ? "Classe d’abord des titres dans des genres avant d’importer"
                    : importTracks.length === 0
                      ? "Tout est exclu — décoche une catégorie de nettoyage"
                      : "Choisir un dossier et créer l’arborescence par genre sur ton PC"
                }
              >
                {busy === "organize"
                  ? "Écriture sur le disque…"
                  : `Importer le tri (${readyFolders} dossiers · ${importTracks.length})`}
                <TipPanel side="bottom">
                  Explique le process, crée un dossier où tu veux, puis copie ou déplace les titres
                </TipPanel>
              </button>
            </div>
            <p className="action-legend">
              <strong>Importer le tri</strong> = créer les dossiers genre où tu veux sur le PC.{" "}
              <strong>Copier</strong> (recommandé) laisse les originaux intacts.{" "}
              <strong>Actualiser l’analyse</strong> = relire le dossier sans écrire.
            </p>
          </div>

          {result && <ResultBanner result={result} />}
          </div>

          {scan.fileCount === 0 ? (
            <p className="local-note">Aucun titre audio trouvé dans ce dossier.</p>
          ) : !active ? (
            <p className="local-note">
              Analyse en mémoire ({scan.fileCount} titres) — les jobs continuent en
              fond. Reviens ici pour afficher le plan.
            </p>
          ) : (
            <div className="plan-workspace">
              <aside className="plan-folders fx-frame fx-frame--mid">
                <span className="spin-border" aria-hidden />
                <div className="plan-folders-tools">
                  <input
                    type="search"
                    className="plan-search"
                    placeholder="Rechercher un genre…"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    aria-label="Rechercher un genre dans le plan"
                  />
                  <div
                    className="mode-toggle sort-toggle"
                    role="group"
                    aria-label="Tri"
                  >
                    <button
                      type="button"
                      className={sortKey === "count" ? "is-active" : ""}
                      onClick={() => setSortKey("count")}
                      title="Trier les dossiers du plus rempli au moins rempli"
                    >
                      Plus fournis
                    </button>
                    <button
                      type="button"
                      className={sortKey === "name" ? "is-active" : ""}
                      onClick={() => setSortKey("name")}
                      title="Trier les dossiers par ordre alphabétique"
                    >
                      A → Z
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
                  <p className="folder-empty">Aucun genre pour ce filtre.</p>
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
                  <p className="local-note">Sélectionne un dossier à gauche.</p>
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
  const share = totalFiles > 0 ? Math.round((group.tracks.length / totalFiles) * 100) : 0;
  const bar = Math.max(6, Math.round((group.tracks.length / maxCount) * 100));
  const special =
    warn ||
    skip ||
    group.genre === "Sans genre" ||
    group.genre === "Illisible" ||
    group.folder === TRUNCATED_FOLDER ||
    group.folder === DUPLICATE_FOLDER;
  const label =
    group.folder === TRUNCATED_FOLDER || group.folder === DUPLICATE_FOLDER
      ? group.genre
      : group.folder;
  const stillInGenres = pendingCount ?? 0;

  return (
    <button
      type="button"
      className={`folder-row${active ? " is-active" : ""}${special ? " is-special" : ""}${warn ? " is-warn" : ""}${skip ? " is-skip" : ""}`}
      onClick={onSelect}
      style={{ animationDelay: `${Math.min(index, 12) * 0.03}s` }}
      title={
        skip
          ? "Copies du même morceau — exclues du comptage et de l’import"
          : warn
            ? "Fichiers qui durent exactement 3:00 — souvent des téléchargements incomplets"
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
            ? "Exclus du tri, du comptage et de l’import"
            : warn
              ? stillInGenres > 0
                ? `${stillInGenres} encore dans d’autres dossiers (vue, pas dossier disque)`
                : "Isolés dans le plan · durée pile 3:00"
              : `${share}% de la bibliothèque`}
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
  const artistEntries = useMemo(() => {
    const map = new Map<string, number>();
    for (const track of group.tracks) {
      const name = trackArtistName(track);
      map.set(name, (map.get(name) ?? 0) + 1);
    }
    return [...map.entries()].sort(
      (a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "fr"),
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
              ? "Copies écartées — pas un dossier disque"
              : isTruncatedView
                ? pendingIsolateCount > 0
                  ? "Vue durée — pas encore un dossier disque"
                  : "Dossier réel dans le plan"
                : artistFilter
                  ? "Artiste détecté"
                  : "Dossier du plan"}
          </p>
          <h4>
            {isDuplicateView
              ? "Doublons"
              : isTruncatedView
                ? "Coupés à 3:00"
                : (artistFilter ?? group.folder)}
          </h4>
          <p
            className="plan-detail-path"
            title={
              isDuplicateView
                ? "Même morceau en plusieurs fichiers — le meilleur exemplaire reste classé"
                : isTruncatedView
                  ? "Durée exacte 3:00 — souvent un téléchargement / rip incomplet"
                  : artistFilter
                    ? `Tous les titres de ${artistFilter} dans la bibliothèque`
                    : `Sera créé sous la destination à l’import : ${group.folder}`
            }
          >
            {isDuplicateView
              ? "Exclus du comptage et de l’import — ils ne seront pas copiés"
              : isTruncatedView
                ? pendingIsolateCount > 0
                  ? `${pendingIsolateCount} encore classés dans un genre · isole-les ou coche l’option à l’import`
                  : "Isolés dans le plan · dossier « Coupés à 3:00 » à l’import"
                : artistFilter
                  ? `Bibliothèque · ${sortedTracks.length} titre${sortedTracks.length > 1 ? "s" : ""}`
                  : `À l’import → …\\${group.folder}`}
          </p>
        </div>
        <div className="plan-detail-stats">
          <span>
            <strong>{sortedTracks.length}</strong> titre
            {sortedTracks.length > 1 ? "s" : ""}
          </span>
          {!artistFilter && (
            <span>
              <strong>{artistEntries.length}</strong> artiste
              {artistEntries.length > 1 ? "s" : ""}
            </span>
          )}
          {artistFilter && (
            <button
              type="button"
              className="artist-filter-clear"
              onClick={() => onArtistFilter(null)}
            >
              Tout afficher
            </button>
          )}
        </div>
      </header>

      {isTruncatedView && (
        <div className="truncated-actions">
          <p className="local-note local-note-warn">
            Ces fichiers affichent exactement <strong>3:00</strong>. Beaucoup sont
            coupés au milieu. Cette liste est une <strong>vue</strong> : pour un
            vrai dossier sur le disque, isole-les ici ou coche l’option à
            l’import (« Coupés à 3:00 »).
          </p>
          {onIsolate && pendingVisible.length > 0 && (
            <button
              type="button"
              className="btn btn-secondary truncated-isolate-btn"
              onClick={() => onIsolate(pendingVisible.map((t) => t.path))}
            >
              {artistFilter
                ? `Isoler ${pendingVisible.length} titre${pendingVisible.length > 1 ? "s" : ""} de ${artistFilter}`
                : `Retirer des autres dossiers (${pendingVisible.length})`}
            </button>
          )}
          {onIsolate && pendingIsolateCount === 0 && (
            <p className="local-note">
              Tous ces titres sont déjà uniquement dans « Coupés à 3:00 ».
            </p>
          )}
        </div>
      )}

      {isDuplicateView && (
        <div className="truncated-actions">
          <p className="local-note local-note-skip">
            Même morceau en plusieurs fichiers (titre / artiste, ou nom presque
            identique). On garde le <strong>meilleur exemplaire</strong>{" "}
            (qualité, tags, durée) dans le plan. Ces copies sont{" "}
            <strong>hors comptage</strong> et <strong>ne seront pas importées</strong>.
          </p>
        </div>
      )}

      {artists.length > 0 && (
        <div className="artist-chips" aria-label="Artistes du dossier">
          {artists.map(([name, count]) => {
            const active = !!artistFilter && sameArtist(artistFilter, name);
            return (
              <button
                key={name}
                type="button"
                className={`artist-chip${active ? " is-active" : ""}`}
                aria-pressed={active}
                title={`Voir les titres de ${name}`}
                onClick={() => toggleArtist(name)}
              >
                {name}
                <em>{count}</em>
              </button>
            );
          })}
        </div>
      )}

      <div className="track-sort-bar">
        <span className="track-sort-label">Trier</span>
        <div
          className="mode-toggle sort-toggle track-sort-toggle"
          role="group"
          aria-label="Tri des titres"
        >
          {TRACK_SORT_OPTIONS.map(({ key, label }) => (
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
                          track.artist || "Artiste inconnu",
                          keeper
                            ? `copie de ${keeper.fileName}`
                            : "copie",
                        ].join(" · ")
                      : isTruncatedView
                        ? [
                            track.artist || "Artiste inconnu",
                            pending ? track.folder : "isolé",
                          ]
                            .filter(Boolean)
                            .join(" · ")
                        : artistFilter
                          ? [track.genre, track.album].filter(Boolean).join(" · ") ||
                            track.fileName
                          : track.artist || "Artiste inconnu"}
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
                          ? track.folder
                          : "Coupés à 3:00"
                        : track.fileName}
                  </span>
                </button>
                {isTruncatedView && pending && onIsolate && (
                  <button
                    type="button"
                    className="track-isolate-btn"
                    title="Retirer des dossiers genre — uniquement dans Coupés à 3:00"
                    onClick={() => onIsolate([track.path])}
                  >
                    Isoler
                  </button>
                )}
              </div>
            </li>
          );
        })}
        {sortedTracks.length === 0 && (
          <li className="track-more">Aucun titre pour cet artiste.</li>
        )}
        {sortedTracks.length > 100 && (
          <li className="track-more">
            + {sortedTracks.length - 100} autres titres
            {artistFilter ? " pour cet artiste" : " dans ce dossier"}
          </li>
        )}
      </ul>
    </>
  );
}

function trackArtistName(track: Track): string {
  return track.artist?.trim() || "Artiste inconnu";
}

function sameArtist(a: string, b: string): boolean {
  return a.localeCompare(b, "fr", { sensitivity: "base" }) === 0;
}

function sortTracks(tracks: Track[], key: TrackSortKey): Track[] {
  return [...tracks].sort((a, b) => {
    const byTitle = () =>
      (a.title || a.fileName).localeCompare(b.title || b.fileName, "fr", {
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
      left.localeCompare(right, "fr", { sensitivity: "base" }) || byTitle()
    );
  });
}

function ResultBanner({ result }: { result: OrganizeResult }) {
  return (
    <div className="local-result">
      {result.destination && (
        <span className="local-result-dest" title={result.destination}>
          → {shortPath(result.destination)}
        </span>
      )}
      {result.copied > 0 && (
        <span>
          {result.copied} copié{result.copied > 1 ? "s" : ""}
        </span>
      )}
      {result.moved > 0 && (
        <span>
          {result.moved} déplacé{result.moved > 1 ? "s" : ""}
        </span>
      )}
      {result.skipped > 0 && <span>{result.skipped} déjà en place</span>}
      {result.copied === 0 && result.moved === 0 && result.skipped > 0 && (
        <span>Rien à faire — les titres sont déjà triés.</span>
      )}
      {result.errors.length > 0 && (
        <>
          <p className="local-note local-note-warn">
            {result.errors.length} erreur
            {result.errors.length > 1 ? "s" : ""} — l’écriture a pu être
            partielle. En mode déplacement, actualise l’analyse avant de
            réessayer.
          </p>
          <ul>
            {result.errors.slice(0, 12).map((item) => (
              <li key={item}>{item}</li>
            ))}
            {result.errors.length > 12 && (
              <li>+ {result.errors.length - 12} autres…</li>
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
    return "à l’instant";
  }
  if (delta < 3_600_000) {
    const m = Math.max(1, Math.round(delta / 60_000));
    return `il y a ${m} min`;
  }
  if (delta < 86_400_000) {
    const h = Math.max(1, Math.round(delta / 3_600_000));
    return `il y a ${h} h`;
  }
  return new Date(ts).toLocaleString("fr-FR", {
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
      a.genre.localeCompare(b.genre, "fr", { sensitivity: "base" }),
  );
  const counted = countableTracks(nextTracks);
  const unknownCount = counted.filter((t) => t.genre === "Sans genre").length;
  const unreadCount = counted.filter((t) => t.genre === "Illisible").length;
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
  return "Une erreur est survenue.";
}
