export type OrganizeMode = "copy" | "move";

/** Comment renommer les fichiers à l’écriture sur le disque. */
export type RenameMode = "keep" | "title" | "artistTitle";

export type Track = {
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
  musicalKey?: string | null;
  bitrateKbps: number | null;
};

export type GenreGroup = {
  genre: string;
  folder: string;
  tracks: Track[];
};

export type ScanResult = {
  root: string;
  fileCount: number;
  unreadCount: number;
  unknownCount: number;
  lookedUpCount: number;
  sortedPercent: number;
  groups: GenreGroup[];
};

export type LookupProgress = {
  done: number;
  total: number;
  artist: string;
};

export type ScanProgress = {
  phase: string;
  done: number;
  total: number;
  label: string;
  fileName: string | null;
};

export type OrganizeResult = {
  copied: number;
  moved: number;
  skipped: number;
  errors: string[];
  destination: string;
};
