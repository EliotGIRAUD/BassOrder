import type { Track } from "./types";
import { isDuplicateTrack } from "./duplicateFlags";
import {
  isLikelyTruncatedDuration,
  isQuarantinedTruncated,
} from "./durationFlags";

/** Pistes « perdues » : doublons, parasites illisibles, coupés / poubelle 3:00. */
export function isWasteTrack(track: Track): boolean {
  if (isDuplicateTrack(track)) {
    return true;
  }
  if (track.genre === "Illisible") {
    return true;
  }
  if (isQuarantinedTruncated(track)) {
    return true;
  }
  if (isLikelyTruncatedDuration(track.durationSecs)) {
    return true;
  }
  return false;
}

/** Classé dans un vrai dossier genre (pas perte, pas « Sans genre »). */
export function isUsefulClassified(track: Track): boolean {
  if (isWasteTrack(track)) {
    return false;
  }
  if (track.genre === "Sans genre" || track.genre === "Illisible") {
    return false;
  }
  return true;
}

export type LibraryWasteStats = {
  /** Tous les fichiers audio du scan. */
  rawPool: number;
  /** Pool encore compté (après exclusions). */
  pool: number;
  /** Titres vraiment rangés par genre (hors poubelle encore comptée). */
  usefulCount: number;
  usefulPercent: number;
  /** Doublons / illisibles / 3:00 encore dans la barre. */
  lossCount: number;
  lossPercent: number;
  /** Retirés de la barre et de l’import (réintégrables). */
  excludedCount: number;
  duplicates: number;
  unread: number;
  truncated: number;
  /** Lignes courtes pour l’UI, ex. « 48 doublons » encore dans la barre. */
  parts: string[];
  /** Ce qui est hors barre, ex. « 993 doublons ». */
  excludedParts: string[];
};

export function libraryWasteStats(
  tracks: Track[],
  opts?: ImportExcludeOptions,
): LibraryWasteStats {
  const exclude: ImportExcludeOptions = opts ?? {
    parasites: false,
    truncated: false,
    duplicates: false,
  };
  const rawPool = tracks.length;
  let duplicates = 0;
  let unread = 0;
  let truncated = 0;
  let usefulCount = 0;
  let lossCount = 0;
  let excludedCount = 0;
  let pool = 0;

  for (const track of tracks) {
    const isDupe = isDuplicateTrack(track);
    const isUnread = track.genre === "Illisible";
    const isCut =
      isQuarantinedTruncated(track) ||
      isLikelyTruncatedDuration(track.durationSecs);

    if (isDupe) {
      duplicates += 1;
    } else if (isUnread) {
      unread += 1;
    } else if (isCut) {
      truncated += 1;
    }

    if (isExcludedFromImport(track, exclude)) {
      excludedCount += 1;
      continue;
    }

    pool += 1;
    if (isDupe || isUnread || isCut) {
      lossCount += 1;
    } else if (isUsefulClassified(track)) {
      usefulCount += 1;
    }
  }

  const usefulPercent =
    pool === 0 ? 0 : Math.round((usefulCount * 100) / pool);
  let lossPercent = pool === 0 ? 0 : Math.round((lossCount * 100) / pool);
  if (usefulPercent + lossPercent > 100) {
    lossPercent = Math.max(0, 100 - usefulPercent);
  }

  const remainingDupes = exclude.duplicates ? 0 : duplicates;
  const remainingUnread = exclude.parasites ? 0 : unread;
  const remainingCut = exclude.truncated ? 0 : truncated;

  return {
    rawPool,
    pool,
    usefulCount,
    usefulPercent,
    lossCount,
    lossPercent,
    excludedCount,
    duplicates,
    unread,
    truncated,
    parts: wasteParts(remainingDupes, remainingUnread, remainingCut),
    excludedParts: wasteParts(
      exclude.duplicates ? duplicates : 0,
      exclude.parasites ? unread : 0,
      exclude.truncated ? truncated : 0,
    ),
  };
}

function wasteParts(duplicates: number, unread: number, truncated: number): string[] {
  const parts: string[] = [];
  if (duplicates > 0) {
    parts.push(`${duplicates} doublon${duplicates > 1 ? "s" : ""}`);
  }
  if (unread > 0) {
    parts.push(`${unread} parasite${unread > 1 ? "s" : ""}`);
  }
  if (truncated > 0) {
    parts.push(`${truncated} coupé${truncated > 1 ? "s" : ""} à 3:00`);
  }
  return parts;
}

/** Ce qu’on refuse d’écrire à l’import (et qu’on peut masquer du plan). */
export type ImportExcludeOptions = {
  /** Fichiers « Illisible » / sidecars parasites. */
  parasites: boolean;
  /** Titres pile 3:00 (souvent mal téléchargés). */
  truncated: boolean;
  /** Copies en trop du même morceau. */
  duplicates: boolean;
};

export const DEFAULT_IMPORT_EXCLUDES: ImportExcludeOptions = {
  parasites: true,
  truncated: true,
  duplicates: true,
};

export const INCLUDE_ALL_IMPORT: ImportExcludeOptions = {
  parasites: false,
  truncated: false,
  duplicates: false,
};

export function excludeAllJunk(waste: LibraryWasteStats): ImportExcludeOptions {
  return {
    duplicates: waste.duplicates > 0,
    parasites: waste.unread > 0,
    truncated: waste.truncated > 0,
  };
}

