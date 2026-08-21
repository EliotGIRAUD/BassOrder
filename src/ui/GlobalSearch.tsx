import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { intlLocale, type AppLocale } from "../i18n";
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
import { usePrefs } from "./prefs";

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

export function GlobalSearch({ open, onClose, onNavigate }: Props) {
  const { t, i18n } = useTranslation("search");
  const { t: tc } = useTranslation("common");
  const { prefs } = usePrefs();
  const locale = intlLocale(prefs.locale);
  const [query, setQuery] = useState("");
  const [index, setIndex] = useState(0);
  const [artists, setArtists] = useState<{ name: string; genre: string }[]>([]);
  const [genres, setGenres] = useState<string[]>([]);
  const [indexing, setIndexing] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const navItems = useMemo(
    () => [
      {
        view: "home" as const,
        title: t("navHomeTitle"),
        subtitle: t("navHomeSubtitle"),
        keywords: "home démarrer",
      },
      {
        view: "local" as const,
        title: t("navLocalTitle"),
        subtitle: t("navLocalSubtitle"),
        keywords: "local dossier mp3 bibliothèque",
      },
      {
        view: "localHistory" as const,
        title: t("navLocalHistoryTitle"),
        subtitle: t("navLocalHistorySubtitle"),
        keywords: "historique analyses",
      },
      {
        view: "spotify" as const,
        title: t("navSpotifyTitle"),
        subtitle: t("navSpotifySubtitle"),
        keywords: "cloud likes import",
      },
      {
        view: "spotifyHistory" as const,
        title: t("navSpotifyHistoryTitle"),
        subtitle: t("navSpotifyHistorySubtitle"),
        keywords: "historique imports",
      },
      {
        view: "knowledge" as const,
        title: t("navKnowledgeTitle"),
        subtitle: t("navKnowledgeSubtitle"),
        keywords: "savoir base artistes genres",
      },
      {
        view: "profile" as const,
        title: t("navProfileTitle"),
        subtitle: t("navProfileSubtitle"),
        keywords: "compte utilisateur session pseudo avatar",
      },
      {
        view: "account" as const,
        title: t("navAccountTitle"),
        subtitle: t("navAccountSubtitle"),
        keywords: "cloud login oauth favoris sync sécurité pin",
      },
    ],
    [t, i18n.language],
  );

  useEffect(() => {
    if (!open) {
      return;
    }
    setQuery("");
    setIndex(0);
    setIndexing(true);
    window.setTimeout(() => inputRef.current?.focus(), 20);
    const noGenre = t("noGenre");
    void fetchKnowledgeDump()
      .then((dump) => {
        const rows = Object.values(dump.artists).map((artist) => ({
          name: artist.name,
          genre: [artist.parent, artist.sub].filter(Boolean).join(" · ") || noGenre,
        }));
        setArtists(rows);
        const genreSet = new Set<string>();
        for (const row of rows) {
          if (row.genre && row.genre !== noGenre) {
            genreSet.add(row.genre);
          }
        }
        setGenres([...genreSet].sort((a, b) => a.localeCompare(b, locale)));
      })
      .catch(() => {
        setArtists([]);
        setGenres([]);
      })
      .finally(() => setIndexing(false));
  }, [open, t, locale]);

  const hits = useMemo(() => {
    const q = query.trim().toLowerCase();
    const profiles = listProfiles();
    const imports = listImports();
    const libraries = listLibraries();
    const active = getActiveProfile();
    const out: SearchHit[] = [];

    for (const item of navItems) {
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
            profile.id === active?.id ? t("profileActive") : null,
            profile.likedCount
              ? t("profileLikes", { count: profile.likedCount })
              : null,
            t("profileSessions"),
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
          title: t("importTitle", { name: item.profileName }),
          subtitle: t("importSubtitle", {
            likes: item.likedCount,
            genres: item.groupCount,
            when: formatWhen(item.savedAt, prefs.locale),
          }),
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
          subtitle: t("librarySubtitle", {
            tracks: lib.fileCount,
            percent: lib.sortedPercent,
            when: formatWhen(lib.savedAt, prefs.locale),
          }),
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
            subtitle: t("genreSubtitle", {
              profile: active?.name ?? t("activeProfileFallback"),
            }),
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
  }, [query, artists, genres, onNavigate, navItems, t, prefs.locale]);

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

  function kindLabel(kind: SearchHit["kind"]): string {
    switch (kind) {
      case "nav":
        return t("kindPage");
      case "profile":
        return t("kindProfile");
      case "import":
        return t("kindImport");
      case "library":
        return t("kindLibrary");
      case "artist":
        return t("kindArtist");
      case "genre":
        return t("kindGenre");
    }
  }

  return (
    <div className="global-search" role="dialog" aria-modal="true" aria-label={t("dialogAria")}>
      <button type="button" className="global-search-backdrop" onClick={onClose} aria-label={tc("close")} />
      <div className="global-search-panel">
        <header className="global-search-head">
          <input
            ref={inputRef}
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("placeholder")}
            aria-label={t("inputAria")}
          />
          <kbd>Esc</kbd>
        </header>
        <p className="global-search-hint">
          {indexing ? t("indexing") : t("hint")}
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
          <p className="global-search-empty">{t("empty", { query })}</p>
        )}
      </div>
    </div>
  );
}

function shortPath(path: string): string {
  const parts = path.replace(/[/\\]+$/, "").split(/[/\\]/);
  return parts.slice(-2).join(" / ") || path;
}

function formatWhen(ts: number, locale: AppLocale): string {
  try {
    return new Intl.DateTimeFormat(intlLocale(locale), {
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
