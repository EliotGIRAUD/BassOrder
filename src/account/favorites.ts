import { invokeDb, isTauri } from "../db/runtime";

export type FavoriteKind =
  | "track"
  | "artist"
  | "genre"
  | "folder"
  | "scan"
  | "spotify_import"
  | "setting_preset";

export type Favorite = {
  id: string;
  userId: string;
  kind: FavoriteKind | string;
  refKey: string;
  title: string;
  meta: Record<string, unknown>;
  createdAt: number;
  updatedAt: number;
};

export type AccountPreset = {
  id: string;
  userId: string;
  name: string;
  prefs: Record<string, unknown>;
  createdAt: number;
  updatedAt: number;
};

export type CloudLink = {
  userId: string;
  accountId: string | null;
  email: string | null;
  apiBaseUrl: string | null;
  lastSyncAt: number | null;
  linkedAt: number | null;
  hasTokens: boolean;
};

function uid(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export async function listFavorites(userId: string): Promise<Favorite[]> {
  if (!isTauri()) return [];
  return invokeDb("db_list_favorites", { userId });
}

export async function upsertFavorite(
  partial: Omit<Favorite, "id" | "createdAt" | "updatedAt"> & {
    id?: string;
    createdAt?: number;
    updatedAt?: number;
  },
): Promise<Favorite> {
  const favorite: Favorite = {
    id: partial.id ?? uid("fav"),
    userId: partial.userId,
    kind: partial.kind,
    refKey: partial.refKey,
    title: partial.title,
    meta: partial.meta ?? {},
    createdAt: partial.createdAt ?? Date.now(),
    updatedAt: Date.now(),
  };
  if (!isTauri()) return favorite;
  return invokeDb("db_upsert_favorite", { favorite });
}

export async function deleteFavorite(favoriteId: string): Promise<void> {
  if (!isTauri()) return;
  await invokeDb("db_delete_favorite", { favoriteId });
}

export async function listAccountPresets(userId: string): Promise<AccountPreset[]> {
  if (!isTauri()) return [];
  return invokeDb("db_list_account_presets", { userId });
}

export async function upsertAccountPreset(
  partial: Omit<AccountPreset, "id" | "createdAt" | "updatedAt"> & {
    id?: string;
  },
): Promise<AccountPreset> {
  const preset: AccountPreset = {
    id: partial.id ?? uid("preset"),
    userId: partial.userId,
    name: partial.name,
    prefs: partial.prefs,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  if (!isTauri()) return preset;
  return invokeDb("db_upsert_account_preset", { preset });
}

export async function deleteAccountPreset(presetId: string): Promise<void> {
  if (!isTauri()) return;
  await invokeDb("db_delete_account_preset", { presetId });
}

export async function getCloudLink(userId: string): Promise<CloudLink | null> {
  if (!isTauri()) return null;
  return invokeDb("db_get_cloud_link", { userId });
}

export async function setCloudLink(args: {
  userId: string;
  accountId?: string | null;
  email?: string | null;
  apiBaseUrl?: string | null;
  accessToken?: string | null;
  refreshToken?: string | null;
  expiresAt?: number | null;
}): Promise<CloudLink> {
  return invokeDb("db_set_cloud_link", {
    userId: args.userId,
    accountId: args.accountId ?? null,
    email: args.email ?? null,
    apiBaseUrl: args.apiBaseUrl ?? null,
    accessToken: args.accessToken ?? null,
    refreshToken: args.refreshToken ?? null,
    expiresAt: args.expiresAt ?? null,
  });
}

export async function clearCloudLink(userId: string): Promise<void> {
  if (!isTauri()) return;
  await invokeDb("db_clear_cloud_link", { userId });
}

/** Déconnexion cloud avec révocation serveur des refresh tokens. */
export async function cloudDisconnect(userId: string): Promise<void> {
  if (!isTauri()) return;
  await invokeDb("cloud_logout", { userId });
}

/** Suppression définitive du compte cloud (serveur) + lien local. */
export async function deleteLinkedCloudAccount(
  userId: string,
  password?: string,
): Promise<void> {
  if (!isTauri()) return;
  await invokeDb("cloud_delete_account", {
    userId,
    password: password ?? null,
  });
}
