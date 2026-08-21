import type { GenreGroup, Track } from "./types";
import { DUPLICATE_GENRE } from "./duplicateFlags";

export type FolderSuggestion = {
  folder: string;
  genre: string;
  reason: string;
};

/** Aligné sur `genre_taxonomy.rs` KEYWORD_RULES (libellés + nesting). */
const KEYWORDS: Array<{ re: RegExp; folder: string; reason: string }> = [
  { re: /phonk/i, folder: "Hip-Hop\\Phonk", reason: "mot-clé phonk" },
  { re: /\bdrill\b/i, folder: "Hip-Hop\\Drill", reason: "mot-clé drill" },
  { re: /\brage\b|playboi carti|yeat\b/i, folder: "Hip-Hop\\Rage", reason: "indice rage" },
  { re: /\btrap\b/i, folder: "Hip-Hop\\Trap", reason: "mot-clé trap" },
  {
    re: /vald|ninho|damso|booba|niska|orelsan|nekfeu|\bpnl\b|\bjul\b|capitaine roshi|2zer/i,
    folder: "Hip-Hop\\Rap FR",
    reason: "artiste rap FR",
  },
  { re: /\brap\b|hip[-\s]?hop/i, folder: "Hip-Hop\\Rap", reason: "indice rap" },
  { re: /hard bass|hardbass|russian|pumping/i, folder: "Électronique\\Hard Bass", reason: "titre bass" },
  { re: /bassline/i, folder: "Électronique\\Bassline", reason: "mot-clé bassline" },
  {
    re: /drum[-\s]?(&|and|n)[-\s]?bass|\bdnb\b|\bd\s*&\s*b\b|neurofunk|liquid funk|jungle/i,
    folder: "Électronique\\Drum and Bass",
    reason: "indice D&B",
  },
  { re: /tech[-\s]?house/i, folder: "Électronique\\Tech House", reason: "mot-clé tech house" },
  { re: /deep[-\s]?house/i, folder: "Électronique\\Deep House", reason: "mot-clé deep house" },
  { re: /bass[-\s]?house|ac slater/i, folder: "Électronique\\Bass House", reason: "indice bass house" },
  { re: /\bhouse\b/i, folder: "Électronique\\House", reason: "mot-clé house" },
  { re: /frenchcore/i, folder: "Électronique\\Frenchcore", reason: "mot-clé frenchcore" },
  { re: /hardstyle/i, folder: "Électronique\\Hardstyle", reason: "mot-clé hardstyle" },
  { re: /\bgabber\b|hardcore/i, folder: "Électronique\\Hardcore", reason: "indice hardcore" },
  { re: /die atzen|hands[-\s]?up|scooter/i, folder: "Électronique\\Hands Up", reason: "artiste / style" },
  { re: /\bacid\b/i, folder: "Électronique\\Acid", reason: "mot-clé acid" },
  { re: /techno/i, folder: "Électronique\\Techno", reason: "indice techno" },
  { re: /dubstep|riddim/i, folder: "Électronique\\Dubstep", reason: "mot-clé dubstep" },
  { re: /psytrance|psy[-\s]?trance/i, folder: "Électronique\\Psytrance", reason: "mot-clé psytrance" },
  { re: /\btrance\b|\bpsy\b/i, folder: "Électronique\\Trance", reason: "indice trance" },
  { re: /amapiano|afro[-\s]?house/i, folder: "Électronique\\Amapiano", reason: "indice afro house" },
  { re: /jazz|swing|bossa/i, folder: "Jazz\\Jazz", reason: "mot-clé jazz" },
  { re: /reggae|dancehall/i, folder: "Reggae\\Reggae", reason: "mot-clé reggae" },
  { re: /afrobeats|burna boy|wizkid/i, folder: "Afro\\Afrobeats", reason: "indice afro" },
  { re: /reggaeton|bad bunny/i, folder: "Latin\\Reggaeton", reason: "indice latin" },
  { re: /metalcore/i, folder: "Rock\\Metalcore", reason: "mot-clé metalcore" },
  { re: /\bmetal\b/i, folder: "Rock\\Metal", reason: "mot-clé metal" },
  { re: /\bpunk\b/i, folder: "Rock\\Punk", reason: "mot-clé punk" },
  { re: /\bindie\b/i, folder: "Rock\\Indie", reason: "mot-clé indie" },
  { re: /\brock\b/i, folder: "Rock\\Rock", reason: "indice rock" },
  { re: /\bsoul\b/i, folder: "Soul\\Soul", reason: "mot-clé soul" },
  { re: /\bfunk\b/i, folder: "Funk\\Funk", reason: "mot-clé funk" },
  { re: /k-?pop/i, folder: "Pop\\K-Pop", reason: "mot-clé K-pop" },
  { re: /\bpop\b/i, folder: "Pop\\Pop", reason: "mot-clé pop" },
];

function haystack(track: Track): string {
  return [track.title, track.fileName, track.artist, track.album]
    .filter(Boolean)
    .join(" ");
}

