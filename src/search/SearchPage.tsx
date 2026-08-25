import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { intlLocale, type AppLocale } from "../i18n";
import { listLibraries } from "../local/libraryCache";
import { requestOpenAnalysis } from "../local/historyEvents";
import { fetchKnowledgeDump } from "../knowledge/api";
import { listImports, setActiveImport } from "../spotify/importCache";
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
import { SearchHitsSkeleton } from "../ui/skeleton";
import { usePrefs } from "../ui/prefs";
import { ScrambleText } from "../ui/motion";
import {
  requestOpenArtist,
  requestOpenGenre,
  subscribeFocusSearch,
  type SearchKind,
} from "./searchEvents";

export type AppView =
  | "home"
  | "spotify"
  | "spotifyHistory"
  | "local"
  | "localHistory"
  | "knowledge"
  | "space"
  | "search";

type FilterId = "all" | "nav" | "artist" | "genre" | "library" | "spotify";

type SearchHit = {
  id: string;
  kind: SearchKind;
  title: string;
  subtitle: string;
  run: () => void | Promise<void>;
};

type Props = {
  active?: boolean;
  onNavigate: (view: AppView) => void;
};

const RECENT_KEY = "bassorder.search.recent.v1";
const ARTIST_CAP = 48;

function readRecents(): string[] {
  try {
    const raw = localStorage.getItem(RECENT_KEY);
    if (!raw) {
      return [];
    }
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed.filter((item): item is string => typeof item === "string").slice(0, 8);
  } catch {
    return [];
  }
}

function writeRecents(items: string[]): void {
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(items.slice(0, 8)));
  } catch {
    /* quota */
  }
}

function rememberQuery(query: string): void {
  const q = query.trim();
  if (q.length < 2) {
    return;
  }
  writeRecents([q, ...readRecents().filter((item) => item.toLowerCase() !== q.toLowerCase())]);
}

function kindGroup(kind: SearchKind): FilterId {
  if (kind === "profile" || kind === "import") {
    return "spotify";
  }
  if (kind === "nav") {
    return "nav";
  }
  if (kind === "library") {
    return "library";
  }
  if (kind === "artist") {
    return "artist";
  }
  return "genre";
}

