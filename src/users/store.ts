import {
  dbDeleteUser,
  dbGetSession,
  dbListUsers,
  dbSetSession,
  dbUpsertUser,
  ensureFrontendMigrated,
  isTauri,
  type DbUser,
} from "../db";
import {
  migrateLegacyIntoUser,
  setActiveUserId,
  wipeUserStorage,
} from "./storage";
import { nearestUserColor, USER_COLORS, type AppUser, type UserStore } from "./types";

const USERS_KEY = "bassorder.users.v1";
const SESSION_KEY = "bassorder.session.userId";

let memUsers: AppUser[] | null = null;
let memSession: string | null | undefined = undefined;
let hydratePromise: Promise<void> | null = null;
let hydrated = false;

function uid(): string {
  return `u_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function emptyStore(): UserStore {
  return { users: [] };
}

function isUser(value: unknown): value is AppUser {
  if (!value || typeof value !== "object") {
    return false;
  }
  const u = value as AppUser;
  return typeof u.id === "string" && typeof u.name === "string";
}

function normalize(u: AppUser): AppUser {
  const color =
    typeof u.color === "string" && u.color.startsWith("#")
      ? nearestUserColor(u.color)
      : USER_COLORS[0];
  const avatarUrl =
    typeof u.avatarUrl === "string" && u.avatarUrl.trim()
      ? u.avatarUrl.trim()
      : null;
  return {
    id: u.id,
    name: u.name.trim() || "Utilisateur",
    color,
    avatarUrl,
    createdAt: typeof u.createdAt === "number" ? u.createdAt : Date.now(),
    lastUsedAt: typeof u.lastUsedAt === "number" ? u.lastUsedAt : Date.now(),
  };
}

function fromDb(u: DbUser): AppUser {
  return normalize({
    id: u.id,
    name: u.name,
    color: u.color,
    avatarUrl: u.avatarUrl ?? null,
    createdAt: u.createdAt,
    lastUsedAt: u.lastUsedAt,
  });
}

function toDb(u: AppUser): DbUser {
  return {
    id: u.id,
    name: u.name,
    color: u.color,
    avatarUrl: u.avatarUrl ?? null,
    createdAt: u.createdAt,
    lastUsedAt: u.lastUsedAt,
  };
}

function readStoreLocal(): UserStore {
  if (isTauri()) {
    return { users: memUsers ?? [] };
  }
  try {
    const raw = localStorage.getItem(USERS_KEY);
    if (!raw) {
      return emptyStore();
    }
    const parsed = JSON.parse(raw) as Partial<UserStore>;
    const users = Array.isArray(parsed.users)
      ? parsed.users.filter(isUser).map(normalize)
      : [];
    return { users };
  } catch {
    return emptyStore();
  }
}

function writeStoreLocal(store: UserStore): void {
  if (isTauri()) {
    return;
  }
  try {
    localStorage.setItem(USERS_KEY, JSON.stringify(store));
  } catch {
    /* quota */
  }
}

function ensureMem(): AppUser[] {
  if (memUsers) return memUsers;
  memUsers = readStoreLocal().users;
  return memUsers;
}

function putMem(user: AppUser): void {
  const users = ensureMem();
  const idx = users.findIndex((u) => u.id === user.id);
  if (idx >= 0) {
    users[idx] = user;
  } else {
    users.push(user);
  }
  memUsers = [...users];
  writeStoreLocal({ users: memUsers });
}

async function persistUser(user: AppUser): Promise<void> {
  putMem(user);
  if (isTauri()) {
    await dbUpsertUser(toDb(user));
  }
}

/** Charge users + session depuis SQLite (après migration). */
export async function hydrateUsersFromDb(force = false): Promise<void> {
  if (!isTauri()) {
    hydrated = true;
    return;
  }
  if (!force && hydratePromise) return hydratePromise;
  const run = (async () => {
    await ensureFrontendMigrated();
    try {
      const [users, session] = await Promise.all([dbListUsers(), dbGetSession()]);
      const fromDbUsers = users.map(fromDb);
      const byId = new Map<string, AppUser>();
      for (const u of fromDbUsers) {
        byId.set(u.id, u);
      }
      for (const u of memUsers ?? []) {
        const existing = byId.get(u.id);
        if (!existing || u.lastUsedAt >= existing.lastUsedAt) {
          byId.set(u.id, u);
        }
      }
      memUsers = [...byId.values()];
      if (!force || memSession === undefined) {
        memSession = session;
      }
      // Single-user : fusionne les anciens multi-profils.
      const sorted = [...memUsers].sort((a, b) => b.lastUsedAt - a.lastUsedAt);
      if (sorted.length > 1) {
        const keeper = sorted[0];
        for (const extra of sorted.slice(1)) {
          wipeUserStorage(extra.id);
          try {
            await dbDeleteUser(extra.id);
          } catch {
            /* ignore */
          }
        }
        memUsers = [keeper];
        writeStoreLocal({ users: memUsers });
        if (memSession && memSession !== keeper.id) {
          memSession = keeper.id;
          try {
            await dbSetSession(keeper.id);
          } catch {
            /* ignore */
          }
        }
      }
    } catch {
      memUsers = memUsers ?? [];
    } finally {
      hydrated = true;
    }
  })();
  if (!force) {
    hydratePromise = run;
  }
  return run;
}

export function isUsersHydrated(): boolean {
  return !isTauri() || hydrated;
}

export function listUsers(): AppUser[] {
  return [...ensureMem()].sort((a, b) => b.lastUsedAt - a.lastUsedAt);
}

/** Un seul utilisateur par install — garde le plus récemment utilisé. */
export async function ensureSoleUser(): Promise<AppUser | null> {
  const users = listUsers();
  if (users.length === 0) {
    return null;
  }
  if (users.length === 1) {
    return users[0];
  }
  const keeper = users[0];
  for (const extra of users.slice(1)) {
    await deleteUser(extra.id);
  }
  return listUsers().find((u) => u.id === keeper.id) ?? keeper;
}

/** L’unique utilisateur de cette install, ou null. */
export function getSoleUser(): AppUser | null {
  const users = listUsers();
  return users[0] ?? null;
}

export function getSessionUserId(): string | null {
  if (memSession !== undefined) {
    const id = memSession;
    if (!id) return null;
    return listUsers().some((u) => u.id === id) ? id : null;
  }
  if (isTauri()) {
    return null;
  }
  try {
    const id = localStorage.getItem(SESSION_KEY)?.trim() ?? "";
    if (!id) {
      return null;
    }
    return listUsers().some((u) => u.id === id) ? id : null;
  } catch {
    return null;
  }
}

export function getSessionUser(): AppUser | null {
  const id = getSessionUserId();
  if (!id) {
    return null;
  }
  return listUsers().find((u) => u.id === id) ?? null;
}

/** Prépare le storage scopé sans écrire la session (boot). */
export function hydrateUserSession(userId: string | null): AppUser | null {
  if (!userId) {
    setActiveUserId(null);
    return null;
  }
  const user = listUsers().find((u) => u.id === userId) ?? null;
  setActiveUserId(user?.id ?? null);
  return user;
}

export async function enterAsUser(id: string): Promise<AppUser | null> {
  const users = ensureMem();
  const user = users.find((u) => u.id === id);
  if (!user) {
    return null;
  }
  const next = normalize({ ...user, lastUsedAt: Date.now() });
  await persistUser(next);
  memSession = id;
  if (!isTauri()) {
    try {
      localStorage.setItem(SESSION_KEY, id);
    } catch {
      /* ignore */
    }
  }
  if (isTauri()) {
    await dbSetSession(id);
  }
  setActiveUserId(id);
  migrateLegacyIntoUser(id);
  return next;
}

export function clearSession(): void {
  memSession = null;
  if (!isTauri()) {
    try {
      localStorage.removeItem(SESSION_KEY);
    } catch {
      /* ignore */
    }
  }
  if (isTauri()) {
    void dbSetSession(null).catch(() => undefined);
  }
  setActiveUserId(null);
}

export async function createUser(name: string, color?: string): Promise<AppUser> {
  if (isTauri() && !hydrated) {
    await hydrateUsersFromDb();
  }
  await ensureSoleUser();
  const existing = getSoleUser();
  if (existing) {
    let next = existing;
    const trimmed = name.trim();
    if (trimmed && trimmed !== existing.name) {
      next = (await renameUser(existing.id, trimmed)) ?? next;
    }
    if (color && color !== next.color) {
      next = (await recolorUser(existing.id, color)) ?? next;
    }
    return next;
  }
  const trimmed = name.trim() || "Moi";
  const autoColor = color ?? USER_COLORS[0];

  const user = normalize({
    id: uid(),
    name: trimmed,
    color: autoColor,
    createdAt: Date.now(),
    lastUsedAt: Date.now(),
  });

  await persistUser(user);
  migrateLegacyIntoUser(user.id);

  return user;
}

export async function renameUser(id: string, name: string): Promise<AppUser | null> {
  const existing = ensureMem().find((u) => u.id === id);
  if (!existing) {
    return null;
  }
  const next = normalize({ ...existing, name: name.trim() || existing.name });
  await persistUser(next);
  return next;
}

export async function recolorUser(id: string, color: string): Promise<AppUser | null> {
  const existing = ensureMem().find((u) => u.id === id);
  if (!existing) {
    return null;
  }
  const next = normalize({ ...existing, color });
  await persistUser(next);
  return next;
}

export async function setUserAvatar(
  id: string,
  avatarUrl: string | null,
): Promise<AppUser | null> {
  const existing = ensureMem().find((u) => u.id === id);
  if (!existing) {
    return null;
  }
  const next = normalize({ ...existing, avatarUrl });
  await persistUser(next);
  return next;
}

export async function deleteUser(id: string): Promise<void> {
  memUsers = ensureMem().filter((u) => u.id !== id);
  writeStoreLocal({ users: memUsers });
  wipeUserStorage(id);
  if (isTauri()) {
    await dbDeleteUser(id);
  }
  if (getSessionUserId() === id) {
    clearSession();
  }
}

export function userInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) {
    return "?";
  }
  if (parts.length === 1) {
    return parts[0].slice(0, 2).toUpperCase();
  }
  return `${parts[0][0] ?? ""}${parts[1][0] ?? ""}`.toUpperCase();
}
