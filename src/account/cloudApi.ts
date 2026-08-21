/** Client HTTP vers l’API BassOrder self-host. */

export type CloudAuthTokens = {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  accountId: string;
  email: string;
};

export type CloudMe = {
  id: string;
  email: string;
  createdAt: string;
};

export type KnowledgeMirrorArtist = {
  name: string;
  spotifyId?: string;
  likes?: number;
  rawGenres?: string[];
  parent: string;
  sub?: string;
};

export type KnowledgeMirrorPayload = {
  profileId: string;
  version?: number;
  syncedAt?: string | null;
  displayName?: string | null;
  likedCount?: number;
  artists: Record<string, KnowledgeMirrorArtist>;
};

export type KnowledgeMirrorPutResult = {
  profileId: string;
  artistCount: number;
  updatedAt: string;
};

export type KnowledgeMirrorGetResult = KnowledgeMirrorPayload & {
  updatedAt: string;
};

export type KnowledgePoolEntry = {
  artistKey: string;
  parent: string;
  sub: string;
  votes: number;
  weight: number;
};

export type KnowledgePoolResult = {
  entries: KnowledgePoolEntry[];
};

const DEFAULT_API =
  (typeof import.meta !== "undefined" &&
    (import.meta as { env?: { VITE_BASSORDER_API?: string } }).env
      ?.VITE_BASSORDER_API) ||
  "http://127.0.0.1:8787";

let apiBase = DEFAULT_API;

export function getApiBase(): string {
  return apiBase.replace(/\/$/, "");
}

export function setApiBase(url: string): void {
  apiBase = url.trim().replace(/\/$/, "") || DEFAULT_API;
}

async function api<T>(
  path: string,
  init: RequestInit & { token?: string } = {},
): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set("Accept", "application/json");
  if (init.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  if (init.token) {
    headers.set("Authorization", `Bearer ${init.token}`);
  }
  const res = await fetch(`${getApiBase()}${path}`, {
    ...init,
    headers,
  });
  if (!res.ok) {
    let message = `HTTP ${res.status}`;
    try {
      const body = (await res.json()) as { error?: string };
      if (body.error) message = body.error;
    } catch {
      /* ignore */
    }
    throw new Error(message);
  }
  if (res.status === 204) {
    return undefined as T;
  }
  return (await res.json()) as T;
}

export async function cloudHealth(): Promise<{ ok: boolean; version: string }> {
  return api("/health");
}

export async function cloudRegister(
  email: string,
  password: string,
): Promise<CloudAuthTokens> {
  return api("/auth/register", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });
}

export async function cloudLogin(
  email: string,
  password: string,
): Promise<CloudAuthTokens> {
  return api("/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });
}

export async function cloudRefresh(refreshToken: string): Promise<CloudAuthTokens> {
  return api("/auth/refresh", {
    method: "POST",
    body: JSON.stringify({ refreshToken }),
  });
}

export async function cloudLogout(
  accessToken: string,
  refreshToken: string,
): Promise<void> {
  await api("/auth/logout", {
    method: "POST",
    token: accessToken,
    body: JSON.stringify({ refreshToken }),
  });
}

export async function cloudMe(accessToken: string): Promise<CloudMe> {
  return api("/auth/me", { token: accessToken });
}

/** Push miroir knowledge (artistes classés). */
export async function cloudKnowledgePush(
  accessToken: string,
  payload: KnowledgeMirrorPayload,
): Promise<KnowledgeMirrorPutResult> {
  return api("/knowledge/mirror", {
    method: "PUT",
    token: accessToken,
    body: JSON.stringify(payload),
  });
}

/** Restaure le miroir privé du compte. */
export async function cloudKnowledgePull(
  accessToken: string,
  profileId: string,
): Promise<KnowledgeMirrorGetResult> {
  const q = encodeURIComponent(profileId);
  return api(`/knowledge/mirror?profileId=${q}`, { token: accessToken });
}

/** Consensus pool (lecture seule) pour combler les trous locaux. */
export async function cloudKnowledgePool(
  accessToken: string,
  opts?: { keys?: string[]; limit?: number },
): Promise<KnowledgePoolResult> {
  const params = new URLSearchParams();
  if (opts?.keys?.length) params.set("keys", opts.keys.join(","));
  if (opts?.limit != null) params.set("limit", String(opts.limit));
  const qs = params.toString();
  return api(`/knowledge/pool${qs ? `?${qs}` : ""}`, { token: accessToken });
}

/** URL OAuth démarrage (navigateur). */
export function cloudOAuthStartUrl(provider: "google" | "discord"): string {
  return `${getApiBase()}/auth/oauth/${provider}/start`;
}
