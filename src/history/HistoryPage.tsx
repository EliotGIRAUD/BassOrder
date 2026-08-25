import { useEffect, useState, type MouseEvent } from "react";
import { useTranslation } from "react-i18next";
import { intlLocale, type AppLocale } from "../i18n";
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
  const { t, i18n } = useTranslation("history");
  const loc = intlLocale((i18n.language.startsWith("fr") ? "fr" : "en") as AppLocale);
  const { t: tc } = useTranslation("common");
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
      title: t("toastReopened"),
      body: t("toastReopenedBody", {
        count: lib.fileCount,
        percent: lib.sortedPercent,
        when: formatSavedAt(lib.savedAt, loc, tc),
      }),
    });
  }

  function forgetItem(id: string) {
    forgetLibrary(id);
    refresh();
    fx.toast({
      kind: "hint",
      title: t("toastRemoved"),
      body: t("toastRemovedBody"),
    });
  }

  function forgetAll() {
    forgetAllAnalyses();
    refresh();
    fx.toast({
      kind: "hint",
      title: t("toastCleared"),
      body: t("toastClearedBody"),
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
          <p className="eyebrow">{t("localEyebrow")}</p>
          <h2>
            <ScrambleText text={t("localTitle")} />
          </h2>
          <p className="local-lede">{t("localLede")}</p>
        </div>
        {items.length > 0 && (
          <div className="local-toolbar">
            <button
              type="button"
              className="btn-ghost"
              onClick={forgetAll}
              title={t("clearAllLocalTitle")}
            >
              {t("clearAll")}
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
          <h3>{t("localEmptyTitle")}</h3>
          <p>{t("localEmptyBody")}</p>
          <button type="button" className="btn-primary" onClick={onOpenLocal}>
            {t("openLocal")}
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
              loc={loc}
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
  const { t, i18n } = useTranslation("history");
  const loc = intlLocale((i18n.language.startsWith("fr") ? "fr" : "en") as AppLocale);
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
  const activeItem = visible.find((item) => item.id === activeId) ?? visible[0] ?? null;
  const olderItems = visible.filter((item) => item.id !== activeItem?.id);

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
        title: t("toastProfileReopened"),
        body: t("toastProfileReopenedBody", {
          name: item.profileName,
          likes: item.likedCount,
        }),
      });
    })();
  }

  function forgetItem(id: string) {
    forgetImport(id);
    refresh();
    fx.toast({
      kind: "hint",
      title: t("toastImportForgotten"),
      body: t("toastImportForgottenBody"),
    });
  }

  function forgetAll() {
    forgetAllImports();
    refresh();
    fx.toast({
      kind: "hint",
      title: t("toastSpotifyCleared"),
      body: t("toastSpotifyClearedBody"),
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
          <p className="eyebrow">{t("spotifyEyebrow")}</p>
          <h2>
            <ScrambleText text={t("spotifyTitle")} />
          </h2>
          <p className="local-lede">{t("spotifyLede")}</p>
        </div>
        <div className="local-toolbar">
          {profiles.length > 0 && (
            <label className="history-filter">
              <span className="sr-only">{t("filterProfileSr")}</span>
              <select value={filterId} onChange={(e) => setFilterId(e.target.value)}>
                <option value="">{t("allProfiles")}</option>
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
              title={t("clearAllSpotifyTitle")}
            >
              {t("clearAll")}
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
            {items.length === 0 ? t("spotifyEmptyNone") : t("spotifyEmptyFilter")}
          </h3>
          <p>
            {items.length === 0
              ? t("spotifyEmptyNoneBody")
              : t("spotifyEmptyFilterBody")}
          </p>
          {items.length === 0 ? (
            <button type="button" className="btn-primary" onClick={onOpenSpotify}>
              {t("openSpotify")}
            </button>
          ) : (
            <button
              type="button"
              className="btn-primary"
              onClick={() => setFilterId("")}
            >
              {t("seeAllProfiles")}
            </button>
          )}
        </div>
      ) : (
        <div className="history-spotify-layout">
          {activeItem && (
            <ul className="history-page-list">
              <SpotifyImportCard
                key={activeItem.id}
                item={activeItem}
                active
                index={0}
                loc={loc}
                onOpen={() => openItem(activeItem)}
                onForget={() => forgetItem(activeItem.id)}
              />
            </ul>
          )}
          {olderItems.length > 0 && (
            <details className="history-older">
              <summary>
                {t("olderImports", { count: olderItems.length })}
              </summary>
              <ul className="history-page-list">
                {olderItems.map((item, index) => (
                  <SpotifyImportCard
                    key={item.id}
                    item={item}
                    active={false}
                    index={index}
                    loc={loc}
                    onOpen={() => openItem(item)}
                    onForget={() => forgetItem(item.id)}
                  />
                ))}
              </ul>
            </details>
          )}
        </div>
      )}
    </section>
  );
}

function SpotifyImportCard({
  item,
  active,
  index,
  loc,
  onOpen,
  onForget,
}: {
  item: SavedSpotifyImport;
  active: boolean;
  index: number;
  loc: "en-US" | "fr-FR";
  onOpen: () => void;
  onForget: () => void;
}) {
  const { t } = useTranslation("history");
  const { t: tc } = useTranslation("common");
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
              <em>{item.displayName ?? tc("spotifyAccount")}</em>
            </div>
          </div>
          <div className="history-card-badges">
            {active && <span className="history-badge is-live">{tc("active")}</span>}
            <time className="history-badge" dateTime={new Date(item.savedAt).toISOString()}>
              {formatSavedAt(item.savedAt, loc, tc)}
            </time>
          </div>
        </header>

        <PushBar
          value={percent}
          label={t("artistsGenred")}
          goal={`${classified}/${artists || "—"}`}
          ariaLabel={t("artistsClassifiedAria", { percent })}
          highAt={70}
          midAt={35}
        />

        <dl className="history-stats history-stats--compact">
          <div>
            <dt>{t("statLikes")}</dt>
            <dd>{item.likedCount}</dd>
          </div>
          <div>
            <dt>{t("statArtists")}</dt>
            <dd>{item.artistCount}</dd>
          </div>
          <div>
            <dt>{t("statClassified")}</dt>
            <dd>{item.classifiedArtists}</dd>
          </div>
        </dl>

        {topGenres.length > 0 && (
          <ul className="history-tags">
            {topGenres.slice(0, 3).map((group) => (
              <li key={group.folder}>
                {group.genre}
                <span>{group.likes}</span>
              </li>
            ))}
            {topGenres.length > 3 && (
              <li className="is-more">+{topGenres.length - 3}</li>
            )}
          </ul>
        )}

        <footer className="history-card-actions">
          <button
            type="button"
            className="btn-primary"
            onClick={onOpen}
            title={t("openInSpotifyTitle")}
          >
            {t("openInSpotify")}
          </button>
          <button
            type="button"
            className="btn-ghost history-forget"
            onClick={onForget}
            title={t("forgetImportTitle")}
          >
            {t("removeFromList")}
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
  loc,
  onOpen,
  onForget,
}: {
  lib: SavedLibrary;
  active: boolean;
  index: number;
  loc: "en-US" | "fr-FR";
  onOpen: () => void;
  onForget: () => void;
}) {
  const { t } = useTranslation("history");
  const { t: tc } = useTranslation("common");
  const percent = Math.min(100, Math.max(0, lib.sortedPercent));
  const genres = lib.topGenres;
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
            {active && <span className="history-badge is-live">{t("badgeOpen")}</span>}
            <span className="history-badge">
              {lib.mode === "move" ? t("modeMove") : t("modeCopy")}
            </span>
            <time className="history-badge" dateTime={new Date(lib.savedAt).toISOString()}>
              {formatSavedAt(lib.savedAt, loc, tc)}
            </time>
          </div>
        </header>

        <PushBar
          value={percent}
          label={t("pushAutoSort")}
          goal={percent >= 85 ? t("goalReached") : t("goalTarget")}
          ariaLabel={t("autoSortAria", { percent })}
          showGoalMark
          highAt={85}
          midAt={40}
        />

        <dl className="history-stats history-stats--compact">
          <div>
            <dt>{t("statTracks")}</dt>
            <dd>{lib.fileCount}</dd>
          </div>
          <div>
            <dt>{t("statToSort")}</dt>
            <dd>{lib.unknownCount}</dd>
          </div>
          <div>
            <dt>{t("statGenres")}</dt>
            <dd>{folders}</dd>
          </div>
        </dl>

        {genres.length > 0 && (
          <div className="history-tags-block">
            <ul className="history-tags">
              {genres.slice(0, 3).map((group) => (
                <li key={group.folder} title={`${group.genre} · ${group.count}`}>
                  <span className="history-tag-name">{group.genre}</span>
                  <span className="history-tag-count">{group.count}</span>
                </li>
              ))}
              {genres.length > 3 && (
                <li className="is-more">+{genres.length - 3}</li>
              )}
            </ul>
          </div>
        )}

        <footer className="history-card-actions">
          <button type="button" className="btn-primary" onClick={onOpen}>
            {t("reopenAnalysis")}
            <TipPanel side="bottom">{t("reopenTip")}</TipPanel>
          </button>
          <button
            type="button"
            className="btn-ghost history-forget"
            onClick={onForget}
          >
            <TrashIcon />
            {t("removeFromList")}
            <TipPanel side="bottom">{t("removeLocalTip")}</TipPanel>
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

function formatSavedAt(
  ts: number,
  loc: "en-US" | "fr-FR",
  tc: (key: string, opts?: Record<string, unknown>) => string,
): string {
  const delta = Date.now() - ts;
  if (delta < 60_000) {
    return tc("justNow");
  }
  if (delta < 3_600_000) {
    const m = Math.max(1, Math.round(delta / 60_000));
    return tc("minutesAgo", { count: m });
  }
  if (delta < 86_400_000) {
    const h = Math.max(1, Math.round(delta / 3_600_000));
    return tc("hoursAgo", { count: h });
  }
  return new Date(ts).toLocaleString(loc, {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}
