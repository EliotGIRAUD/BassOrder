import { useEffect, useMemo, useRef, useState } from "react";
import { listLibraries } from "../local/libraryCache";
import { setActiveImport, listImports } from "../spotify/importCache";
import { activateSpotifyProfile } from "../spotify/api";
import {
  getActiveProfile,
  listProfiles,
  selectProfile,
} from "../spotify/profiles";
import {
  notifyProfilesChanged,
  requestOpenImport,
  requestOpenProfile,
} from "../spotify/profileEvents";
import { requestOpenAnalysis } from "../local/historyEvents";
import { fetchKnowledgeDump } from "../knowledge/api";
import { SearchHitsSkeleton } from "./skeleton";

export type AppView =
  | "home"
  | "spotify"
  | "spotifyHistory"
  | "local"
  | "localHistory"
  | "knowledge"
  | "profile"
  | "account";

type SearchHit = {
  id: string;
  kind: "nav" | "profile" | "import" | "library" | "artist" | "genre";
  title: string;
  subtitle: string;
  run: () => void | Promise<void>;
};

type Props = {
  open: boolean;
  onClose: () => void;
  onNavigate: (view: AppView) => void;
};

const NAV_ITEMS: { view: AppView; title: string; subtitle: string; keywords: string }[] = [
  {
    view: "home",
    title: "Accueil",
    subtitle: "Vue d’ensemble BassOrder",
    keywords: "home démarrer",
  },
  {
    view: "local",
    title: "Mes fichiers",
    subtitle: "Analyser et classer la musique sur ton PC",
    keywords: "local dossier mp3 bibliothèque",
  },
  {
    view: "localHistory",
    title: "Historique local",
    subtitle: "Analyses de dossiers déjà faites",
    keywords: "historique analyses",
  },
  {
    view: "spotify",
    title: "Spotify",
    subtitle: "Importer les likes d’un profil",
    keywords: "cloud likes import",
  },
  {
    view: "spotifyHistory",
    title: "Historique Spotify",
    subtitle: "Imports mémorisés par profil",
    keywords: "historique imports",
  },
  {
    view: "knowledge",
    title: "Dictionnaire",
    subtitle: "Artistes et genres du profil actif",
    keywords: "savoir base artistes genres",
  },
  {
    view: "profile",
    title: "Profil",
    subtitle: "Pseudo, couleur et espace perso",
    keywords: "compte utilisateur session pseudo avatar",
  },
  {
    view: "account",
    title: "Compte",
    subtitle: "Login local & cloud, favoris, sync",
    keywords: "cloud login oauth favoris sync sécurité pin",
  },
];

