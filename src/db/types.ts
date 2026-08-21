export type DbChanged = {
  entity: string;
  action: string;
  id: string | null;
};

export type DbUser = {
  id: string;
  name: string;
  color: string;
  avatarUrl?: string | null;
  createdAt: number;
  lastUsedAt: number;
};

export type DbSpotifyProfile = {
  id: string;
  userId: string;
  name: string;
  clientId: string;
  createdAt: number;
  lastUsedAt: number;
  displayName: string | null;
  avatarUrl: string | null;
  lastSyncedAt: number | null;
  likedCount: number;
  artistCount: number;
  groupCount: number;
  isActive: boolean;
};

export type DbGenrePeek = {
  genre: string;
  folder: string;
  count: number;
};

export type DbDetectionEvent = {
  at: number;
  percent: number;
  delta: number;
  reason: string;
};

export type DbLibraryScan = {
  id: string;
  userId: string;
  root: string;
  savedAt: number;
  selectedFolder: string | null;
  mode: string;
  fileCount: number;
  unreadCount: number;
  unknownCount: number;
  lookedUpCount: number;
  sortedPercent: number;
  groupCount: number;
  folderCount: number;
  durationSecs: number;
  topGenres: DbGenrePeek[];
  detectionLog: DbDetectionEvent[];
  isActive: boolean;
};

export type DbTrack = {
  path: string;
  fileName: string;
  title: string | null;
  artist: string | null;
  album: string | null;
  year: string | null;
  genre: string;
  folder: string;
  durationSecs: number | null;
  bpm: number | null;
  musicalKey: string | null;
  bitrateKbps: number | null;
};

export type DbGenreGroup = {
  genre: string;
  folder: string;
  tracks: DbTrack[];
};

export type DbScanResult = {
  root: string;
  fileCount: number;
  unreadCount: number;
  unknownCount: number;
  lookedUpCount: number;
  sortedPercent: number;
  groups: DbGenreGroup[];
};

export type DbSaveScanPayload = {
  scan: DbLibraryScan;
  result: DbScanResult;
};

export type DbImportGenrePeek = {
  genre: string;
  folder: string;
  artistCount: number;
  likes: number;
};

export type DbSpotifyImport = {
  id: string;
  userId: string;
  profileId: string;
  profileName: string;
  displayName: string | null;
  avatarUrl: string | null;
  savedAt: number;
  syncedAt: string | null;
  likedCount: number;
  artistCount: number;
  classifiedArtists: number;
  groupCount: number;
  topGenres: DbImportGenrePeek[];
  isActive: boolean;
};

export type LegacyFrontendPayload = {
  users: DbUser[];
  sessionUserId: string | null;
  prefsByUser: Record<string, unknown>;
  profilesByUser: Record<
    string,
    { activeId: string | null; profiles: DbSpotifyProfile[] }
  >;
  librariesByUser: Record<
    string,
    { activeId: string | null; scans: DbSaveScanPayload[] }
  >;
  importsByUser: Record<
    string,
    { activeId: string | null; imports: DbSpotifyImport[] }
  >;
};

export type MigrateResult = {
  migrated: boolean;
  diskImported: boolean;
};
