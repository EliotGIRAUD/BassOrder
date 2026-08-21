export type KnowledgeArtist = {
  name: string;
  spotifyId: string;
  likes: number;
  rawGenres: string[];
  parent: string;
  sub: string;
};

export type KnowledgeDump = {
  version: number;
  syncedAt: string | null;
  displayName: string | null;
  likedCount: number;
  artists: Record<string, KnowledgeArtist>;
};
