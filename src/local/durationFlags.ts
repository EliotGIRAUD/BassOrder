import type { Track } from "./types";

/** Durée typique des fichiers coupés (téléchargements / rips incomplets). */
export const TRUNCATED_DURATION_SECS = 180;

/** Dossier / genre dédié une fois isolés des autres dossiers. */
export const TRUNCATED_GENRE = "Coupés à 3:00";
export const TRUNCATED_FOLDER = "Coupés à 3:00";

/** @deprecated alias — même id que le dossier réel */
export const TRUNCATED_FOLDER_ID = TRUNCATED_FOLDER;

/** Exactement 3:00 — signal très fréquent de fichiers tronqués. */
export function isLikelyTruncatedDuration(secs: number | null | undefined): boolean {
  return secs === TRUNCATED_DURATION_SECS;
}

export function isQuarantinedTruncated(track: Track): boolean {
  return (
    track.folder === TRUNCATED_FOLDER ||
    track.genre === TRUNCATED_GENRE
  );
}

/** Encore classé dans un genre « normal » alors que durée = 3:00. */
export function isTruncatedStillInGenre(track: Track): boolean {
  return isLikelyTruncatedDuration(track.durationSecs) && !isQuarantinedTruncated(track);
}

export function truncatedTracksFrom(tracks: Track[]): Track[] {
  return tracks.filter((t) => isLikelyTruncatedDuration(t.durationSecs));
}

export function quarantineTruncatedTracks(
  tracks: Track[],
  onlyPaths?: Set<string>,
): Track[] {
  return tracks.map((track) => {
    if (!isLikelyTruncatedDuration(track.durationSecs)) {
      return track;
    }
    if (onlyPaths && !onlyPaths.has(track.path)) {
      return track;
    }
    if (isQuarantinedTruncated(track)) {
      return track;
    }
    return {
      ...track,
      genre: TRUNCATED_GENRE,
      folder: TRUNCATED_FOLDER,
    };
  });
}

export function allLibraryTracks(
  groups: { tracks: Track[] }[],
): Track[] {
  const seen = new Set<string>();
  const out: Track[] = [];
  for (const group of groups) {
    for (const track of group.tracks) {
      if (seen.has(track.path)) {
        continue;
      }
      seen.add(track.path);
      out.push(track);
    }
  }
  return out;
}
