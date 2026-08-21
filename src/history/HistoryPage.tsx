import { useEffect, useState, type MouseEvent } from "react";
import { subscribeDbChanged } from "../db";
import {
  forgetAllAnalyses,
  forgetLibrary,
  getActiveLibrary,
  listLibraries,
  setActiveAnalysis,
  type SavedLibrary,
} from "../local/libraryCache";
import { notifyHistoryChanged, requestOpenAnalysis, subscribeHistoryChange } from "../local/historyEvents";
import {
  forgetAllImports,
  forgetImport,
  getActiveImport,
  listImports,
  setActiveImport,
  type SavedSpotifyImport,
} from "../spotify/importCache";
import {
  notifyImportsChanged,
  notifyProfilesChanged,
  requestOpenProfile,
  subscribeImportsChange,
} from "../spotify/profileEvents";
import { activateSpotifyProfile } from "../spotify/api";
import { getActiveProfile, listProfiles, selectProfile } from "../spotify/profiles";
import { useExperience } from "../ui/Experience";
import { OrbitField } from "../ui/fx";
import { PushBar } from "../ui/push";
import { ScrambleText } from "../ui/motion";
import { HistoryListSkeleton } from "../ui/skeleton";
import { usePaintSkeleton } from "../ui/usePaintSkeleton";
import { TipPanel } from "../ui/AppTip";
import { DetectionTimeline } from "../local/DetectionTimeline";

type Props = {
  kind: "local" | "spotify";
  onOpenLocal: () => void;
};

export function HistoryPage({ kind, onOpenLocal }: Props) {
  if (kind === "spotify") {
    return <SpotifyHistoryPage onOpenSpotify={onOpenLocal} />;
  }
  return <LocalHistoryPage onOpenLocal={onOpenLocal} />;
}