export function GlobalSearch({ open, onClose, onNavigate }: Props) {
  const [query, setQuery] = useState("");
  const [index, setIndex] = useState(0);
  const [artists, setArtists] = useState<{ name: string; genre: string }[]>([]);
  const [genres, setGenres] = useState<string[]>([]);
  const [indexing, setIndexing] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) {
      return;
    }
    setQuery("");
    setIndex(0);
    setIndexing(true);
    window.setTimeout(() => inputRef.current?.focus(), 20);
    void fetchKnowledgeDump()
      .then((dump) => {
        const rows = Object.values(dump.artists).map((artist) => ({
          name: artist.name,
          genre: [artist.parent, artist.sub].filter(Boolean).join(" · ") || "Sans genre",
        }));
        setArtists(rows);
        const genreSet = new Set<string>();
        for (const row of rows) {
          if (row.genre && row.genre !== "Sans genre") {
            genreSet.add(row.genre);
          }
        }
        setGenres([...genreSet].sort((a, b) => a.localeCompare(b, "fr")));
      })
      .catch(() => {
        setArtists([]);
        setGenres([]);
      })
      .finally(() => setIndexing(false));
  }, [open]);

  const hits = useMemo(() => {
    const q = query.trim().toLowerCase();
    const profiles = listProfiles();
    const imports = listImports();
    const libraries = listLibraries();
    const active = getActiveProfile();
    const out: SearchHit[] = [];

    for (const item of NAV_ITEMS) {
      if (
        !q ||
        item.title.toLowerCase().includes(q) ||
        item.subtitle.toLowerCase().includes(q) ||
        item.keywords.includes(q)
      ) {
        out.push({
          id: `nav-${item.view}`,
          kind: "nav",
          title: item.title,
          subtitle: item.subtitle,
          run: () => onNavigate(item.view),
        });
      }
    }

    for (const profile of profiles) {
      const hay = `${profile.name} ${profile.displayName ?? ""} ${profile.clientId}`.toLowerCase();
      if (!q || hay.includes(q)) {
        out.push({
          id: `profile-${profile.id}`,
          kind: "profile",
          title: profile.name,
          subtitle: [
            profile.displayName,
            profile.id === active?.id ? "actif" : null,
            profile.likedCount ? `${profile.likedCount} likes` : null,
            "session & dictionnaire séparés",
          ]
            .filter(Boolean)
            .join(" · "),
          run: async () => {
            selectProfile(profile.id);
            await activateSpotifyProfile(profile.id);
            notifyProfilesChanged();
            requestOpenProfile(profile);
            onNavigate("spotify");
          },
        });
      }
    }

    for (const item of imports) {
      const hay = `${item.profileName} ${item.displayName ?? ""}`.toLowerCase();
      if (!q || hay.includes(q)) {
        out.push({
          id: `import-${item.id}`,
          kind: "import",
          title: `Import · ${item.profileName}`,
          subtitle: `${item.likedCount} likes · ${item.groupCount} genres · ${formatWhen(item.savedAt)}`,
          run: async () => {
            const profile = selectProfile(item.profileId);
            await activateSpotifyProfile(item.profileId);
            notifyProfilesChanged();
            if (profile) {
              requestOpenProfile(profile);
            }
            setActiveImport(item.id);
            requestOpenImport(item);
            onNavigate("spotifyHistory");
          },
        });
      }
    }

    for (const lib of libraries) {
      const hay = `${lib.root} ${lib.topGenres.map((g) => g.genre).join(" ")}`.toLowerCase();
      if (!q || hay.includes(q)) {
        out.push({
          id: `lib-${lib.id}`,
          kind: "library",
          title: shortPath(lib.root),
          subtitle: `${lib.fileCount} titres · ${lib.sortedPercent}% classés · ${formatWhen(lib.savedAt)}`,
          run: () => {
            requestOpenAnalysis(lib);
            onNavigate("local");
          },
        });
      }
    }

    if (q.length >= 2) {
      for (const genre of genres) {
        if (genre.toLowerCase().includes(q)) {
          out.push({
            id: `genre-${genre}`,
            kind: "genre",
            title: genre,
            subtitle: `Genre du dictionnaire (${active?.name ?? "profil actif"})`,
            run: () => onNavigate("knowledge"),
          });
        }
      }
      let artistHits = 0;
      for (const artist of artists) {
        if (!artist.name.toLowerCase().includes(q)) {
          continue;
        }
        out.push({
          id: `artist-${artist.name}`,
          kind: "artist",
          title: artist.name,
          subtitle: artist.genre,
          run: () => onNavigate("knowledge"),
        });
        artistHits += 1;
        if (artistHits >= 12) {
          break;
        }
      }
    }

    return out.slice(0, 40);
  }, [query, artists, genres, onNavigate]);

  useEffect(() => {
    setIndex(0);
  }, [query]);

  useEffect(() => {
    if (!open) {
      return;
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key === "ArrowDown") {
        event.preventDefault();
        setIndex((value) => Math.min(value + 1, Math.max(0, hits.length - 1)));
        return;
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        setIndex((value) => Math.max(value - 1, 0));
        return;
      }
      if (event.key === "Enter") {
        const hit = hits[index];
        if (!hit) {
          return;
        }
        event.preventDefault();
        void Promise.resolve(hit.run()).finally(onClose);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, hits, index, onClose]);

  if (!open) {
    return null;
  }

  return (
    <div className="global-search" role="dialog" aria-modal="true" aria-label="Recherche BassOrder">
      <button type="button" className="global-search-backdrop" onClick={onClose} aria-label="Fermer" />
      <div className="global-search-panel">
        <header className="global-search-head">
          <input
            ref={inputRef}
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Rechercher un profil, artiste, dossier, page…"
            aria-label="Recherche"
          />
          <kbd>Esc</kbd>
        </header>
        <p className="global-search-hint">
          {indexing
            ? "Indexation du dictionnaire…"
            : "Profils Spotify séparés · dictionnaire du profil actif · Ctrl+K pour rouvrir"}
        </p>
        {hits.length > 0 && (
          <ul className="global-search-list" role="listbox">
            {hits.map((hit, i) => (
              <li key={hit.id}>
                <button
                  type="button"
                  className={i === index ? "is-active" : undefined}
                  onMouseEnter={() => setIndex(i)}
                  onClick={() => {
                    void Promise.resolve(hit.run()).finally(onClose);
                  }}
                >
                  <span className="global-search-kind">{kindLabel(hit.kind)}</span>
                  <span className="global-search-copy">
                    <strong>{hit.title}</strong>
                    <em>{hit.subtitle}</em>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
        {indexing && <SearchHitsSkeleton rows={query.trim().length >= 2 ? 5 : 3} />}
        {!indexing && hits.length === 0 && (
          <p className="global-search-empty">Aucun résultat pour « {query} ».</p>
        )}
      </div>
    </div>
  );
}

function kindLabel(kind: SearchHit["kind"]): string {
  switch (kind) {
    case "nav":
      return "Page";
    case "profile":
      return "Profil";
    case "import":
      return "Import";
    case "library":
      return "Dossier";
    case "artist":
      return "Artiste";
    case "genre":
      return "Genre";
  }
}

function shortPath(path: string): string {
  const parts = path.replace(/[/\\]+$/, "").split(/[/\\]/);
  return parts.slice(-2).join(" / ") || path;
}

function formatWhen(ts: number): string {
  try {
    return new Intl.DateTimeFormat("fr-FR", {
      day: "numeric",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(ts));
  } catch {
    return "";
  }
}

/** Raccourci global Ctrl/Cmd+K — à brancher dans App. */
export function useGlobalSearchHotkey(onOpen: () => void): void {
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      const key = event.key.toLowerCase();
      if ((event.ctrlKey || event.metaKey) && key === "k") {
        event.preventDefault();
        onOpen();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onOpen]);
}
