import { listLibraries } from "../local/libraryCache";
import { listProfiles } from "../spotify/profiles";

const FLAG = "firstRun.v1";

function flagKey(userId: string): string {
  return `bassorder.u.${userId}.${FLAG}`;
}

function readFlag(userId: string): "pending" | "done" | null {
  try {
    const value = localStorage.getItem(flagKey(userId));
    if (value === "done" || value === "pending") {
      return value;
    }
  } catch {
    /* private mode */
  }
  return null;
}

function writeFlag(userId: string, value: "pending" | "done"): void {
  try {
    localStorage.setItem(flagKey(userId), value);
  } catch {
    /* quota */
  }
}

export function hasFirstRunActivity(): boolean {
  return listLibraries().length > 0 || listProfiles().length > 0;
}

export function markFirstRunDone(userId?: string | null): void {
  if (!userId) {
    return;
  }
  writeFlag(userId, "done");
}

export type UnlockView = "home" | "local";

/** Accueil si déjà actif ; sinon Mes fichiers (premier geste). */
export function resolveUnlockView(userId: string): UnlockView {
  if (hasFirstRunActivity()) {
    markFirstRunDone(userId);
    return "home";
  }
  if (readFlag(userId) === "done") {
    return "home";
  }
  writeFlag(userId, "pending");
  return "local";
}