function LocalHistoryPage({ onOpenLocal }: { onOpenLocal: () => void }) {
  const fx = useExperience();
  const paintSkel = usePaintSkeleton(180);
  const [items, setItems] = useState<SavedLibrary[]>(listLibraries);
  const [activeId, setActiveId] = useState(getActiveLibrary()?.id ?? null);

  useEffect(() => {
    return subscribeHistoryChange(() => {
      setItems(listLibraries());
      setActiveId(getActiveLibrary()?.id ?? null);
    });
  }, []);

  useEffect(() => {
    return subscribeDbChanged((ev) => {
      if (ev.entity === "library_scans") {
        setItems(listLibraries());
        setActiveId(getActiveLibrary()?.id ?? null);
      }
    });
  }, []);

  function refresh() {
    setItems(listLibraries());
    setActiveId(getActiveLibrary()?.id ?? null);
    notifyHistoryChanged();
  }

  function openItem(lib: SavedLibrary) {
    setActiveAnalysis(lib.id);
    requestOpenAnalysis(lib);
    onOpenLocal();
    fx.toast({
      kind: "ok",
      title: "Analyse rouverte",
      body: `${lib.fileCount} titre${lib.fileCount > 1 ? "s" : ""} · ${lib.sortedPercent}% tri · ${formatSavedAt(lib.savedAt)}`,
    });
  }

  function forgetItem(id: string) {
    forgetLibrary(id);
    refresh();
    fx.toast({
      kind: "hint",
      title: "Retiré de l’historique",
      body: "Cette analyse n’apparaît plus ici. Tes titres sur le disque n’ont pas été modifiés.",
    });
  }

  function forgetAll() {
    forgetAllAnalyses();
    refresh();
    fx.toast({
      kind: "hint",
      title: "Historique vidé",
      body: "Toutes les analyses en mémoire ont été retirées. Aucun fichier audio n’a été touché.",
    });
  }

  if (paintSkel) {
    return (
      <section className="history-page">
        <HistoryListSkeleton cards={3} />
      </section>
    );
  }

  return (
    <section className="history-page">
      <header className="local-topbar">
        <div className="local-topbar-copy">
          <p className="eyebrow">Analyses déjà faites</p>
          <h2>
            <ScrambleText text="Historique local" />
          </h2>
          <p className="local-lede">
            Chaque analyse de dossier est mémorisée ici. Rouvre-en une pour
            reprendre sans rescanner, ou retire-la de la liste (tes fichiers
            restent intacts).
          </p>
        </div>
        {items.length > 0 && (
          <div className="local-toolbar">
            <button
              type="button"
              className="btn-ghost"
              onClick={forgetAll}
              title="Vide toute la liste d’analyses en mémoire. Aucun fichier audio n’est supprimé."
            >
              Vider tout l’historique
            </button>
          </div>
        )}
      </header>

      {items.length === 0 ? (
        <div className="local-empty">
          <OrbitField
            labels={["SCAN", "FOLDER", "MP3", "WAIT", "GO"]}
            height={160}
            className="empty-orbit"
          />
          <h3>Aucune analyse pour l’instant</h3>
          <p>
            Va dans <strong>Mes fichiers</strong>, choisis un dossier de musique,
            puis lance l’analyse. Une entrée est gardée <strong>par dossier</strong>{" "}
            : les relances mettent à jour la même analyse (avec un journal des
            détections).
          </p>
          <button type="button" className="btn-primary" onClick={onOpenLocal}>
            Ouvrir Mes fichiers
          </button>
        </div>
      ) : (
        <ul className="history-page-list">
          {items.map((lib, index) => (
            <HistoryCard
              key={lib.id}
              lib={lib}
              active={lib.id === activeId}
              index={index}
              onOpen={() => openItem(lib)}
              onForget={() => forgetItem(lib.id)}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

function SpotifyHistoryPage({ onOpenSpotify }: { onOpenSpotify: () => void }) {
  const fx = useExperience();
  const paintSkel = usePaintSkeleton(180);
  const [items, setItems] = useState<SavedSpotifyImport[]>(listImports);
  const [activeId, setActiveId] = useState(getActiveImport()?.id ?? null);
  const [filterId, setFilterId] = useState(getActiveProfile()?.id ?? "");

  useEffect(() => {
    return subscribeImportsChange(() => {
      setItems(listImports());
      setActiveId(getActiveImport()?.id ?? null);
    });
  }, []);

  useEffect(() => {
    return subscribeDbChanged((ev) => {
      if (ev.entity === "spotify_imports" || ev.entity === "knowledge") {
        setItems(listImports());
        setActiveId(getActiveImport()?.id ?? null);
      }
    });
  }, []);

  const profiles = listProfiles();
  const visible = filterId ? items.filter((item) => item.profileId === filterId) : items;

  function refresh() {
    setItems(listImports());
    setActiveId(getActiveImport()?.id ?? null);
    notifyImportsChanged();
  }

  function openItem(item: SavedSpotifyImport) {
    setActiveImport(item.id);
    const profile =
      selectProfile(item.profileId) ?? profiles.find((p) => p.id === item.profileId);
    void (async () => {
      try {
        await activateSpotifyProfile(item.profileId);
      } catch {
        /* ignore */
      }
      notifyProfilesChanged();
      if (profile) {
        requestOpenProfile(profile);
      }
      onOpenSpotify();
      fx.toast({
        kind: "ok",
        title: "Profil rouvert",
        body: `${item.profileName} · dictionnaire de ce compte · ${item.likedCount} likes.`,
      });
    })();
  }

  function forgetItem(id: string) {
    forgetImport(id);
    refresh();
    fx.toast({
      kind: "hint",
      title: "Import oublié",
      body: "La base active sur le disque n’est pas effacée.",
    });
  }

  function forgetAll() {
    forgetAllImports();
    refresh();
    fx.toast({
      kind: "hint",
      title: "Historique Spotify vidé",
      body: "Les snapshots d’imports ont été oubliés.",
    });
  }

  if (paintSkel) {
    return (
      <section className="history-page">
        <HistoryListSkeleton cards={3} />
      </section>
    );
  }

  return (
    <section className="history-page">
      <header className="local-topbar">
        <div className="local-topbar-copy">
          <p className="eyebrow">Imports déjà faits</p>
          <h2>
            <ScrambleText text="Historique Spotify" />
          </h2>
          <p className="local-lede">
            Chaque import de likes est listé ici, par profil. Ouvre-en un pour
            activer ce compte Spotify et son dictionnaire (sans restaurer un
            vieux snapshot figé).
          </p>
        </div>
        <div className="local-toolbar">
          {profiles.length > 0 && (
            <label className="history-filter">
              <span className="sr-only">Filtrer par profil</span>
              <select value={filterId} onChange={(e) => setFilterId(e.target.value)}>
                <option value="">Tous les profils</option>
                {profiles.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          {items.length > 0 && (
            <button
              type="button"
              className="btn-ghost"
              onClick={forgetAll}
              title="Vide la liste des imports mémorisés"
            >
              Vider tout l’historique
            </button>
          )}
        </div>
      </header>

      {visible.length === 0 ? (
        <div className="local-empty">
          <OrbitField
            labels={["LIKE", "SYNC", "API", "WAIT", "GO"]}
            height={160}
            className="empty-orbit"
          />
          <h3>
            {items.length === 0
              ? "Aucun import pour l’instant"
              : "Aucun import pour ce profil"}
          </h3>
          <p>
            {items.length === 0 ? (
              <>
                Va dans <strong>Spotify</strong>, connecte ton compte et importe
                tes likes. Chaque mise à jour crée une entrée ici.
              </>
            ) : (
              <>
                Ce filtre ne montre rien. Choisis <strong>Tous les profils</strong>{" "}
                ou un autre compte.
              </>
            )}
          </p>
          {items.length === 0 ? (
            <button type="button" className="btn-primary" onClick={onOpenSpotify}>
              Ouvrir Spotify
            </button>
          ) : (
            <button
              type="button"
              className="btn-primary"
              onClick={() => setFilterId("")}
            >
              Voir tous les profils
            </button>
          )}
        </div>
      ) : (
        <ul className="history-page-list">
          {visible.map((item, index) => (
            <SpotifyImportCard
              key={item.id}
              item={item}
              active={item.id === activeId}
              index={index}
              onOpen={() => openItem(item)}
              onForget={() => forgetItem(item.id)}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

function SpotifyImportCard({
  item,
  active,
  index,
  onOpen,
  onForget,
}: {
  item: SavedSpotifyImport;
  active: boolean;
  index: number;
  onOpen: () => void;
  onForget: () => void;
}) {
  const classified = item.classifiedArtists;
  const artists = item.artistCount;
  const percent =
    artists > 0 ? Math.min(100, Math.round((classified * 100) / artists)) : 0;
  const topGenres = item.topGenres;

  function onCardClick(event: MouseEvent<HTMLElement>) {
    if (
      (event.target as HTMLElement).closest(
        "button, .push-bar, .history-tags, .history-detection",
      )
    ) {
      return;
    }
    onOpen();
  }

  return (
    <li style={{ animationDelay: `${Math.min(index, 8) * 0.05}s` }}>
      <article
        className={`history-card fx-frame fx-frame--mid${active ? " is-active" : ""}`}
        onClick={onCardClick}
      >
        <span className="spin-border" aria-hidden />
        <header className="history-card-head">
          <div className="history-card-title history-card-title-row">
            <span className="history-card-avatar">
              {item.avatarUrl ? (
                <img src={item.avatarUrl} alt="" />
              ) : (
                <span>{(item.displayName || item.profileName).charAt(0)}</span>
              )}
            </span>
            <div>
              <strong>{item.profileName}</strong>
              <em>{item.displayName ?? "Compte Spotify"}</em>
            </div>
          </div>
          <div className="history-card-badges">
            {active && <span className="history-badge is-live">Actif</span>}
            <time className="history-badge" dateTime={new Date(item.savedAt).toISOString()}>
              {formatSavedAt(item.savedAt)}
            </time>
          </div>
        </header>

        <PushBar
          value={percent}
          label="Artistes genrés"
          goal={`${classified}/${artists || "—"}`}
          ariaLabel={`Artistes classés ${percent} pour cent`}
          highAt={70}
          midAt={35}
        />

        <dl className="history-stats">
          <div>
            <dt>Likes</dt>
            <dd>{item.likedCount}</dd>
          </div>
          <div>
            <dt>Artistes</dt>
            <dd>{item.artistCount}</dd>
          </div>
          <div>
            <dt>Classés</dt>
            <dd>{item.classifiedArtists}</dd>
          </div>
          <div>
            <dt>Genres</dt>
            <dd>{item.groupCount}</dd>
          </div>
          <div>
            <dt>Profil</dt>
            <dd className="history-stat-text">{item.profileName}</dd>
          </div>
          <div>
            <dt>Compte</dt>
            <dd className="history-stat-text">{item.displayName ?? "—"}</dd>
          </div>
        </dl>

        {topGenres.length > 0 && (
          <ul className="history-tags">
            {topGenres.map((group) => (
              <li key={group.folder}>
                {group.genre}
                <span>{group.likes}</span>
              </li>
            ))}
          </ul>
        )}

        <footer className="history-card-actions">
          <button
            type="button"
            className="btn-primary"
            onClick={onOpen}
            title="Ouvre Spotify avec le profil lié à cet import (dictionnaire actuel)"
          >
            Ouvrir dans Spotify
          </button>
          <button
            type="button"
            className="btn-ghost history-forget"
            onClick={onForget}
            title="Retire ce snapshot de l’historique (la base active sur le disque n’est pas effacée)"
          >
            Retirer de la liste
          </button>
        </footer>
      </article>
    </li>
  );
}

function HistoryCard({
  lib,
  active,
  index,
  onOpen,
  onForget,
}: {
  lib: SavedLibrary;
  active: boolean;
  index: number;
  onOpen: () => void;
  onForget: () => void;
}) {
  const percent = Math.min(100, Math.max(0, lib.sortedPercent));
  const genres = lib.topGenres;
  const duration = lib.durationSecs;
  const folders = lib.folderCount;

  function onCardClick(event: MouseEvent<HTMLElement>) {
    if (
      (event.target as HTMLElement).closest(
        "button, .push-bar, .history-tags, .history-detection",
      )
    ) {
      return;
    }
    onOpen();
  }

  return (
    <li style={{ animationDelay: `${Math.min(index, 8) * 0.05}s` }}>
      <article
        className={`history-card fx-frame fx-frame--mid${active ? " is-active" : ""}`}
        onClick={onCardClick}
      >
        <span className="spin-border" aria-hidden />
        <header className="history-card-head">
          <div className="history-card-title">
            <strong>{folderName(lib.root)}</strong>
            <em title={lib.root}>{shortPath(lib.root)}</em>
          </div>
          <div className="history-card-badges">
            {active && <span className="history-badge is-live">Ouverte</span>}
            <span className="history-badge">
              {lib.mode === "move" ? "Déplacer" : "Copier"}
            </span>
            <time className="history-badge" dateTime={new Date(lib.savedAt).toISOString()}>
              {formatSavedAt(lib.savedAt)}
            </time>
          </div>
        </header>

        <PushBar
          value={percent}
          label="Tri auto"
          goal={percent >= 85 ? "Objectif 85% atteint" : "Objectif ≥ 85%"}
          ariaLabel={`Tri automatique ${percent} pour cent`}
          showGoalMark
          highAt={85}
          midAt={40}
        />

        {lib.detectionLog && lib.detectionLog.length > 0 && (
          <DetectionTimeline events={lib.detectionLog} collapsible={false} />
        )}

        <dl className="history-stats">
          <div>
            <dt>Titres</dt>
            <dd>{lib.fileCount}</dd>
          </div>
          <div>
            <dt>Genres</dt>
            <dd>{folders}</dd>
          </div>
          <div>
            <dt>À trier</dt>
            <dd>{lib.unknownCount}</dd>
          </div>
          <div>
            <dt>Enrichis</dt>
            <dd>{lib.lookedUpCount}</dd>
          </div>
          <div>
            <dt>Illisibles</dt>
            <dd>{lib.unreadCount}</dd>
          </div>
          <div>
            <dt>Durée</dt>
            <dd>{formatDuration(duration)}</dd>
          </div>
        </dl>

        {genres.length > 0 && (
          <div className="history-tags-block">
            <p className="history-tags-label">Top genres (aperçu — ne classe rien)</p>
            <ul className="history-tags">
              {genres.slice(0, 8).map((group) => (
                <li key={group.folder} title={`${group.genre} · ${group.count} titres`}>
                  <span className="history-tag-name">{group.genre}</span>
                  <span className="history-tag-count">{group.count}</span>
                </li>
              ))}
              {genres.length > 8 && (
                <li className="is-more">+{genres.length - 8}</li>
              )}
            </ul>
          </div>
        )}

        <footer className="history-card-actions">
          {lib.selectedFolder && (
            <p className="history-card-folder">
              Dossier ouvert : <span>{lib.selectedFolder}</span>
            </p>
          )}
          <button type="button" className="btn-primary" onClick={onOpen}>
            Rouvrir cette analyse
            <TipPanel side="bottom">
              Rouvre cette analyse dans Mes fichiers
            </TipPanel>
          </button>
          <button
            type="button"
            className="btn-ghost history-forget"
            onClick={onForget}
          >
            <TrashIcon />
            Retirer de la liste
            <TipPanel side="bottom">
              Retire cette analyse de l’historique. Tes fichiers audio restent intacts.
            </TipPanel>
          </button>
        </footer>
      </article>
    </li>
  );
}

function TrashIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" aria-hidden>
      <path
        d="M3.2 4.2h9.6M6.2 4.2V3.1A.9.9 0 0 1 7.1 2.2h1.8a.9.9 0 0 1 .9.9v1.1M4.4 4.2l.5 8.1a1 1 0 0 0 1 .9h4.2a1 1 0 0 0 1-.9l.5-8.1"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function formatDuration(secs: number): string {
  if (secs < 1) {
    return "—";
  }
  const hours = Math.floor(secs / 3600);
  const minutes = Math.floor((secs % 3600) / 60);
  if (hours > 0) {
    return `${hours} h ${minutes} min`;
  }
  return `${Math.max(1, minutes)} min`;
}

function shortPath(path: string): string {
  const parts = path.replace(/\//g, "\\").split("\\").filter(Boolean);
  if (parts.length <= 3) {
    return path;
  }
  return `${parts[0]}\\…\\${parts.slice(-2).join("\\")}`;
}

function folderName(path: string): string {
  const parts = path.replace(/\//g, "\\").split("\\").filter(Boolean);
  return parts[parts.length - 1] || path;
}

function formatSavedAt(ts: number): string {
  const delta = Date.now() - ts;
  if (delta < 60_000) {
    return "à l’instant";
  }
  if (delta < 3_600_000) {
    const m = Math.max(1, Math.round(delta / 60_000));
    return `il y a ${m} min`;
  }
  if (delta < 86_400_000) {
    const h = Math.max(1, Math.round(delta / 3_600_000));
    return `il y a ${h} h`;
  }
  return new Date(ts).toLocaleString("fr-FR", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}