/** Toutes les catégories présentes sont déjà cochées. */
export function allJunkExcluded(
  waste: LibraryWasteStats,
  opts: ImportExcludeOptions,
): boolean {
  const junkTotal = waste.duplicates + waste.unread + waste.truncated;
  if (junkTotal === 0) {
    return false;
  }
  if (waste.duplicates > 0 && !opts.duplicates) {
    return false;
  }
  if (waste.unread > 0 && !opts.parasites) {
    return false;
  }
  if (waste.truncated > 0 && !opts.truncated) {
    return false;
  }
  return true;
}

export function sameImportExcludes(
  a: ImportExcludeOptions,
  b: ImportExcludeOptions,
): boolean {
  return (
    a.duplicates === b.duplicates &&
    a.parasites === b.parasites &&
    a.truncated === b.truncated
  );
}

function labelForFlag(
  key: keyof ImportExcludeOptions,
  waste: LibraryWasteStats,
): string | null {
  if (key === "duplicates" && waste.duplicates > 0) {
    return `${waste.duplicates} doublon${waste.duplicates > 1 ? "s" : ""}`;
  }
  if (key === "parasites" && waste.unread > 0) {
    return `${waste.unread} parasite${waste.unread > 1 ? "s" : ""}`;
  }
  if (key === "truncated" && waste.truncated > 0) {
    return `${waste.truncated} coupé${waste.truncated > 1 ? "s" : ""} à 3:00`;
  }
  return null;
}

export function describeExcludeChange(
  prev: ImportExcludeOptions,
  next: ImportExcludeOptions,
  waste: LibraryWasteStats,
  mode: "toggle" | "all" | "restore",
): { kind: "ok" | "hint"; title: string; body: string } {
  const junkTotal = waste.duplicates + waste.unread + waste.truncated;
  const allParts = wasteParts(waste.duplicates, waste.unread, waste.truncated);
  if (mode === "restore") {
    const n = Math.max(waste.excludedCount, junkTotal);
    return {
      kind: "hint",
      title: `${n} titre${n > 1 ? "s" : ""} réintégré${n > 1 ? "s" : ""}`,
      body: "Ils reviennent dans la barre et le plan. Annuler pour l’étape d’avant. Rien n’a bougé sur le disque.",
    };
  }
  if (mode === "all") {
    return {
      kind: "ok",
      title: `${junkTotal} titre${junkTotal > 1 ? "s" : ""} hors barre et hors import`,
      body: `${allParts.join(" · ")}. La progression ne les compte plus. Annuler ou Tout réintégrer pour revenir en arrière.`,
    };
  }

  const on: string[] = [];
  const off: string[] = [];
  (["duplicates", "parasites", "truncated"] as const).forEach((key) => {
    if (prev[key] === next[key]) {
      return;
    }
    const label = labelForFlag(key, waste);
    if (!label) {
      return;
    }
    (next[key] ? on : off).push(label);
  });

  if (on.length > 0 && off.length === 0) {
    return {
      kind: "ok",
      title: "Retiré du plan",
      body: `${on.join(", ")} : hors barre, hors plan, hors import. Annuler pour les recompter. Les fichiers restent sur le disque.`,
    };
  }
  if (off.length > 0 && on.length === 0) {
    return {
      kind: "hint",
      title: "De retour dans le plan",
      body: `${off.join(", ")} : de retour dans la barre et le plan, copiés à l’import si tu confirmes.`,
    };
  }
  return {
    kind: "hint",
    title: "Filtre d’import mis à jour",
    body: "Le plan et le nombre de titres à copier ont changé. Rien n’est écrit sur le disque pour l’instant.",
  };
}

const EXCLUDE_STORAGE_KEY = "bassorder.importExclude.v1";

export function loadImportExcludes(): ImportExcludeOptions {
  try {
    const raw = localStorage.getItem(EXCLUDE_STORAGE_KEY);
    if (!raw) {
      return { ...DEFAULT_IMPORT_EXCLUDES };
    }
    const parsed = JSON.parse(raw) as Partial<ImportExcludeOptions>;
    return {
      parasites: parsed.parasites ?? DEFAULT_IMPORT_EXCLUDES.parasites,
      truncated: parsed.truncated ?? DEFAULT_IMPORT_EXCLUDES.truncated,
      duplicates: parsed.duplicates ?? DEFAULT_IMPORT_EXCLUDES.duplicates,
    };
  } catch {
    return { ...DEFAULT_IMPORT_EXCLUDES };
  }
}

export function saveImportExcludes(opts: ImportExcludeOptions): void {
  try {
    localStorage.setItem(EXCLUDE_STORAGE_KEY, JSON.stringify(opts));
  } catch {
    /* quota / private mode */
  }
}

export function isExcludedFromImport(
  track: Track,
  opts: ImportExcludeOptions,
): boolean {
  if (opts.duplicates && isDuplicateTrack(track)) {
    return true;
  }
  if (opts.parasites && track.genre === "Illisible") {
    return true;
  }
  if (
    opts.truncated &&
    (isQuarantinedTruncated(track) ||
      isLikelyTruncatedDuration(track.durationSecs))
  ) {
    return true;
  }
  return false;
}

/** Pistes réellement écrites à la copie / au déplacement. */
export function tracksForImport(
  tracks: Track[],
  opts: ImportExcludeOptions,
): Track[] {
  return tracks.filter((track) => !isExcludedFromImport(track, opts));
}

export function countExcluded(
  tracks: Track[],
  opts: ImportExcludeOptions,
): number {
  return tracks.reduce(
    (n, track) => n + (isExcludedFromImport(track, opts) ? 1 : 0),
    0,
  );
}
