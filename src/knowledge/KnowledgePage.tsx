import { useEffect, useMemo, useState } from "react";
import { CountUp } from "../ui/motion";
import { OrbitField } from "../ui/fx";
import { PushFill } from "../ui/push";
import { KnowledgePageSkeleton } from "../ui/skeleton";
import { fetchKnowledgeDump, invalidateKnowledgeCache, isTauri } from "./api";
import type { KnowledgeArtist, KnowledgeDump } from "./types";
import {
  getActiveProfile,
  listProfiles,
  selectProfile,
  type SpotifyProfile,
} from "../spotify/profiles";
import { activateSpotifyProfile } from "../spotify/api";
import {
  notifyProfilesChanged,
  subscribeProfilesChange,
} from "../spotify/profileEvents";
import { TipPanel } from "../ui/AppTip";
import { useExperience } from "../ui/Experience";

type SortKey = "name" | "likes" | "sub";

type GenreSelection =
  | { kind: "all" }
  | { kind: "open" }
  | { kind: "parent"; parent: string }
  | { kind: "sub"; parent: string; sub: string };

type ArtistRow = { key: string; artist: KnowledgeArtist };

type SubNode = { sub: string; count: number; likes: number };
type ParentNode = {
  parent: string;
  count: number;
  likes: number;
  subs: SubNode[];
};

type Crumb = { label: string; onSelect?: () => void };

const SORT_OPTIONS: { key: SortKey; label: string }[] = [
  { key: "name", label: "Artiste" },
  { key: "likes", label: "Likes" },
  { key: "sub", label: "Sous-genre" },
];

const OPEN_LABEL = "À classer";

