/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SPOTIFY_CLIENT_ID?: string;
  readonly VITE_BASSORDER_API?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
