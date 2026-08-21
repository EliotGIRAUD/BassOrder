import {
  dbDeleteSpotifyProfile,
  dbListSpotifyProfiles,
  dbSetActiveSpotifyProfile,
  dbUpsertSpotifyProfile,
  isTauri,
  type DbSpotifyProfile,
} from "../db";
import { getActiveUserId, readUserItem, writeUserItem } from "../users/storage";

export type SpotifyProfile = {
  id: string;
  name: string;
  clientId: string;
  createdAt: number;
  lastUsedAt: number;
  displayName?: string | null;
  avatarUrl?: string | null;
  lastSyncedAt?: number | null;
  likedCount?: number;
  artistCount?: number;
  groupCount?: number;
};

export type ProfileStore = {
  activeId: string | null;
  profiles: SpotifyProfile[];
};

const PROFILES_SUFFIX = "spotify.profiles.v1";
const CLIENT_SUFFIX = "spotify.clientId";

let profileMem: ProfileStore | null = null;

function emptyStore(): ProfileStore {
  return { activeId: null, profiles: [] };
}

/** Vide le cache mémoire (changement d’utilisateur BassOrder). */
export function __resetProfileMem(): void {
  profileMem = null;
}

function profileScore(p: SpotifyProfile): number {
  return (
    (p.likedCount ?? 0) * 1_000_000 +
    (p.artistCount ?? 0) * 1_000 +
    (p.lastSyncedAt ?? 0) / 1_000_000 +
    (Number.MAX_SAFE_INTEGER - (p.createdAt || 0)) / 1e15
  );
}

/** Un seul profil par Client ID — évite les clones créés avant hydrate. */
function dedupeByClientId(profiles: SpotifyProfile[]): SpotifyProfile[] {
  const kept = new Map<string, SpotifyProfile>();
  const noClient: SpotifyProfile[] = [];
  for (const p of profiles) {
    const key = p.clientId.trim().toLowerCase();
    if (!key) {
      noClient.push(p);
      continue;
    }
    const prev = kept.get(key);
    if (!prev || profileScore(p) > profileScore(prev)) {
      kept.set(key, p);
    }
  }
  return [...kept.values(), ...noClient];
}

