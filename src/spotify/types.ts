export type KnowledgeGroup = {
  genre: string;
  folder: string;
  artistCount: number;
  likes: number;
  artists: string[];
};

export type KnowledgeStatus = {
  syncedAt: string | null;
  displayName: string | null;
  likedCount: number;
  artistCount: number;
  classifiedArtists: number;
  groups: KnowledgeGroup[];
};

export type SpotifyStatus = {
  connected: boolean;
  /** Tokens encore en DB (chiffrés) même si la session n’est pas lisible. */
  hasStoredAuth?: boolean;
  clientId: string | null;
  avatarUrl?: string | null;
  knowledge: KnowledgeStatus;
};

export type SpotifySyncProgress = {
  phase: string;
  done: number;
  total: number;
  label: string;
};
