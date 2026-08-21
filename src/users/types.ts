export type AppUser = {
  id: string;
  name: string;
  /** Teinte avatar (hex). */
  color: string;
  /** Photo de profil optionnelle (ex. PP Spotify). */
  avatarUrl?: string | null;
  createdAt: number;
  lastUsedAt: number;
};

export type UserStore = {
  users: AppUser[];
};

/**
 * Palette pro (OLED) — tons matte, saturés juste assez.
 * Évite le néon flashy.
 */
export const USER_COLORS = [
  "#5EC4B0", // teal matte
  "#C4A484", // champagne
  "#7B93D4", // periwinkle
  "#D4897A", // terracotta soft
  "#9B8EC4", // dusty violet
  "#6FA88A", // sage
  "#C9A35A", // antique gold
  "#6A9BB8", // steel blue
] as const;

/** Snap une couleur legacy vers la palette actuelle. */
export function nearestUserColor(hex: string): string {
  const raw = hex.trim();
  if ((USER_COLORS as readonly string[]).includes(raw)) {
    return raw;
  }
  const rgb = parseHex(raw);
  if (!rgb) {
    return USER_COLORS[0];
  }
  let best: string = USER_COLORS[0];
  let bestDist = Infinity;
  for (const c of USER_COLORS) {
    const p = parseHex(c);
    if (!p) {
      continue;
    }
    const d =
      (rgb[0] - p[0]) ** 2 + (rgb[1] - p[1]) ** 2 + (rgb[2] - p[2]) ** 2;
    if (d < bestDist) {
      bestDist = d;
      best = c;
    }
  }
  return best;
}

function parseHex(hex: string): [number, number, number] | null {
  const h = hex.replace("#", "");
  if (h.length !== 3 && h.length !== 6) {
    return null;
  }
  const full =
    h.length === 3
      ? h
          .split("")
          .map((c) => c + c)
          .join("")
      : h;
  const n = Number.parseInt(full, 16);
  if (Number.isNaN(n)) {
    return null;
  }
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
