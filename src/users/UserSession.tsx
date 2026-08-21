import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { ensureFrontendMigrated, subscribeDbChanged } from "../db";
import { hydrateLibrariesFromDb, __resetLibraryCacheMem } from "../local/libraryCache";
import { activateActiveSpotifyProfile } from "../spotify/api";
import {
  hydrateImportsFromDb,
  __resetImportCacheMem,
} from "../spotify/importCache";
import {
  notifyImportsChanged,
  notifyProfilesChanged,
} from "../spotify/profileEvents";
import {
  hydrateProfilesFromDb,
  __resetProfileMem,
} from "../spotify/profiles";
import {
  createUser,
  deleteUser,
  enterAsUser,
  getSessionUser,
  hydrateUserSession,
  hydrateUsersFromDb,
  isUsersHydrated,
  listUsers,
  recolorUser,
  renameUser,
  setUserAvatar,
} from "./store";
import { setActiveUserId } from "./storage";
import type { AppUser } from "./types";

type UserSessionApi = {
  user: AppUser | null;
  users: AppUser[];
  ready: boolean;
  /** Id du dernier profil (gate), sans session ouverte. */
  lastUserId: string | null;
  refresh: () => void;
  enter: (id: string) => Promise<AppUser | null>;
  create: (name: string, color?: string) => Promise<AppUser>;
  rename: (id: string, name: string) => Promise<AppUser | null>;
  recolor: (id: string, color: string) => Promise<AppUser | null>;
  setAvatar: (id: string, avatarUrl: string | null) => Promise<AppUser | null>;
  remove: (id: string) => Promise<void>;
  leave: () => void;
};

const UserSessionContext = createContext<UserSessionApi | null>(null);

async function hydrateUserData(): Promise<void> {
  await ensureFrontendMigrated();
  await hydrateUsersFromDb();
}

async function hydrateScopedCaches(): Promise<void> {
  __resetLibraryCacheMem();
  __resetProfileMem();
  __resetImportCacheMem();
  await Promise.all([
    hydrateLibrariesFromDb(),
    hydrateProfilesFromDb(),
    hydrateImportsFromDb(),
  ]);
  notifyProfilesChanged();
  notifyImportsChanged();
  await activateActiveSpotifyProfile().catch(() => undefined);
}

export function UserSessionProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AppUser | null>(() => {
    hydrateUserSession(null);
    return null;
  });
  const [users, setUsers] = useState<AppUser[]>(() => listUsers());
  const [ready, setReady] = useState(() => isUsersHydrated());
  const [lastUserId, setLastUserId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      await hydrateUserData();
      if (!cancelled) {
        setUsers(listUsers());
        setLastUserId(getSessionUser()?.id ?? null);
        setReady(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    return subscribeDbChanged((ev) => {
      if (ev.entity === "users" || ev.entity === "session") {
        void hydrateUsersFromDb(true).then(() => {
          setUsers(listUsers());
          setUser(getSessionUser());
        });
      }
    });
  }, []);

  const refresh = useCallback(() => {
    setUsers(listUsers());
    setUser(getSessionUser());
  }, []);

  const enter = useCallback(async (id: string) => {
    const next = await enterAsUser(id);
    if (next) {
      setLastUserId(next.id);
      // Hydrate + active Spotify AVANT d’ouvrir l’UI — sinon profils vides → nouveaux ids sans tokens.
      await hydrateScopedCaches();
      setUser(next);
      setUsers(listUsers());
    } else {
      setUser(null);
      setUsers(listUsers());
    }
    return next;
  }, []);

  const create = useCallback(async (name: string, color?: string) => {
    const created = await createUser(name, color);
    setUsers(listUsers());
    return created;
  }, []);

  const rename = useCallback(async (id: string, name: string) => {
    const next = await renameUser(id, name);
    setUsers(listUsers());
    setUser(getSessionUser());
    return next;
  }, []);

  const recolor = useCallback(async (id: string, color: string) => {
    const next = await recolorUser(id, color);
    setUsers(listUsers());
    setUser(getSessionUser());
    return next;
  }, []);

  const setAvatar = useCallback(async (id: string, avatarUrl: string | null) => {
    const next = await setUserAvatar(id, avatarUrl);
    setUsers(listUsers());
    setUser(getSessionUser());
    return next;
  }, []);

  const remove = useCallback(async (id: string) => {
    await deleteUser(id);
    setUsers(listUsers());
    setUser(getSessionUser());
  }, []);

  const leave = useCallback(() => {
    setActiveUserId(null);
    __resetProfileMem();
    __resetImportCacheMem();
    __resetLibraryCacheMem();
    notifyProfilesChanged();
    notifyImportsChanged();
    setUser(null);
    setUsers(listUsers());
  }, []);

  const api = useMemo(
    () => ({
      user,
      users,
      ready,
      lastUserId,
      refresh,
      enter,
      create,
      rename,
      recolor,
      setAvatar,
      remove,
      leave,
    }),
    [
      user,
      users,
      ready,
      lastUserId,
      refresh,
      enter,
      create,
      rename,
      recolor,
      setAvatar,
      remove,
      leave,
    ],
  );

  return (
    <UserSessionContext.Provider value={api}>{children}</UserSessionContext.Provider>
  );
}

export function useUserSession(): UserSessionApi {
  const ctx = useContext(UserSessionContext);
  if (!ctx) {
    throw new Error("useUserSession hors UserSessionProvider");
  }
  return ctx;
}
