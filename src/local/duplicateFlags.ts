import type { Track } from "./types";
import { isLikelyTruncatedDuration } from "./durationFlags";

/** Copies en trop — visibles dans le plan, exclus du comptage et de l’import. */
export const DUPLICATE_GENRE = "Doublons";
export const DUPLICATE_FOLDER = "Doublons";

export function isDuplicateTrack(track: Track): boolean {
  return track.folder === DUPLICATE_FOLDER || track.genre === DUPLICATE_GENRE;
}

export function duplicateTracksFrom(tracks: Track[]): Track[] {
  return tracks.filter(isDuplicateTrack);
}

export function countableTracks(tracks: Track[]): Track[] {
  return tracks.filter((track) => !isDuplicateTrack(track));
}

export function importableTracks(tracks: Track[]): Track[] {
  return countableTracks(tracks);
}

function fold(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase();
}

function stripCopySuffix(stem: string): string {
  return stem
    .replace(/\s*[-–—_]\s*(?:copy|copie|duplicate|dupli(?:cat)?)\s*\d*\s*$/i, "")
    .replace(/\s*\(\s*(?:copy|copie|\d+)\s*\)\s*$/i, "")
    .replace(/\s*-\s*copie\s*$/i, "")
    .trim();
}

/** Identité « même morceau » : artiste+titre, sinon nom de fichier nettoyé. */
export function songIdentity(track: Track): string | null {
  const title = cleanTitle(track.title || "");
  const artist = cleanArtist(track.artist || "");
  if (artist.length >= 2 && title.length >= 2) {
    return `t:${artist}|${title}`;
  }
  const stem = stripCopySuffix(track.fileName.replace(/\.[^.]+$/, ""));
  const file = cleanTitle(stem);
  if (file.length >= 8) {
    return `f:${file}`;
  }
  return null;
}

function cleanArtist(raw: string): string {
  return normalizeKey(
    raw.replace(/\b(?:feat(?:uring)?|ft\.?)\b[\s.]+.+$/i, " "),
  );
}

function cleanTitle(raw: string): string {
  return normalizeKey(
    raw
      .replace(/^\s*[\[({]?\d{1,3}[\])}]?(?:\s*[.\-_–—:]\s*|\s+)/, " ")
      .replace(
        /\b(?:official(?:\s+(?:music\s+)?video)?|lyric(?:s)?(?:\s+video)?|audio|visualizer|hq|hd)\b/gi,
        " ",
      ),
  );
}

function normalizeKey(raw: string): string {
  return fold(raw)
    .replace(/[''`´]/g, "")
    .replace(/&/g, " and ")
    .replace(/\([^)]*\)|\[[^\]]*\]/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function sameDuration(a: number | null, b: number | null): boolean {
  if (a == null || b == null) {
    return true;
  }
  if (isLikelyTruncatedDuration(a) || isLikelyTruncatedDuration(b)) {
    return true;
  }
  const diff = Math.abs(a - b);
  const longest = Math.max(a, b);
  return diff <= 20 || (longest > 0 && diff / longest <= 0.12);
}

function quality(track: Track): number {
  let score = 0;
  score += track.bitrateKbps ?? 0;
  const duration = track.durationSecs ?? 0;
  if (isLikelyTruncatedDuration(duration)) {
    score -= 80;
  } else {
    score += Math.min(duration, 600);
  }
  if (track.title?.trim() && track.artist?.trim()) {
    score += 40;
  }
  if (isDuplicateTrack(track)) {
    score -= 1000;
  } else if (track.genre !== "Sans genre" && track.genre !== "Illisible") {
    score += 25;
  }
  const ext = track.fileName.split(".").pop()?.toLowerCase();
  if (ext === "flac" || ext === "wav" || ext === "aiff" || ext === "alac") {
    score += 80;
  } else if (ext === "m4a" || ext === "aac") {
    score += 10;
  }
  if (/\(\s*\d+\s*\)/.test(track.fileName) || /\b(?:copy|copie)\b/i.test(track.fileName)) {
    score -= 30;
  }
  return score;
}

function betterKeeper(a: Track, b: Track): Track {
  const qa = quality(a);
  const qb = quality(b);
  if (qa !== qb) {
    return qa > qb ? a : b;
  }
  return a.path.localeCompare(b.path) <= 0 ? a : b;
}

type Cluster = { keeper: Track; extras: Track[] };

function clusterDuplicates(tracks: Track[]): Cluster[] {
  const buckets = new Map<string, Track[]>();
  for (const track of tracks) {
    const key = songIdentity(track);
    if (!key) {
      continue;
    }
    const list = buckets.get(key);
    if (list) {
      list.push(track);
    } else {
      buckets.set(key, [track]);
    }
  }

  const clusters: Cluster[] = [];
  for (const group of buckets.values()) {
    if (group.length < 2) {
      continue;
    }
    const used = new Set<string>();
    for (const seed of group) {
      if (used.has(seed.path)) {
        continue;
      }
      const pack = group.filter(
        (other) =>
          !used.has(other.path) &&
          sameDuration(seed.durationSecs, other.durationSecs),
      );
      for (const track of pack) {
        used.add(track.path);
      }
      if (pack.length < 2) {
        continue;
      }
      const keeper = pack.reduce(betterKeeper);
      clusters.push({
        keeper,
        extras: pack.filter((track) => track.path !== keeper.path),
      });
    }
  }
  return clusters;
}

/** Chemins des copies à écarter (on garde le meilleur de chaque morceau). */
export function duplicateExtraPaths(tracks: Track[]): Set<string> {
  const extras = new Set<string>();
  for (const cluster of clusterDuplicates(tracks)) {
    for (const extra of cluster.extras) {
      extras.add(extra.path);
    }
  }
  return extras;
}

/** Copie extra → exemplaire conservé (qualité / tags / durée). */
export function duplicateKeeperMap(tracks: Track[]): Map<string, Track> {
  const map = new Map<string, Track>();
  for (const cluster of clusterDuplicates(tracks)) {
    for (const extra of cluster.extras) {
      map.set(extra.path, cluster.keeper);
    }
  }
  return map;
}

export function keeperOf(track: Track, tracks: Track[]): Track | null {
  return duplicateKeeperMap(tracks).get(track.path) ?? null;
}

/** Range les copies en trop dans « Doublons » — le meilleur exemplaire reste classé. */
export function quarantineDuplicateTracks(tracks: Track[]): Track[] {
  const extras = duplicateExtraPaths(tracks);
  if (extras.size === 0) {
    return tracks;
  }
  return tracks.map((track) => {
    if (!extras.has(track.path) || isDuplicateTrack(track)) {
      return track;
    }
    return {
      ...track,
      genre: DUPLICATE_GENRE,
      folder: DUPLICATE_FOLDER,
    };
  });
}
