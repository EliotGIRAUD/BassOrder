/** Helpers localStorage — no-op sous Tauri (SQLite = source de vérité). */

import { isTauri } from "../db/runtime";

let activeUserId: string | null = null;

const LEGACY_BY_SUFFIX: Record<string, string> = {
  "libraries.v1": "bassorder.libraries.v1",
  "spotify.imports.v1": "bassorder.spotify.imports.v1",
  "spotify.profiles.v1": "bassorder.spotify.profiles.v1",
  "spotify.clientId": "bassorder.spotify.clientId",
  "prefs.v1": "bassorder.prefs.v1",
};

export function setActiveUserId(id: string | null): void {
  activeUserId = id;
}

export function getActiveUserId(): string | null {
  return activeUserId;
}

/** `suffix` ex. `libraries.v1` → `bassorder.u.{id}.libraries.v1` */
export function userStorageKey(suffix: string): string {
  if (!activeUserId) {
    throw new Error("Aucun utilisateur actif.");
  }
  return `bassorder.u.${activeUserId}.${suffix}`;
}

/** Lit une clé utilisateur ; si absente, tente la clé legacy globale. */
export function readUserItem(suffix: string): string | null {
  if (isTauri()) {
    return null;
  }
  try {
    if (activeUserId) {
      const scoped = localStorage.getItem(userStorageKey(suffix));
      if (scoped != null) {
        return scoped;
      }
    }
    const legacy = LEGACY_BY_SUFFIX[suffix];
    if (legacy) {
      return localStorage.getItem(legacy);
    }
  } catch {
    /* private mode */
  }
  return null;
}

export function writeUserItem(suffix: string, value: string): void {
  if (isTauri() || !activeUserId) {
    return;
  }
  try {
    localStorage.setItem(userStorageKey(suffix), value);
  } catch {
    /* quota */
  }
}

export function removeUserItem(suffix: string): void {
  if (isTauri()) {
    return;
  }
  try {
    localStorage.removeItem(userStorageKey(suffix));
  } catch {
    /* ignore */
  }
}

/** Copie les données globales legacy vers le premier utilisateur (une fois). Navigateur only. */
export function migrateLegacyIntoUser(userId: string): void {
  if (isTauri()) {
    return;
  }
  const flag = `bassorder.u.${userId}.migrated.v1`;
  try {
    if (localStorage.getItem(flag)) {
      return;
    }
    let moved = false;
    for (const [suffix, legacy] of Object.entries(LEGACY_BY_SUFFIX)) {
      const target = `bassorder.u.${userId}.${suffix}`;
      if (localStorage.getItem(target)) {
        continue;
      }
      const raw = localStorage.getItem(legacy);
      if (raw != null) {
        localStorage.setItem(target, raw);
        moved = true;
      }
    }
    if (moved) {
      localStorage.setItem(flag, "1");
    }
  } catch {
    /* ignore */
  }
}

/** Efface toutes les clés `bassorder.u.{id}.*` d’un utilisateur. */
export function wipeUserStorage(userId: string): void {
  const prefix = `bassorder.u.${userId}.`;
  try {
    const keys: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key?.startsWith(prefix)) {
        keys.push(key);
      }
    }
    for (const key of keys) {
      localStorage.removeItem(key);
    }
  } catch {
    /* ignore */
  }
}

/** Après migration SQLite : purge toutes les clés BassOrder sauf le flag migration. */
export function wipeAbsorbedLocalStorage(): void {
  const KEEP = new Set(["bassorder.db.frontendMigrated.v1"]);
  try {
    const keys: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key?.startsWith("bassorder.") && !KEEP.has(key)) {
        keys.push(key);
      }
    }
    for (const key of keys) {
      localStorage.removeItem(key);
    }
  } catch {
    /* ignore */
  }
}