export function SearchPage({ active = true, onNavigate }: Props) {
  const { t, i18n } = useTranslation("search");
  const { prefs } = usePrefs();
  const locale = intlLocale(prefs.locale);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<FilterId>("all");
  const [index, setIndex] = useState(0);
  const [artists, setArtists] = useState<{ name: string; genre: string }[]>([]);
  const [genres, setGenres] = useState<string[]>([]);
  const [indexing, setIndexing] = useState(true);
  const [recents, setRecents] = useState(readRecents);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!active) {
      return;
    }
    window.setTimeout(() => inputRef.current?.focus(), 40);
  }, [active]);

  useEffect(() => subscribeFocusSearch(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }), []);

  useEffect(() => {
    const noGenre = t("noGenre");
    setIndexing(true);
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
  }, [t, locale]);

  const navItems = useMemo(
    () => [
      {
        view: "home" as const,
        title: t("navHomeTitle"),
        subtitle: t("navHomeSubtitle"),
        keywords: "home démarrer accueil",
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
        view: "space" as const,
        title: t("navSpaceTitle"),
        subtitle: t("navSpaceSubtitle"),
        keywords: "compte profil utilisateur session pseudo avatar cloud login oauth pin sécurité espace",
      },
    ],
    [t, i18n.language],
  );

  const allHits = useMemo(() => {
    const q = query.trim().toLowerCase();
    const profiles = listProfiles();
    const imports = listImports();
    const libraries = listLibraries();
    const activeProfile = getActiveProfile();
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
      const hay = `${profile.name} ${profile.displayName ?? ""}`.toLowerCase();
      if (!q || hay.includes(q)) {
        out.push({
          id: `profile-${profile.id}`,
          kind: "profile",
          title: profile.displayName || profile.name,
          subtitle: [
            profile.name !== profile.displayName ? profile.name : null,
            profile.id === activeProfile?.id ? t("profileActive") : null,
            profile.likedCount ? t("profileLikes", { count: profile.likedCount }) : null,
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
              profile: activeProfile?.displayName || activeProfile?.name || t("activeProfileFallback"),
            }),
            run: () => {
              requestOpenGenre(genre);
              onNavigate("knowledge");
            },
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
          run: () => {
            requestOpenArtist(artist.name);
            onNavigate("knowledge");
          },
        });
        artistHits += 1;
        if (artistHits >= ARTIST_CAP) {
          break;
        }
      }
    }

    return out;
  }, [query, artists, genres, onNavigate, navItems, t, prefs.locale]);

  const hits = useMemo(() => {
    if (filter === "all") {
      return allHits;
    }
    return allHits.filter((hit) => kindGroup(hit.kind) === filter);
  }, [allHits, filter]);

  const grouped = useMemo(() => {
    const order: SearchKind[] = ["artist", "genre", "library", "profile", "import", "nav"];
    return order
      .map((kind) => ({
        kind,
        items: hits.filter((hit) => hit.kind === kind),
      }))
      .filter((group) => group.items.length > 0);
  }, [hits]);

  const counts = useMemo(() => {
    const tally: Record<FilterId, number> = {
      all: allHits.length,
      nav: 0,
      artist: 0,
      genre: 0,
      library: 0,
      spotify: 0,
    };
    for (const hit of allHits) {
      tally[kindGroup(hit.kind)] += 1;
    }
    return tally;
  }, [allHits]);

  useEffect(() => {
    setIndex(0);
  }, [query, filter]);

  useEffect(() => {
    if (!active) {
      return;
    }
    function onKey(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      if (target && ["INPUT", "TEXTAREA"].includes(target.tagName) && event.key === "ArrowDown" && index === 0) {
        /* keep going */
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
        rememberQuery(query);
        setRecents(readRecents());
        void Promise.resolve(hit.run());
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active, hits, index, query]);

  const browsing = query.trim().length === 0;
  const filters: { id: FilterId; label: string }[] = [
    { id: "all", label: t("filterAll") },
    { id: "artist", label: t("kindArtist") },
    { id: "genre", label: t("kindGenre") },
    { id: "library", label: t("kindLibrary") },
    { id: "spotify", label: t("filterSpotify") },
    { id: "nav", label: t("kindPage") },
  ];

  function runHit(hit: SearchHit) {
    rememberQuery(query);
    setRecents(readRecents());
    void Promise.resolve(hit.run());
  }

  function kindLabel(kind: SearchKind): string {
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

  let runningIndex = -1;

  return (
    <section className="local-stage search-page" data-module="search">
      <header className="local-topbar">
        <div className="local-topbar-copy">
          <p className="eyebrow">{t("pageEyebrow")}</p>
          <h2>
            <ScrambleText text={t("pageTitle")} />
          </h2>
          <p className="local-lede">{t("pageLede")}</p>
        </div>
      </header>

      <div className="search-page-bar">
        <input
          ref={inputRef}
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t("placeholder")}
          aria-label={t("inputAria")}
        />
        <kbd>Ctrl+K</kbd>
      </div>

      <div className="search-page-filters" role="tablist" aria-label={t("filtersAria")}>
        {filters.map((item) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={filter === item.id}
            className={filter === item.id ? "is-on" : undefined}
            onClick={() => setFilter(item.id)}
          >
            {item.label}
            {!browsing || item.id === "all" ? (
              <em>{item.id === "all" ? (browsing ? artists.length : counts.all) : counts[item.id]}</em>
            ) : null}
          </button>
        ))}
      </div>

      <p className="search-page-meta">
        {indexing
          ? t("indexing")
          : t("indexed", { artists: artists.length, genres: genres.length })}
      </p>

      {browsing && (
        <div className="search-page-browse">
          {recents.length > 0 && (
            <section>
              <h3>{t("recentTitle")}</h3>
              <div className="search-page-chips">
                {recents.map((item) => (
                  <button
                    key={item}
                    type="button"
                    onClick={() => {
                      setQuery(item);
                      setFilter("all");
                    }}
                  >
                    {item}
                  </button>
                ))}
              </div>
            </section>
          )}
          <section>
            <h3>{t("jumpTitle")}</h3>
            <div className="search-page-jumps">
              {navItems.map((item) => (
                <button
                  key={item.view}
                  type="button"
                  className="search-page-jump"
                  onClick={() => onNavigate(item.view)}
                >
                  <strong>{item.title}</strong>
                  <span>{item.subtitle}</span>
                </button>
              ))}
            </div>
          </section>
          {genres.length > 0 && (
            <section>
              <h3>{t("topGenresTitle")}</h3>
              <div className="search-page-chips">
                {genres.slice(0, 16).map((genre) => (
                  <button
                    key={genre}
                    type="button"
                    onClick={() => {
                      requestOpenGenre(genre);
                      onNavigate("knowledge");
                    }}
                  >
                    {genre}
                  </button>
                ))}
              </div>
            </section>
          )}
        </div>
      )}

      {!browsing && indexing && <SearchHitsSkeleton rows={6} />}

      {!browsing && !indexing && grouped.length === 0 && (
        <p className="search-page-empty">{t("empty", { query })}</p>
      )}

      {!browsing && grouped.length > 0 && (
        <div className="search-page-groups">
          {grouped.map((group) => (
            <section key={group.kind}>
              <h3>
                {kindLabel(group.kind)}
                <em>{group.items.length}</em>
              </h3>
              <ul className="search-page-list">
                {group.items.map((hit) => {
                  runningIndex += 1;
                  const current = runningIndex;
                  return (
                    <li key={hit.id}>
                      <button
                        type="button"
                        className={current === index ? "is-active" : undefined}
                        onMouseEnter={() => setIndex(current)}
                        onClick={() => runHit(hit)}
                      >
                        <span className="global-search-kind">{kindLabel(hit.kind)}</span>
                        <span className="global-search-copy">
                          <strong>{hit.title}</strong>
                          <em>{hit.subtitle}</em>
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </div>
      )}
    </section>
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
