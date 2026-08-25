/** Client ID de l’app Spotify BassOrder, injecté au build via `.env`. */

export function isValidSpotifyClientId(value: string): boolean {
  const id = value.trim();
  return id.length >= 16 && id.length <= 64 && /^[0-9a-fA-F]+$/.test(id);
}

export function readBundledClientId(): string {
  const raw = import.meta.env.VITE_SPOTIFY_CLIENT_ID ?? "";
  const id = String(raw)
    .trim()
    .replace(/^['"]|['"]$/g, "")
    .trim();
  return isValidSpotifyClientId(id) ? id : "";
}
