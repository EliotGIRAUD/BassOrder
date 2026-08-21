import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { confirm, open } from "@tauri-apps/plugin-dialog";
import type { LookupProgress, OrganizeMode, OrganizeResult, RenameMode, ScanProgress, ScanResult, Track } from "./types";

export function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

export async function pickMusicFolder(): Promise<string | null> {
  const selected = await open({
    directory: true,
    multiple: false,
    recursive: true,
    title: "Choisir un dossier de musique",
  });
  if (typeof selected !== "string" || selected.length === 0) {
    return null;
  }
  if (!isSafeLibraryPath(selected)) {
    throw new Error("Ce chemin n’est pas autorisé.");
  }
  return selected;
}

/** Dossier parent où créer / écrire la bibliothèque triée par genre. */
export async function pickOrganizeDestination(): Promise<string | null> {
  const selected = await open({
    directory: true,
    multiple: false,
    recursive: true,
    title: "Où créer ta bibliothèque triée ?",
  });
  if (typeof selected !== "string" || selected.length === 0) {
    return null;
  }
  if (!isSafeLibraryPath(selected)) {
    throw new Error("Ce chemin n’est pas autorisé.");
  }
  return selected;
}

/** Refuse les chemins clairement dangereux avant l’appel Rust. */
export function isSafeLibraryPath(path: string): boolean {
  if (!path || path.includes("\0") || path.length > 4096) {
    return false;
  }
  const lower = path.toLowerCase();
  const blocked = [
    "\\windows\\system32",
    "\\windows\\syswow64",
    "\\program files\\",
    "\\program files (x86)\\",
    "/.ssh/",
    "\\.ssh\\",
    "/.gnupg/",
    "\\.gnupg\\",
  ];
  return !blocked.some((marker) => lower.includes(marker));
}

export function ensureLibraryAccess(root: string): Promise<void> {
  if (!isSafeLibraryPath(root)) {
    return Promise.reject(new Error("Ce chemin n’est pas autorisé."));
  }
  return invoke("ensure_library_access", { root });
}

export function scanLibrary(root: string): Promise<ScanResult> {
  if (!isSafeLibraryPath(root)) {
    return Promise.reject(new Error("Ce chemin n’est pas autorisé."));
  }
  return invoke<ScanResult>("scan_local_library", { root });
}

export function enrichGenres(root: string, tracks: Track[]): Promise<ScanResult> {
  if (!isSafeLibraryPath(root)) {
    return Promise.reject(new Error("Ce chemin n’est pas autorisé."));
  }
  return invoke<ScanResult>("enrich_local_genres", { root, tracks });
}

export function onLookupProgress(
  handler: (progress: LookupProgress) => void,
): Promise<() => void> {
  return listen<LookupProgress>("genre-lookup-progress", (event) => {
    handler(event.payload);
  });
}

export function onScanProgress(
  handler: (progress: ScanProgress) => void,
): Promise<() => void> {
  return listen<ScanProgress>("local-scan-progress", (event) => {
    handler(event.payload);
  });
}

export function organizeLibrary(
  root: string,
  destination: string,
  mode: OrganizeMode,
  tracks: { path: string; folder: string; title?: string | null; artist?: string | null }[],
  renameMode: RenameMode = "artistTitle",
): Promise<OrganizeResult> {
  if (!isSafeLibraryPath(root) || !isSafeLibraryPath(destination)) {
    return Promise.reject(new Error("Ce chemin n’est pas autorisé."));
  }
  return invoke<OrganizeResult>("organize_local_library", {
    root,
    destination,
    mode,
    renameMode,
    tracks,
  });
}

export function confirmMove(count: number, destination: string): Promise<boolean> {
  return confirm(
    `${count} titre${count > 1 ? "s" : ""} seront déplacé${count > 1 ? "s" : ""} vers :\n${destination}\n\nLes fichiers quitteront leur emplacement actuel. Continuer ?`,
    { title: "Confirmer le déplacement ?", kind: "warning" },
  );
}

export function mediaSrc(path: string): string {
  if (!path || path.includes("\0")) {
    return "";
  }
  return convertFileSrc(path);
}

export function loadTrackCover(path: string): Promise<string | null> {
  if (!path || path.includes("\0")) {
    return Promise.resolve(null);
  }
  return invoke<string | null>("load_track_cover", { path });
}