function uid(): string {
  return `p_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function isProfile(value: unknown): value is SpotifyProfile {
  if (!value || typeof value !== "object") {
    return false;
  }
  const p = value as SpotifyProfile;
  return typeof p.id === "string" && typeof p.clientId === "string";
}

function normalizeProfile(p: SpotifyProfile): SpotifyProfile {
  return {
    id: p.id,
    name: typeof p.name === "string" && p.name.trim() ? p.name : "Spotify",
    clientId: p.clientId,
    createdAt: typeof p.createdAt === "number" ? p.createdAt : Date.now(),
    lastUsedAt: typeof p.lastUsedAt === "number" ? p.lastUsedAt : Date.now(),
    displayName: p.displayName ?? null,
    avatarUrl: p.avatarUrl ?? null,
    lastSyncedAt: p.lastSyncedAt ?? null,
    likedCount: typeof p.likedCount === "number" ? p.likedCount : 0,
    artistCount: typeof p.artistCount === "number" ? p.artistCount : 0,
    groupCount: typeof p.groupCount === "number" ? p.groupCount : 0,
  };
}

function readRaw(): ProfileStore {
  if (isTauri()) {
    return profileMem ?? emptyStore();
  }
  try {
    const raw = readUserItem(PROFILES_SUFFIX);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<ProfileStore>;
      const profiles = Array.isArray(parsed.profiles)
        ? parsed.profiles.filter(isProfile).map(normalizeProfile)
        : [];
      const activeId =
        typeof parsed.activeId === "string" && profiles.some((p) => p.id === parsed.activeId)
          ? parsed.activeId
          : (profiles[0]?.id ?? null);
      return { activeId, profiles };
    }
  } catch {
    /* ignore */
  }

  try {
    const legacy = readUserItem(CLIENT_SUFFIX)?.trim() ?? "";
    if (legacy.length >= 8) {
      const profile = normalizeProfile({
        id: uid(),
        name: "Spotify",
        clientId: legacy,
        createdAt: Date.now(),
        lastUsedAt: Date.now(),
      });
      const store: ProfileStore = { activeId: profile.id, profiles: [profile] };
      writeStore(store);
      return store;
    }
  } catch {
    /* ignore */
  }

  return emptyStore();
}

function writeStore(store: ProfileStore): void {
  profileMem = store;
  if (!isTauri()) {
    try {
      writeUserItem(PROFILES_SUFFIX, JSON.stringify(store));
      const active = store.profiles.find((p) => p.id === store.activeId);
      if (active?.clientId) {
        writeUserItem(CLIENT_SUFFIX, active.clientId);
      }
    } catch {
      /* quota */
    }
  }
  persistProfilesToDb(store);
}

function persistProfilesToDb(store: ProfileStore): void {
  if (!isTauri()) return;
  const userId = getActiveUserId();
  if (!userId) return;
  for (const p of store.profiles) {
    const row: DbSpotifyProfile = {
      id: p.id,
      userId,
      name: p.name,
      clientId: p.clientId,
      createdAt: p.createdAt,
      lastUsedAt: p.lastUsedAt,
      displayName: p.displayName ?? null,
      avatarUrl: p.avatarUrl ?? null,
      lastSyncedAt: p.lastSyncedAt ?? null,
      likedCount: p.likedCount ?? 0,
      artistCount: p.artistCount ?? 0,
      groupCount: p.groupCount ?? 0,
      isActive: store.activeId === p.id,
    };
    void dbUpsertSpotifyProfile(row).catch(() => undefined);
  }
}

export async function hydrateProfilesFromDb(): Promise<void> {
  if (!isTauri()) return;
  const userId = getActiveUserId();
  if (!userId) {
    profileMem = emptyStore();
    return;
  }
  try {
    const rows = await dbListSpotifyProfiles(userId);
    if (rows.length === 0) {
      profileMem = emptyStore();
      return;
    }
    const profiles = dedupeByClientId(
      rows.map((p) =>
        normalizeProfile({
          id: p.id,
          name: p.name,
          clientId: p.clientId,
          createdAt: p.createdAt,
          lastUsedAt: p.lastUsedAt,
          displayName: p.displayName,
          avatarUrl: p.avatarUrl,
          lastSyncedAt: p.lastSyncedAt,
          likedCount: p.likedCount,
          artistCount: p.artistCount,
          groupCount: p.groupCount,
        }),
      ),
    );
    const preferredActive =
      rows.find((r) => r.isActive)?.id ?? null;
    const activeId =
      (preferredActive && profiles.some((p) => p.id === preferredActive)
        ? preferredActive
        : null) ??
      profiles[0]?.id ??
      null;
    profileMem = { activeId, profiles };
  } catch {
    /* keep mem */
  }
}

export function listProfiles(): SpotifyProfile[] {
  return [...readRaw().profiles].sort((a, b) => b.lastUsedAt - a.lastUsedAt);
}

export function getActiveProfile(): SpotifyProfile | null {
  const store = readRaw();
  return store.profiles.find((p) => p.id === store.activeId) ?? null;
}

export function readActiveClientId(): string {
  return getActiveProfile()?.clientId ?? "";
}

export function selectProfile(id: string): SpotifyProfile | null {
  const store = readRaw();
  const profile = store.profiles.find((p) => p.id === id);
  if (!profile) {
    return null;
  }
  writeStore({
    ...store,
    activeId: id,
    profiles: store.profiles.map((p) =>
      p.id === id ? { ...p, lastUsedAt: Date.now() } : p,
    ),
  });
  const userId = getActiveUserId();
  if (userId && isTauri()) {
    void dbSetActiveSpotifyProfile(userId, id).catch(() => undefined);
  }
  return getActiveProfile();
}

/** Crée ou met à jour un profil nommé avec ce Client ID. */
export function saveProfile(
  name: string,
  clientId: string,
  meta?: Partial<
    Pick<
      SpotifyProfile,
      | "displayName"
      | "avatarUrl"
      | "lastSyncedAt"
      | "likedCount"
      | "artistCount"
      | "groupCount"
    >
  >,
): SpotifyProfile {
  const trimmedName = name.trim() || "Profil Spotify";
  const trimmedId = clientId.trim();
  const store = readRaw();
  // Unicité par Client ID uniquement (pas par nom — évite de fusionner 2 comptes).
  const existing = store.profiles.find(
    (p) => p.clientId.trim().toLowerCase() === trimmedId.toLowerCase(),
  );

  if (existing) {
    const next = normalizeProfile({
      ...existing,
      name: trimmedName,
      clientId: trimmedId,
      lastUsedAt: Date.now(),
      ...meta,
    });
    writeStore({
      activeId: next.id,
      profiles: store.profiles.map((p) => (p.id === next.id ? next : p)),
    });
    return next;
  }

  const profile = normalizeProfile({
    id: uid(),
    name: trimmedName,
    clientId: trimmedId,
    createdAt: Date.now(),
    lastUsedAt: Date.now(),
    ...meta,
  });
  writeStore({
    activeId: profile.id,
    profiles: [...store.profiles, profile],
  });
  return profile;
}

export function updateProfileMeta(
  id: string,
  meta: Partial<
    Pick<
      SpotifyProfile,
      | "name"
      | "displayName"
      | "avatarUrl"
      | "lastSyncedAt"
      | "likedCount"
      | "artistCount"
      | "groupCount"
    >
  >,
): SpotifyProfile | null {
  const store = readRaw();
  const existing = store.profiles.find((p) => p.id === id);
  if (!existing) {
    return null;
  }
  const next = normalizeProfile({ ...existing, ...meta, lastUsedAt: Date.now() });
  writeStore({
    ...store,
    activeId: id,
    profiles: store.profiles.map((p) => (p.id === id ? next : p)),
  });
  return next;
}

export function deleteProfile(id: string): ProfileStore {
  const store = readRaw();
  const profiles = store.profiles.filter((p) => p.id !== id);
  const activeId =
    store.activeId === id ? (profiles[0]?.id ?? null) : store.activeId;
  const next = { activeId, profiles };
  writeStore(next);
  if (isTauri()) {
    void dbDeleteSpotifyProfile(id).catch(() => undefined);
  }
  return next;
}

export function touchActiveClientId(clientId: string): void {
  const trimmed = clientId.trim();
  const store = readRaw();
  if (!store.activeId) {
    if (trimmed.length >= 8) {
      writeUserItem(CLIENT_SUFFIX, trimmed);
    }
    return;
  }
  writeStore({
    ...store,
    profiles: store.profiles.map((p) =>
      p.id === store.activeId ? { ...p, clientId: trimmed, lastUsedAt: Date.now() } : p,
    ),
  });
}