export function KnowledgePage({ onOpenSpotify }: { onOpenSpotify?: () => void }) {
  const tauri = isTauri();
  const fx = useExperience();
  const [data, setData] = useState<KnowledgeDump | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("likes");
  const [selection, setSelection] = useState<GenreSelection>({ kind: "all" });
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [guideOpen, setGuideOpen] = useState(true);
  const [treeBooted, setTreeBooted] = useState(false);
  const [listLimit, setListLimit] = useState(120);
  const [profiles, setProfiles] = useState<SpotifyProfile[]>(listProfiles);
  const [activeProfile, setActiveProfile] = useState(getActiveProfile);

  async function reload(force = false, announce = false) {
    setBusy(true);
    setError(null);
    try {
      if (force) {
        invalidateKnowledgeCache();
      }
      const next = await fetchKnowledgeDump(force);
      setData(next);
      setTreeBooted(false);
      if (announce) {
        const count = Object.keys(next.artists).length;
        fx.toast({
          kind: "ok",
          title: "Dictionnaire à jour",
          body:
            count === 0
              ? "Aucune entrée pour ce profil."
              : `${count} artiste${count > 1 ? "s" : ""} · profil actif.`,
        });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
      setData(null);
      if (announce) {
        fx.toast({
          kind: "warn",
          title: "Rafraîchissement impossible",
          body: message,
        });
      }
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    void reload();
  }, []);

  useEffect(() => {
    return subscribeProfilesChange(() => {
      setProfiles(listProfiles());
      setActiveProfile(getActiveProfile());
      invalidateKnowledgeCache();
      void reload(true);
    });
  }, []);

  async function onSwitchProfile(id: string) {
    const profile = selectProfile(id);
    if (!profile) {
      return;
    }
    setActiveProfile(profile);
    setProfiles(listProfiles());
    notifyProfilesChanged();
    setBusy(true);
    try {
      await activateSpotifyProfile(profile.id);
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  }

  const artists = useMemo(() => {
    if (!data) {
      return [] as ArtistRow[];
    }
    return Object.entries(data.artists).map(([key, artist]) => ({ key, artist }));
  }, [data]);

  const tree = useMemo(() => buildGenreTree(artists), [artists]);

  useEffect(() => {
    if (treeBooted || tree.length === 0) {
      return;
    }
    const initial = new Set(
      tree.filter((node) => node.subs.length > 1).map((node) => node.parent),
    );
    if (initial.size === 0 && tree[0]) {
      initial.add(tree[0].parent);
    }
    setExpanded(initial);
    setTreeBooted(true);
  }, [tree, treeBooted]);

  const openCount = useMemo(
    () => artists.filter(({ artist }) => !artist.parent.trim()).length,
    [artists],
  );

  const classified = artists.length - openCount;
  const coverage =
    artists.length > 0 ? Math.round((classified * 100) / artists.length) : 0;
  const subCount = useMemo(
    () => tree.reduce((sum, node) => sum + node.subs.length, 0),
    [tree],
  );

  const scoped = useMemo(
    () => artists.filter(({ artist }) => matchesSelection(artist, selection)),
    [artists, selection],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = q
      ? scoped.filter(({ artist }) => {
          const hay = [
            artist.name,
            artist.parent,
            artist.sub,
            artist.spotifyId,
            ...artist.rawGenres,
          ]
            .join(" ")
            .toLowerCase();
          return hay.includes(q);
        })
      : scoped;

    return [...list].sort((a, b) => compareArtists(a.artist, b.artist, sortKey));
  }, [scoped, query, sortKey]);

  useEffect(() => {
    setListLimit(120);
  }, [selection, query, sortKey]);

  const visibleRows = useMemo(
    () => filtered.slice(0, listLimit),
    [filtered, listLimit],
  );

  const selected = useMemo(() => {
    if (!selectedKey) {
      return visibleRows[0] ?? filtered[0] ?? null;
    }
    return (
      filtered.find((row) => row.key === selectedKey) ??
      visibleRows[0] ??
      null
    );
  }, [filtered, selectedKey, visibleRows]);

  function selectAll() {
    setSelection({ kind: "all" });
    setSelectedKey(null);
  }

  function selectOpen() {
    setSelection({ kind: "open" });
    setSelectedKey(null);
  }

  function selectParent(parent: string) {
    setSelection({ kind: "parent", parent });
    setSelectedKey(null);
    setExpanded((prev) => new Set(prev).add(parent));
  }

  function selectSub(parent: string, sub: string) {
    setSelection({ kind: "sub", parent, sub });
    setSelectedKey(null);
    setExpanded((prev) => new Set(prev).add(parent));
  }

  function toggleParent(parent: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(parent)) {
        next.delete(parent);
      } else {
        next.add(parent);
      }
      return next;
    });
  }

  const crumbs = useMemo((): Crumb[] => {
    const root: Crumb = { label: "Dictionnaire", onSelect: selectAll };
    if (selection.kind === "all") {
      return [root, { label: "Toute la base" }];
    }
    if (selection.kind === "open") {
      return [root, { label: OPEN_LABEL }];
    }
    if (selection.kind === "parent") {
      return [
        root,
        { label: selection.parent },
      ];
    }
    return [
      root,
      {
        label: selection.parent,
        onSelect: () => selectParent(selection.parent),
      },
      { label: selection.sub },
    ];
  }, [selection]);

  const whereHint = locationHint(selection, filtered.length, openCount, coverage);

  if (busy && !data) {
    return (
      <section className="local-stage knowledge-page">
        <KnowledgePageSkeleton />
      </section>
    );
  }

  const refreshing = busy && data !== null;

  return (
    <section
      className={`local-stage knowledge-page${refreshing ? " is-refreshing" : ""}`}
      aria-busy={busy}
    >
      <header className="local-topbar">
        <div className="local-topbar-copy">
          <p className="eyebrow">Module Savoir</p>
          <h2>Dictionnaire d’artistes</h2>
          <p className="local-lede">
            Dictionnaire du <strong>profil Spotify actif</strong>
            {activeProfile ? ` (${activeProfile.name})` : ""}. Chaque profil a
            sa propre mémoire — change de compte pour explorer un autre goût.
          </p>
        </div>
        <div className="local-toolbar">
          {profiles.length > 0 && (
            <label className="history-filter">
              <span className="sr-only">Profil Spotify</span>
              <select
                value={activeProfile?.id ?? ""}
                onChange={(e) => void onSwitchProfile(e.target.value)}
                disabled={busy}
                title="Changer de profil = changer de dictionnaire"
              >
                {profiles.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                    {p.displayName ? ` · ${p.displayName}` : ""}
                  </option>
                ))}
              </select>
            </label>
          )}
          <button
            type="button"
            className="btn-ghost"
            onClick={() => setGuideOpen((v) => !v)}
          >
            {guideOpen ? "Masquer le guide" : "Comment ça marche"}
          </button>
          <button
            type="button"
            className={`btn-ghost${refreshing ? " is-acting" : ""}`}
            onClick={() => void reload(true, true)}
            disabled={busy}
            aria-live="polite"
          >
            {busy ? "Chargement…" : "Rafraîchir"}
            <TipPanel side="bottom">
              Relit la base du profil actif (ignore le cache)
            </TipPanel>
          </button>
        </div>
      </header>
      {refreshing && (
        <p className="knowledge-refresh-status" role="status">
          Mise à jour du dictionnaire…
        </p>
      )}

      {guideOpen && (
        <div className="knowledge-guide" aria-label="Guide d’utilisation">
          <ol>
            <li>
              <strong>1 · Remplir</strong>
              <span>
                Spotify → importer les likes → éventuellement « Compléter les
                genres ».
              </span>
            </li>
            <li>
              <strong>2 · Explorer</strong>
              <span>
                Gauche : genre ▸ sous-genre. Centre : liste triable. Droite :
                fiche.
              </span>
            </li>
            <li>
              <strong>3 · Profiter</strong>
              <span>
                Un artiste classé ici range ses titres quand tu analyses dans
                Mes fichiers.
              </span>
            </li>
          </ol>
          {openCount > 0 && (
            <p className="knowledge-guide-tip">
              {openCount} encore « {OPEN_LABEL} » — le complément Spotify monte
              la couverture ({coverage}% aujourd’hui).
            </p>
          )}
        </div>
      )}

      {!tauri && (
        <p className="local-note">
          Ouvre BassOrder en app bureau pour lire la base enregistrée sur le disque.
        </p>
      )}

      {error && <p className="local-error">{error}</p>}

      {data && artists.length === 0 && !busy && (
        <div className="local-empty">
          <OrbitField
            labels={["ARTIST", "GENRE", "SPOTIFY", "WAIT", "FILL"]}
            height={160}
            className="empty-orbit"
          />
          <h3>Dictionnaire vide</h3>
          <p>
            Va dans <strong>Spotify</strong>, connecte ton compte et importe tes
            likes. Cette page se remplira toute seule.
          </p>
          {onOpenSpotify && (
            <button type="button" className="btn-primary" onClick={onOpenSpotify}>
              Ouvrir Spotify
            </button>
          )}
        </div>
      )}

      {data && artists.length > 0 && (
        <>
          <div className="knowledge-summary" aria-label="État de la base">
            <div className="knowledge-coverage">
              <div className="knowledge-coverage-top">
                <span>Couverture genres</span>
                <strong>{coverage}%</strong>
              </div>
              <div
                className="knowledge-coverage-bar"
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={coverage}
              >
                <PushFill value={coverage} className="knowledge-coverage-fill" />
              </div>
              <p>
                {classified} classés · {openCount} à compléter · {tree.length}{" "}
                genres · {subCount} sous-genres
              </p>
            </div>

            <button
              type="button"
              className={`knowledge-stat-card${selection.kind === "all" ? " is-active" : ""}`}
              onClick={selectAll}
            >
              <span>Toute la base</span>
              <strong>
                <CountUp value={artists.length} />
              </strong>
            </button>
            <button
              type="button"
              className={`knowledge-stat-card${selection.kind === "open" ? " is-active" : ""}`}
              onClick={selectOpen}
              disabled={openCount === 0}
            >
              <span>{OPEN_LABEL}</span>
              <strong>
                <CountUp value={openCount} />
              </strong>
            </button>
            <div className="knowledge-stat-card is-static">
              <span>Compte</span>
              <strong className="kpi-text">
                {data.displayName?.trim() || "—"}
              </strong>
              {data.syncedAt && <em>Sync {formatSyncedAt(data.syncedAt)}</em>}
            </div>
          </div>

          <nav className="knowledge-crumbs" aria-label="Position dans le dictionnaire">
            {crumbs.map((crumb, index) => (
              <span key={`${crumb.label}-${index}`} className="knowledge-crumb">
                {index > 0 && <span className="knowledge-crumb-sep">/</span>}
                {crumb.onSelect ? (
                  <button type="button" onClick={crumb.onSelect}>
                    {crumb.label}
                  </button>
                ) : (
                  <strong>{crumb.label}</strong>
                )}
              </span>
            ))}
            <span className="knowledge-crumbs-hint">{whereHint}</span>
          </nav>

          <div className="knowledge-board">
            <aside className="knowledge-tree-pane fx-frame fx-frame--soft">
              <span className="spin-border" aria-hidden />
              <div className="knowledge-pane-head">
                <div className="knowledge-pane-title-row">
                  <div>
                    <p className="eyebrow">1 · Genres</p>
                    <p className="knowledge-pane-help">
                      ▸ ouvre les sous-genres
                    </p>
                  </div>
                  <div className="knowledge-tree-actions">
                    <button
                      type="button"
                      className="btn-ghost"
                      onClick={() =>
                        setExpanded(new Set(tree.map((node) => node.parent)))
                      }
                    >
                      Tout ouvrir
                    </button>
                    <button
                      type="button"
                      className="btn-ghost"
                      onClick={() => setExpanded(new Set())}
                    >
                      Replier
                    </button>
                  </div>
                </div>
                <input
                  type="search"
                  className="plan-search"
                  placeholder="Chercher un artiste ou un genre…"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  aria-label="Filtrer artistes et genres"
                />
                {query.trim() && (
                  <button
                    type="button"
                    className="knowledge-clear-filter"
                    onClick={() => setQuery("")}
                  >
                    Effacer le filtre « {query.trim()} »
                  </button>
                )}
              </div>

              <ul className="knowledge-tree" role="tree" aria-label="Arbre des genres">
                <li role="none">
                  <button
                    type="button"
                    role="treeitem"
                    className={`knowledge-tree-item is-root${selection.kind === "all" ? " is-active" : ""}`}
                    onClick={selectAll}
                  >
                    <span className="knowledge-tree-label">Tous les artistes</span>
                    <em>{artists.length}</em>
                  </button>
                </li>

                {openCount > 0 && (
                  <li role="none">
                    <button
                      type="button"
                      role="treeitem"
                      className={`knowledge-tree-item is-pending${selection.kind === "open" ? " is-active" : ""}`}
                      onClick={selectOpen}
                    >
                      <span className="knowledge-tree-label">{OPEN_LABEL}</span>
                      <em>{openCount}</em>
                    </button>
                  </li>
                )}

                {tree.map((node) => {
                  const isOpen = expanded.has(node.parent);
                  const hasSubs = node.subs.length > 0;
                  const parentExact =
                    selection.kind === "parent" &&
                    selection.parent === node.parent;
                  const parentBranch =
                    selection.kind === "sub" && selection.parent === node.parent;
                  return (
                    <li key={node.parent} role="none" className="knowledge-tree-branch">
                      <div className="knowledge-tree-row">
                        {hasSubs ? (
                          <button
                            type="button"
                            className={`knowledge-tree-twist${isOpen ? " is-open" : ""}`}
                            aria-label={
                              isOpen
                                ? `Replier ${node.parent}`
                                : `Déplier les sous-genres de ${node.parent}`
                            }
                            aria-expanded={isOpen}
                            onClick={() => toggleParent(node.parent)}
                          >
                            ▸
                          </button>
                        ) : (
                          <span className="knowledge-tree-twist is-leaf" aria-hidden />
                        )}
                        <button
                          type="button"
                          role="treeitem"
                          aria-expanded={hasSubs ? isOpen : undefined}
                          className={`knowledge-tree-item${
                            parentExact
                              ? " is-active"
                              : parentBranch
                                ? " is-branch"
                                : ""
                          }`}
                          onClick={() => selectParent(node.parent)}
                          onDoubleClick={() => hasSubs && toggleParent(node.parent)}
                        >
                          <span className="knowledge-tree-label">
                            {node.parent}
                            {hasSubs && (
                              <small>
                                {node.subs.length} sous-genre
                                {node.subs.length > 1 ? "s" : ""}
                              </small>
                            )}
                          </span>
                          <em>{node.count}</em>
                        </button>
                      </div>

                      {isOpen && hasSubs && (
                        <ul className="knowledge-tree-subs" role="group">
                          {node.subs.map((sub) => {
                            const subActive =
                              selection.kind === "sub" &&
                              selection.parent === node.parent &&
                              selection.sub === sub.sub;
                            const sameAsParent =
                              sub.sub.localeCompare(node.parent, undefined, {
                                sensitivity: "base",
                              }) === 0;
                            return (
                              <li key={`${node.parent}::${sub.sub}`} role="none">
                                <button
                                  type="button"
                                  role="treeitem"
                                  className={`knowledge-tree-item is-sub${subActive ? " is-active" : ""}`}
                                  onClick={() => selectSub(node.parent, sub.sub)}
                                >
                                  <span className="knowledge-tree-label">
                                    {sameAsParent
                                      ? `Général · ${sub.sub}`
                                      : sub.sub}
                                  </span>
                                  <em>{sub.count}</em>
                                </button>
                              </li>
                            );
                          })}
                        </ul>
                      )}
                    </li>
                  );
                })}
              </ul>
            </aside>

            <div className="knowledge-table-pane fx-frame fx-frame--soft">
              <span className="spin-border" aria-hidden />
              <div className="knowledge-pane-head knowledge-table-head">
                <div>
                  <p className="eyebrow">2 · Artistes</p>
                  <h3>{selectionTitle(selection)}</h3>
                  <p className="knowledge-table-count">
                    {filtered.length} résultat
                    {filtered.length > 1 ? "s" : ""}
                    {query.trim() ? " · filtre actif" : ""}
                    {" · "}
                    tri {SORT_OPTIONS.find((o) => o.key === sortKey)?.label}
                  </p>
                </div>
                <div
                  className="mode-toggle sort-toggle"
                  role="group"
                  aria-label="Trier les artistes"
                >
                  {SORT_OPTIONS.map(({ key, label }) => (
                    <button
                      key={key}
                      type="button"
                      className={sortKey === key ? "is-active" : ""}
                      onClick={() => setSortKey(key)}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="knowledge-table-wrap">
                <table className="knowledge-table">
                  <thead>
                    <tr>
                      <th>
                        <button
                          type="button"
                          className={sortKey === "name" ? "is-active" : ""}
                          onClick={() => setSortKey("name")}
                        >
                          Artiste
                        </button>
                      </th>
                      <th>
                        <button
                          type="button"
                          className={sortKey === "sub" ? "is-active" : ""}
                          onClick={() => setSortKey("sub")}
                        >
                          Dossier
                        </button>
                      </th>
                      <th className="is-num">
                        <button
                          type="button"
                          className={sortKey === "likes" ? "is-active" : ""}
                          onClick={() => setSortKey("likes")}
                        >
                          Likes
                        </button>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {visibleRows.map(({ key, artist }) => {
                      const active = selected?.key === key;
                      const open = !artist.parent.trim();
                      return (
                        <tr
                          key={key}
                          className={`${active ? "is-active" : ""}${open ? " is-pending" : ""}`}
                          onClick={() => setSelectedKey(key)}
                        >
                          <td>
                            <strong>{artist.name}</strong>
                          </td>
                          <td>
                            <span
                              className={`knowledge-genre-cell${open ? " is-pending" : ""}`}
                            >
                              {genreLabel(artist)}
                            </span>
                          </td>
                          <td className="is-num">{artist.likes}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                {filtered.length > listLimit && (
                  <div className="knowledge-load-more">
                    <button
                      type="button"
                      className="btn-ghost"
                      onClick={() => setListLimit((n) => n + 150)}
                    >
                      Afficher plus ({filtered.length - listLimit} restants)
                    </button>
                  </div>
                )}
                {filtered.length === 0 && (
                  <div className="knowledge-empty-slice">
                    <h4>Aucun artiste ici</h4>
                    <p>
                      {query.trim()
                        ? "Élargis ou efface le filtre de recherche."
                        : "Choisis un autre genre à gauche, ou toute la base."}
                    </p>
                    {(query.trim() || selection.kind !== "all") && (
                      <button
                        type="button"
                        className="btn-ghost"
                        onClick={() => {
                          setQuery("");
                          selectAll();
                        }}
                      >
                        Revenir à toute la base
                      </button>
                    )}
                  </div>
                )}
              </div>
            </div>

            <div
              className="knowledge-detail-pane fx-frame fx-frame--soft"
              key={selected?.key ?? "empty"}
            >
              <span className="spin-border" aria-hidden />
              {selected ? (
                <ArtistDetail
                  artist={selected.artist}
                  onOpenParent={() => {
                    const parent = selected.artist.parent.trim();
                    if (parent) {
                      selectParent(parent);
                    } else {
                      selectOpen();
                    }
                  }}
                  onOpenSub={() => {
                    const parent = selected.artist.parent.trim();
                    if (!parent) {
                      selectOpen();
                      return;
                    }
                    selectSub(parent, resolvedSub(selected.artist));
                  }}
                />
              ) : (
                <div className="knowledge-empty-slice">
                  <p className="eyebrow">3 · Fiche</p>
                  <h4>Sélectionne un artiste</h4>
                  <p>
                    Clique une ligne du tableau pour voir le genre, le
                    sous-genre et l’utilité pour tes MP3.
                  </p>
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </section>
  );
}

function ArtistDetail({
  artist,
  onOpenParent,
  onOpenSub,
}: {
  artist: KnowledgeArtist;
  onOpenParent: () => void;
  onOpenSub: () => void;
}) {
  const parent = artist.parent.trim() || OPEN_LABEL;
  const sub = resolvedSub(artist);
  const open = !artist.parent.trim();
  const folder = genreFolder(artist);

  return (
    <>
      <header className="plan-detail-header">
        <div>
          <p className="plan-detail-kicker">3 · Fiche artiste</p>
          <h4>{artist.name}</h4>
          <p className="plan-detail-path" title={folder}>
            Dossier cible · {folder}
          </p>
        </div>
        <div className="plan-detail-stats">
          <span>
            <strong>{artist.likes}</strong> like
            {artist.likes > 1 ? "s" : ""}
          </span>
          <span className={open ? "knowledge-badge is-pending" : "knowledge-badge"}>
            {open ? "À compléter" : "Classé"}
          </span>
        </div>
      </header>

      <p className="knowledge-detail-lead">
        {open
          ? "Pas encore de genre fiable. Lance le complément Spotify pour le remplir."
          : `Dans Mes fichiers, les titres de ${artist.name} iront vers « ${folder} ».`}
      </p>

      <dl className="knowledge-facts">
        <div>
          <dt>Genre</dt>
          <dd>
            <button type="button" className="knowledge-linkish" onClick={onOpenParent}>
              {parent}
            </button>
          </dd>
        </div>
        <div>
          <dt>Sous-genre</dt>
          <dd>
            {open ? (
              "—"
            ) : (
              <button type="button" className="knowledge-linkish" onClick={onOpenSub}>
                {sub}
              </button>
            )}
          </dd>
        </div>
        <div>
          <dt>ID Spotify</dt>
          <dd className="knowledge-mono" title={artist.spotifyId}>
            {artist.spotifyId.trim() || "—"}
          </dd>
        </div>
      </dl>

      {artist.rawGenres.length > 0 ? (
        <>
          <p className="knowledge-raw-label">Genres Spotify bruts</p>
          <div className="artist-chips" aria-label="Genres Spotify bruts">
            {artist.rawGenres.map((genre) => (
              <span key={genre} className="artist-chip">
                {genre}
              </span>
            ))}
          </div>
        </>
      ) : (
        <p className="local-note">
          Pas de genres bruts Spotify — d’où l’intérêt du complément et du dico
          local.
        </p>
      )}
    </>
  );
}

function buildGenreTree(artists: ArtistRow[]): ParentNode[] {
  const map = new Map<
    string,
    { count: number; likes: number; subs: Map<string, SubNode> }
  >();

  for (const { artist } of artists) {
    const parent = artist.parent.trim();
    if (!parent) {
      continue;
    }
    const bucket =
      map.get(parent) ??
      (() => {
        const created = {
          count: 0,
          likes: 0,
          subs: new Map<string, SubNode>(),
        };
        map.set(parent, created);
        return created;
      })();
    bucket.count += 1;
    bucket.likes += artist.likes;

    const sub = resolvedSub(artist);
    const subNode =
      bucket.subs.get(sub) ??
      (() => {
        const created = { sub, count: 0, likes: 0 };
        bucket.subs.set(sub, created);
        return created;
      })();
    subNode.count += 1;
    subNode.likes += artist.likes;
  }

  return [...map.entries()]
    .map(([parent, value]) => ({
      parent,
      count: value.count,
      likes: value.likes,
      subs: [...value.subs.values()].sort(
        (a, b) =>
          b.count - a.count ||
          a.sub.localeCompare(b.sub, "fr", { sensitivity: "base" }),
      ),
    }))
    .sort(
      (a, b) =>
        b.count - a.count ||
        a.parent.localeCompare(b.parent, "fr", { sensitivity: "base" }),
    );
}

function matchesSelection(
  artist: KnowledgeArtist,
  selection: GenreSelection,
): boolean {
  const parent = artist.parent.trim();
  const sub = resolvedSub(artist);

  if (selection.kind === "all") {
    return true;
  }
  if (selection.kind === "open") {
    return !parent;
  }
  if (selection.kind === "parent") {
    return (
      parent.localeCompare(selection.parent, undefined, {
        sensitivity: "base",
      }) === 0
    );
  }
  return (
    parent.localeCompare(selection.parent, undefined, {
      sensitivity: "base",
    }) === 0 &&
    sub.localeCompare(selection.sub, undefined, { sensitivity: "base" }) === 0
  );
}

function compareArtists(
  a: KnowledgeArtist,
  b: KnowledgeArtist,
  key: SortKey,
): number {
  const byName = () =>
    a.name.localeCompare(b.name, "fr", { sensitivity: "base" });

  if (key === "likes") {
    return b.likes - a.likes || byName();
  }
  if (key === "sub") {
    return (
      genreLabel(a).localeCompare(genreLabel(b), "fr", {
        sensitivity: "base",
      }) || byName()
    );
  }
  return byName();
}

function selectionTitle(selection: GenreSelection): string {
  if (selection.kind === "all") {
    return "Toute la base";
  }
  if (selection.kind === "open") {
    return OPEN_LABEL;
  }
  if (selection.kind === "parent") {
    return selection.parent;
  }
  if (
    selection.sub.localeCompare(selection.parent, undefined, {
      sensitivity: "base",
    }) === 0
  ) {
    return `${selection.parent} · général`;
  }
  return `${selection.parent} · ${selection.sub}`;
}

function locationHint(
  selection: GenreSelection,
  count: number,
  openCount: number,
  coverage: number,
): string {
  if (selection.kind === "open") {
    return `${count} sans genre — à traiter via Spotify`;
  }
  if (selection.kind === "all") {
    return `Vue globale · ${coverage}% classés · ${openCount} en attente`;
  }
  if (selection.kind === "parent") {
    return `${count} artiste${count > 1 ? "s" : ""} dans ce genre`;
  }
  return `${count} artiste${count > 1 ? "s" : ""} dans ce sous-genre`;
}

function resolvedSub(artist: KnowledgeArtist): string {
  const parent = artist.parent.trim();
  const rawSub = artist.sub.trim();
  if (
    !rawSub ||
    rawSub.localeCompare(parent, undefined, { sensitivity: "base" }) === 0
  ) {
    return parent;
  }
  return rawSub;
}

function genreLabel(artist: KnowledgeArtist): string {
  if (!artist.parent.trim()) {
    return OPEN_LABEL;
  }
  const sub = resolvedSub(artist);
  if (sub.localeCompare(artist.parent, undefined, { sensitivity: "base" }) === 0) {
    return artist.parent;
  }
  return `${artist.parent} · ${sub}`;
}

function genreFolder(artist: KnowledgeArtist): string {
  if (!artist.parent.trim()) {
    return OPEN_LABEL;
  }
  const sub = resolvedSub(artist);
  if (sub.localeCompare(artist.parent, undefined, { sensitivity: "base" }) === 0) {
    return artist.parent;
  }
  return `${artist.parent}\\${sub}`;
}

function formatSyncedAt(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleString("fr-FR", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}