function folderKey(folder: string): string {
  return folder.replace(/\//g, "\\").toLowerCase();
}

/** Match exact du chemin, ou du couple parent\sous-genre — pas de endsWith large. */
function matchExisting(folders: GenreGroup[], wanted: string): GenreGroup | undefined {
  const needle = folderKey(wanted);
  const exact = folders.find((g) => folderKey(g.folder) === needle);
  if (exact) {
    return exact;
  }

  const wantedGenre = wanted.replace(/\\/g, " · ").toLowerCase();
  const byGenre = folders.find((g) => g.genre.toLowerCase() === wantedGenre);
  if (byGenre) {
    return byGenre;
  }

  // Alias DnB historiques (anciens dossiers « Drum & Bass »)
  if (needle.endsWith("\\drum and bass")) {
    const alt = needle.replace(/\\drum and bass$/, "\\drum & bass");
    return folders.find((g) => folderKey(g.folder) === alt);
  }

  return undefined;
}

function bpmFolder(bpm: number): string | null {
  // Plages disjointes pour éviter House/Techno ambigu (128–132).
  if (bpm >= 160 && bpm <= 190) {
    return "Électronique\\Drum and Bass";
  }
  if (bpm >= 118 && bpm <= 127) {
    return "Électronique\\House";
  }
  if (bpm >= 128 && bpm <= 148) {
    return "Électronique\\Techno";
  }
  return null;
}

export function suggestFolder(
  track: Track,
  folders: GenreGroup[],
): FolderSuggestion | null {
  const usable = folders.filter(
    (g) =>
      g.genre !== "Sans genre" &&
      g.genre !== "Illisible" &&
      g.genre !== DUPLICATE_GENRE,
  );
  const text = haystack(track);

  for (const rule of KEYWORDS) {
    if (!rule.re.test(text)) {
      continue;
    }
    const existing = matchExisting(usable, rule.folder);
    return {
      folder: existing?.folder ?? rule.folder,
      genre: existing?.genre ?? rule.folder.replace(/\\/g, " · "),
      reason: rule.reason,
    };
  }

  if (track.bpm != null) {
    const byBpm = bpmFolder(track.bpm);
    if (byBpm) {
      const existing = matchExisting(usable, byBpm);
      return {
        folder: existing?.folder ?? byBpm,
        genre: existing?.genre ?? byBpm.replace(/\\/g, " · "),
        reason: `${track.bpm} BPM`,
      };
    }
  }

  const lower = text.toLowerCase();
  const hit = usable.find((g) => {
    const bits = g.folder
      .split(/[/\\]/)
      .map((p) => p.trim())
      .filter((p) => p.length > 3);
    // Segment entier seulement (évite « House » ⊂ « Deep House » via includes flou)
    return bits.some((bit) => {
      const b = bit.toLowerCase();
      return (
        lower === b ||
        lower.includes(` ${b} `) ||
        lower.startsWith(`${b} `) ||
        lower.endsWith(` ${b}`) ||
        lower.includes(`(${b}`) ||
        lower.includes(`[${b}`)
      );
    });
  });
  if (hit) {
    return {
      folder: hit.folder,
      genre: hit.genre,
      reason: `proche de ${hit.folder}`,
    };
  }

  // Pas de fallback sur le dossier le plus fourni (souvent incohérent).
  return null;
}

export function scanAdvice(
  fileCount: number,
  usefulPercent: number,
  unknownCount: number,
  lossCount = 0,
): {
  title: string;
  body: string;
} {
  if (fileCount === 0) {
    return {
      title: "Aucun titre audio",
      body: "Ce dossier ne contient pas de fichiers musicaux reconnus. Choisis un autre dossier.",
    };
  }
  if (unknownCount > 0) {
    return {
      title: `${usefulPercent}% classés utiles · ${unknownCount} sans genre`,
      body: `Il reste ${unknownCount} titre${unknownCount > 1 ? "s" : ""} sans genre (inconnus). ${
        lossCount > 0
          ? "La « perte » (doublons / parasites / 3:00) n’est pas du classement réussi — "
          : ""
      }utilise la détection auto ou le classement manuel pour les ${unknownCount} restants.`,
    };
  }
  if (usefulPercent >= 85) {
    return {
      title: "Prêt à classer sur le disque",
      body: `${usefulPercent}% des titres ont un vrai genre. Tu peux importer (copie ou déplacement)${
        lossCount > 0 ? " — la perte reste exclue si tu l’as cochée" : ""
      }.`,
    };
  }
  if (usefulPercent < 25) {
    return {
      title: `${fileCount} titres trouvés · ${usefulPercent}% classés`,
      body: "Peu d’infos dans les fichiers. Clique sur « Deviner les genres automatiquement », puis range le reste à la main si besoin.",
    };
  }
  return {
    title: `${usefulPercent}% des titres classés`,
    body: "Continue la détection ou importe ce qui est déjà prêt — l’objectif conseillé est 85 % de vrais genres.",
  };
}
