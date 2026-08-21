import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { intlLocale, type AppLocale } from "../i18n";
import { useExperience } from "../ui/Experience";
import { PushRing } from "../ui/push";
import { CountUp, ScrambleText } from "../ui/motion";
import { onLookupProgress } from "../local/api";
import {
  activateSpotifyProfile,
  fetchGroupArtists,
  isTauri,
  onSpotifySyncProgress,
  readStoredClientId,
  rememberProfile,
  spotifyBoot,
  spotifyConnect,
  spotifyDisconnect,
  spotifyEnrichKnowledge,
  spotifySyncLikes,
  storeClientId,
} from "./api";
import { forgetImportsForProfile, rememberImport } from "./importCache";
import {
  notifyImportsChanged,
  notifyProfilesChanged,
  subscribeOpenProfile,
  subscribeProfilesChange,
} from "./profileEvents";
import {
  deleteProfile,
  getActiveProfile,
  listProfiles,
  selectProfile,
  updateProfileMeta,
  type SpotifyProfile,
} from "./profiles";
import { SpotifyActivityFeed } from "./SpotifyActivityFeed";
import type { KnowledgeGroup, SpotifyStatus, SpotifySyncProgress } from "./types";
import { clearWorkJob, setWorkJob } from "../ui/workStatus";
import { invalidateKnowledgeCache } from "../knowledge/api";
import { VirtualList } from "../ui/VirtualList";
import { ArtistListSkeleton, SpotifyBootSkeleton } from "../ui/skeleton";
import { TipPanel } from "../ui/AppTip";
import { useUserSession } from "../users/UserSession";

function isValidSpotifyClientId(value: string): boolean {
  const id = value.trim();
  return id.length >= 16 && id.length <= 64 && /^[0-9a-fA-F]+$/.test(id);
}

function avatarOfferKey(userId: string, avatarUrl: string): string {
  return `bassorder.avatarOffer.v1:${userId}:${avatarUrl}`;
}

function wasAvatarOfferDismissed(userId: string, avatarUrl: string): boolean {
  try {
    return sessionStorage.getItem(avatarOfferKey(userId, avatarUrl)) === "1";
  } catch {
    return false;
  }
}

function dismissAvatarOffer(userId: string, avatarUrl: string): void {
  try {
    sessionStorage.setItem(avatarOfferKey(userId, avatarUrl), "1");
  } catch {
    /* ignore */
  }
}

export function SpotifyModule({ live = true }: { live?: boolean }) {
  const { t, i18n } = useTranslation("spotify");
  const { t: tc } = useTranslation("common");
  const loc = intlLocale((i18n.language.startsWith("fr") ? "fr" : "en") as AppLocale);
  const tauri = isTauri();
  const fx = useExperience();
  const { user, setAvatar } = useUserSession();
  const [clientId, setClientId] = useState(readStoredClientId);
  const [profileName, setProfileName] = useState(
    () => getActiveProfile()?.name ?? "",
  );
  const [profiles, setProfiles] = useState<SpotifyProfile[]>(listProfiles);
  const [activeProfileId, setActiveProfileId] = useState(
    () => getActiveProfile()?.id ?? "",
  );
  const [status, setStatus] = useState<SpotifyStatus | null>(null);
  const [busy, setBusy] = useState<"connect" | "sync" | "enrich" | "boot" | null>("boot");
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<SpotifySyncProgress | null>(null);
  const [activityStartedAt, setActivityStartedAt] = useState(() => Date.now());
  const [query, setQuery] = useState("");
  const [selectedFolder, setSelectedFolder] = useState<string | null>(null);
  const [avatarOfferUrl, setAvatarOfferUrl] = useState<string | null>(null);
  const busyRef = useRef(busy);
  busyRef.current = busy;
  const userRef = useRef(user);
  userRef.current = user;

  function maybeOfferAvatar(avatarUrl: string | null | undefined) {
    const url = avatarUrl?.trim() || null;
    const current = userRef.current;
    if (!url || !current) {
      return;
    }
    if (current.avatarUrl === url) {
      return;
    }
    if (wasAvatarOfferDismissed(current.id, url)) {
      return;
    }
    setAvatarOfferUrl(url);
  }

  function refreshProfiles() {
    setProfiles(listProfiles());
    const active = getActiveProfile();
    setActiveProfileId(active?.id ?? "");
    if (active) {
      setClientId(active.clientId);
      setProfileName(active.name);
    }
    notifyProfilesChanged();
  }

  function persistKnowledge(next: SpotifyStatus) {
    const active = getActiveProfile();
    if (!active) {
      return;
    }
    const displayName = next.knowledge.displayName ?? active.displayName ?? null;
    const avatarUrl = next.avatarUrl ?? active.avatarUrl ?? null;
    updateProfileMeta(active.id, {
      displayName,
      avatarUrl,
      lastSyncedAt: Date.now(),
      likedCount: next.knowledge.likedCount,
      artistCount: next.knowledge.artistCount,
      groupCount: next.knowledge.groups.length,
      name: profileName.trim() || displayName || active.name,
    });
    rememberImport({
      profileId: active.id,
      profileName: profileName.trim() || displayName || active.name,
      displayName,
      avatarUrl,
      knowledge: next.knowledge,
    });
    invalidateKnowledgeCache();
    refreshProfiles();
    notifyImportsChanged();
  }

  useEffect(() => {
    if (busy === "connect") {
      setWorkJob("spotify-connect", "Connexion Spotify");
      return () => clearWorkJob("spotify-connect");
    }
    if (busy === "sync") {
      const detail = progress
        ? progress.total > 0
          ? `${progress.done}/${progress.total}`
          : progress.label
        : undefined;
      setWorkJob(
        "spotify-sync",
        "Import des likes",
        detail,
        progress && progress.total > 0
          ? { done: progress.done, total: progress.total }
          : undefined,
      );
      return () => clearWorkJob("spotify-sync");
    }
    if (busy === "enrich") {
      const detail = progress
        ? progress.total > 0
          ? `${progress.done}/${progress.total}`
          : progress.label
        : "En cours…";
      setWorkJob(
        "spotify-enrich",
        "Complément Spotify",
        detail,
        progress && progress.total > 0
          ? { done: progress.done, total: progress.total }
          : undefined,
      );
      return () => clearWorkJob("spotify-enrich");
    }
    clearWorkJob("spotify-connect");
    clearWorkJob("spotify-sync");
    clearWorkJob("spotify-enrich");
  }, [busy, progress]);

  useEffect(() => {
    if (!tauri) {
      setBusy(null);
      return;
    }
    let unlistenSync: (() => void) | undefined;
    let unlistenLookup: (() => void) | undefined;
    void onSpotifySyncProgress(setProgress).then((fn) => {
      unlistenSync = fn;
    });
    void onLookupProgress((lookup) => {
      if (busyRef.current !== "enrich") {
        return;
      }
      setProgress({
        phase: "catalog",
        done: lookup.done,
        total: Math.max(1, lookup.total),
        label: lookup.artist
          ? `Catalogues publics — ${lookup.artist}`
          : `Catalogues publics… ${lookup.done}/${lookup.total}`,
      });
    }).then((fn) => {
      unlistenLookup = fn;
    });
    void spotifyBoot((summary) => {
      setStatus(summary);
      if (summary.clientId) {
        setClientId(summary.clientId);
        storeClientId(summary.clientId);
        refreshProfiles();
      }
    })
      .then((next) => {
        setStatus(next);
        if (next.clientId) {
          setClientId(next.clientId);
          storeClientId(next.clientId);
          refreshProfiles();
        }
        if (next.connected && next.knowledge.likedCount > 0) {
          const active = getActiveProfile();
          if (active && !active.lastSyncedAt) {
            persistKnowledge(next);
          } else if (active && next.avatarUrl && !active.avatarUrl) {
            updateProfileMeta(active.id, {
              avatarUrl: next.avatarUrl,
              displayName: next.knowledge.displayName,
            });
            refreshProfiles();
            maybeOfferAvatar(next.avatarUrl);
          } else if (next.avatarUrl) {
            maybeOfferAvatar(next.avatarUrl);
          }
        }
      })
      .catch((err) => setError(toMessage(err)))
      .finally(() => setBusy(null));
    return () => {
      unlistenSync?.();
      unlistenLookup?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tauri]);

  useEffect(() => {
    const offProfiles = subscribeProfilesChange(() => {
      setProfiles(listProfiles());
      const active = getActiveProfile();
      setActiveProfileId(active?.id ?? "");
      if (active) {
        setClientId(active.clientId);
        setProfileName(active.name);
      }
    });
    const offOpen = subscribeOpenProfile((profile) => {
      selectProfile(profile.id);
      setActiveProfileId(profile.id);
      setClientId(profile.clientId);
      setProfileName(profile.name);
      setProfiles(listProfiles());
      setBusy("boot");
      void activateSpotifyProfile(profile.id)
        .then(() => {
          invalidateKnowledgeCache();
          return spotifyBoot((summary) => setStatus(summary));
        })
        .then((next) => {
          setStatus(next);
          fx.toast({
            kind: "ok",
            title: profile.name,
            body: next.connected
              ? t("toastProfileSwitchConnected", { count: next.knowledge.likedCount })
              : next.hasStoredAuth
                ? t("toastProfileSwitchStored")
                : t("toastProfileSwitchIdle"),
          });
        })
        .catch((err) => setError(toMessage(err)))
        .finally(() => setBusy(null));
    });
    return () => {
      offProfiles();
      offOpen();
    };
  }, [fx]);

  const groups = status?.knowledge.groups ?? [];
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) {
      return groups;
    }
    return groups.filter(
      (g) =>
        g.genre.toLowerCase().includes(q) ||
        g.folder.toLowerCase().includes(q) ||
        g.artists.some((a) => a.toLowerCase().includes(q)),
    );
  }, [groups, query]);

  const selected = useMemo(
    () =>
      filtered.find((g) => g.folder === selectedFolder) ?? filtered[0] ?? null,
    [filtered, selectedFolder],
  );

  const classified = status?.knowledge.classifiedArtists ?? 0;
  const artists = status?.knowledge.artistCount ?? 0;
  const coverage = artists > 0 ? Math.round((classified * 100) / artists) : 0;
  const activeProfile = profiles.find((p) => p.id === activeProfileId) ?? null;

  function onPickProfile(id: string) {
    if (!id) {
      setActiveProfileId("");
      return;
    }
    const profile = selectProfile(id);
    if (!profile) {
      return;
    }
    setActiveProfileId(profile.id);
    setClientId(profile.clientId);
    setProfileName(profile.name);
    setProfiles(listProfiles());
    notifyProfilesChanged();
    setBusy("boot");
    void activateSpotifyProfile(profile.id)
      .then(() => {
        invalidateKnowledgeCache();
        return spotifyBoot((summary) => setStatus(summary));
      })
      .then((next) => {
        setStatus(next);
        fx.toast({
          kind: "ok",
          title: profile.name,
          body: next.connected
            ? t("toastProfileSwitchConnected", { count: next.knowledge.likedCount })
            : next.hasStoredAuth
              ? t("toastProfileSwitchStored")
              : t("toastProfileSwitchIdle"),
        });
      })
      .catch((err) => setError(toMessage(err)))
      .finally(() => setBusy(null));
  }

  function onSaveProfile() {
    if (!isValidSpotifyClientId(clientId)) {
      setError(t("invalidClientIdSave"));
      return;
    }
    const saved = rememberProfile(profileName || "Spotify", clientId);
    refreshProfiles();
    void activateSpotifyProfile(saved.id).catch(() => undefined);
    fx.toast({
      kind: "ok",
      title: t("toastProfileSaved"),
      body: t("toastProfileSavedBody", { name: saved.name }),
    });
  }

  function onDeleteProfile() {
    if (!activeProfileId) {
      return;
    }
    forgetImportsForProfile(activeProfileId);
    deleteProfile(activeProfileId);
    notifyImportsChanged();
    const next = listProfiles();
    setProfiles(next);
    const active = getActiveProfile();
    setActiveProfileId(active?.id ?? "");
    setClientId(active?.clientId ?? "");
    setProfileName(active?.name ?? "");
    notifyProfilesChanged();
    fx.toast({
      kind: "hint",
      title: t("toastProfileDeleted"),
      body: next.length ? t("toastProfileDeletedOther") : t("toastProfileDeletedNone"),
    });
  }

  async function connect() {
    setError(null);
    if (!isValidSpotifyClientId(clientId)) {
      setError(t("invalidClientId"));
      fx.toast({
        kind: "warn",
        title: t("toastInvalidClientId"),
        body: t("toastInvalidClientIdBody"),
      });
      return;
    }
    setBusy("connect");
    const saved = rememberProfile(
      profileName || status?.knowledge.displayName || "Spotify",
      clientId,
    );
    refreshProfiles();
    try {
      await activateSpotifyProfile(saved.id);
    } catch {
      /* le connect basculera quand même */
    }
    const alreadyHasDictionary =
      (status?.knowledge.likedCount ?? 0) > 0 ||
      (status?.knowledge.artistCount ?? 0) > 0 ||
      (saved.likedCount ?? 0) > 0 ||
      (getActiveProfile()?.likedCount ?? 0) > 0;

    fx.toast({
      kind: "go",
      title: "Spotify",
      body: alreadyHasDictionary
        ? t("toastConnectingKeep")
        : t("toastConnectingAuth"),
    });
    try {
      const next = await spotifyConnect(clientId);
      setStatus(next);
      if (next.knowledge.displayName || next.avatarUrl) {
        rememberProfile(profileName || next.knowledge.displayName || "Spotify", clientId, {
          displayName: next.knowledge.displayName,
          avatarUrl: next.avatarUrl ?? null,
        });
        refreshProfiles();
      }
      maybeOfferAvatar(next.avatarUrl);

      const hasDictionary =
        alreadyHasDictionary ||
        next.knowledge.likedCount > 0 ||
        next.knowledge.artistCount > 0;

      if (hasDictionary) {
        persistKnowledge(next);
        fx.toast({
          kind: "ok",
          title: next.knowledge.displayName ?? t("toastLinkedFallback"),
          body: t("toastLinkedKeep", { count: next.knowledge.likedCount || saved.likedCount || 0 }),
        });
        return;
      }

      fx.toast({
        kind: "ok",
        title: next.knowledge.displayName ?? t("toastLinkedFallback"),
        body: t("toastFirstImport"),
      });
      setBusy("sync");
      setActivityStartedAt(Date.now());
      const synced = await spotifySyncLikes();
      setStatus(synced);
      persistKnowledge(synced);
      maybeOfferAvatar(synced.avatarUrl ?? next.avatarUrl);
      fx.toast({
        kind: "ok",
        title: t("toastDictReady"),
        body: t("toastDictReadyBody", {
          likes: synced.knowledge.likedCount,
          classified: synced.knowledge.classifiedArtists,
        }),
      });
    } catch (err) {
      setError(toMessage(err));
    } finally {
      setBusy(null);
      setProgress(null);
    }
  }

  async function sync() {
    setError(null);
    setProgress(null);
    setActivityStartedAt(Date.now());
    setBusy("sync");
    fx.toast({
      kind: "go",
      title: t("toastImportLikes"),
      body: t("toastImportLikesBody"),
    });
    try {
      const next = await spotifySyncLikes();
      setStatus(next);
      persistKnowledge(next);
      fx.toast({
        kind: "ok",
        title: t("toastLikesImported"),
        body: t("toastLikesImportedBody", {
          likes: next.knowledge.likedCount,
          classified: next.knowledge.classifiedArtists,
          artists: next.knowledge.artistCount,
        }),
      });
    } catch (err) {
      setError(toMessage(err));
    } finally {
      setBusy(null);
      setProgress(null);
    }
  }

  async function enrich() {
    setError(null);
    setProgress({
      phase: "enrich",
      done: 0,
      total: 1,
      label: t("toastEnrichPrep"),
    });
    setActivityStartedAt(Date.now());
    setBusy("enrich");
    fx.toast({
      kind: "go",
      title: t("toastEnrichStarted"),
      body: t("toastEnrichStartedBody"),
    });
    try {
      const next = await spotifyEnrichKnowledge();
      setStatus(next);
      persistKnowledge(next);
      fx.toast({
        kind: "ok",
        title: t("toastEnrichDone"),
        body: t("toastEnrichDoneBody", {
          classified: next.knowledge.classifiedArtists,
          artists: next.knowledge.artistCount,
        }),
      });
    } catch (err) {
      setError(toMessage(err));
      fx.toast({
        kind: "warn",
        title: t("toastEnrichInterrupted"),
        body: toMessage(err),
      });
    } finally {
      setBusy(null);
      setProgress(null);
    }
  }

  async function disconnect() {
    setError(null);
    try {
      const next = await spotifyDisconnect();
      setStatus(next);
      fx.toast({
        kind: "hint",
        title: t("toastDisconnected"),
        body: t("toastDisconnectedBody"),
      });
    } catch (err) {
      setError(toMessage(err));
    }
  }

  if (busy === "boot") {
    return (
      <section className="local-stage spotify-stage">
        <SpotifyBootSkeleton />
      </section>
    );
  }

  return (
    <section className="local-stage spotify-stage">
      <div className="local-topbar">
        <div className="local-topbar-copy">
          <p className="eyebrow">{t("eyebrow")}</p>
          <h2>
            <ScrambleText text={t("title")} as="span" />
          </h2>
          <p className="local-lede">{t("lede")}</p>
        </div>
        <div className="local-toolbar">
          {status?.connected && (
            <>
              <button
                type="button"
                className="btn-accent"
                onClick={() => void enrich()}
                disabled={busy !== null}
              >
                {busy === "enrich" ? t("completingGenres") : t("completeGenres")}
                <TipPanel side="bottom">{t("completeTip")}</TipPanel>
              </button>
              <button
                type="button"
                className="btn-ghost"
                onClick={() => void sync()}
                disabled={busy !== null}
              >
                {busy === "sync" ? t("updating") : t("updateFromSpotify")}
                <TipPanel side="bottom">{t("updateTip")}</TipPanel>
              </button>
              <button
                type="button"
                className="btn-ghost"
                onClick={() => void disconnect()}
                disabled={busy !== null}
              >
                {t("disconnect")}
                <TipPanel side="bottom">{t("disconnectTip")}</TipPanel>
              </button>
            </>
          )}
        </div>
      </div>

      {error && (
        <div className="local-error spotify-error">
          <strong>{t("importBlocked")}</strong>
          <p>{error}</p>
        </div>
      )}

      {!tauri && (
        <p className="local-hint">{t("needDesktopHint")}</p>
      )}

      {tauri && status && !status.connected && (
        <div className="spotify-connect fx-frame fx-frame--mid">
          <span className="spin-border" aria-hidden />
          {status.hasStoredAuth ||
          (activeProfile?.likedCount ?? 0) > 0 ||
          status.knowledge.likedCount > 0 ? (
            <>
              <p className="eyebrow">{t("sessionEyebrow")}</p>
              <h3>{t("sessionKnownTitle")}</h3>
              <p>
                {t("sessionKnownBody", {
                  count: status.knowledge.likedCount || activeProfile?.likedCount || 0,
                })}
              </p>
            </>
          ) : (
            <>
              <p className="eyebrow">{t("step1Eyebrow")}</p>
              <h3>{t("step1Title")}</h3>
              <p>{t("step1Body")}</p>
              <ol className="spotify-steps">
                <li>{t("stepCreateApp")}</li>
                <li>{t("stepRedirect")}</li>
                <li>{t("stepUserMgmt")}</li>
                <li>{t("stepClientId")}</li>
              </ol>
            </>
          )}
          <div className="spotify-profiles">
            <label className="spotify-client">
              <span>{t("savedProfiles")}</span>
              <select
                value={activeProfileId}
                onChange={(e) => onPickProfile(e.target.value)}
              >
                <option value="">{t("newFree")}</option>
                {profiles.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} · {maskId(p.clientId)}
                  </option>
                ))}
              </select>
            </label>
            <label className="spotify-client">
              <span>{t("profileName")}</span>
              <input
                type="text"
                value={profileName}
                autoComplete="off"
                placeholder={t("profileNamePlaceholder")}
                onChange={(e) => setProfileName(e.target.value)}
              />
            </label>
            <label className="spotify-client">
              <span>{t("clientId")}</span>
              <input
                type="text"
                value={clientId}
                autoComplete="off"
                spellCheck={false}
                placeholder="xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
                onChange={(e) => {
                  setClientId(e.target.value);
                  storeClientId(e.target.value);
                }}
              />
            </label>
            <div className="spotify-profile-actions">
              <button
                type="button"
                className="btn-ghost"
                onClick={onSaveProfile}
                disabled={!isValidSpotifyClientId(clientId)}
                title={t("saveProfileTitle")}
              >
                {t("saveProfile")}
              </button>
              <button
                type="button"
                className="btn-ghost"
                onClick={onDeleteProfile}
                disabled={!activeProfileId}
                title={t("deleteProfileTitle")}
              >
                {t("deleteProfile")}
              </button>
            </div>
          </div>
          <button
            type="button"
            className="btn-accent"
            onClick={() => void connect()}
            disabled={busy !== null || !isValidSpotifyClientId(clientId)}
            title={t("connectTitle")}
          >
            {busy === "connect"
              ? t("connectResuming")
              : busy === "sync"
                ? t("connectImporting")
                : status.hasStoredAuth || (activeProfile?.likedCount ?? 0) > 0
                  ? t("connectResume")
                  : t("connectImport")}
          </button>
        </div>
      )}

      {(busy === "sync" || busy === "enrich") && (
        <SpotifyActivityFeed
          mode={busy}
          progress={progress}
          startedAt={activityStartedAt}
        />
      )}

      {status?.connected && busy !== "sync" && busy !== "enrich" && (
        <>
          {avatarOfferUrl && user && (
            <div className="spotify-avatar-offer fx-frame fx-frame--mid" role="dialog" aria-label={t("avatarOfferAria")}>
              <span className="spin-border" aria-hidden />
              <img
                className="spotify-avatar-offer-photo"
                src={avatarOfferUrl}
                alt=""
              />
              <div className="spotify-avatar-offer-copy">
                <h3>{t("avatarOfferTitle")}</h3>
                <p>{t("avatarOfferBody")}</p>
                <div className="spotify-avatar-offer-actions">
                  <button
                    type="button"
                    className="btn-primary"
                    onClick={() => {
                      void setAvatar(user.id, avatarOfferUrl).then(() => {
                        dismissAvatarOffer(user.id, avatarOfferUrl);
                        setAvatarOfferUrl(null);
                        fx.toast({
                          kind: "ok",
                          title: t("toastAvatar"),
                          body: t("toastAvatarBody"),
                        });
                      });
                    }}
                  >
                    {t("avatarYes")}
                  </button>
                  <button
                    type="button"
                    className="btn-ghost"
                    onClick={() => {
                      dismissAvatarOffer(user.id, avatarOfferUrl);
                      setAvatarOfferUrl(null);
                    }}
                  >
                    {t("avatarLater")}
                  </button>
                </div>
              </div>
            </div>
          )}

          <p className="local-path spotify-identity">
            {(activeProfile?.avatarUrl || status.avatarUrl) && (
              <img
                className="spotify-identity-avatar"
                src={activeProfile?.avatarUrl || status.avatarUrl || ""}
                alt=""
              />
            )}
            <span>
              {activeProfile?.name ? `${activeProfile.name} · ` : ""}
              {status.knowledge.displayName ?? tc("spotifyAccount")}
              {status.knowledge.syncedAt
                ? t("identityLastUpdate", { when: formatSync(status.knowledge.syncedAt, loc) })
                : t("identityNotImported")}
            </span>
          </p>

          <div className="kpi-grid" aria-label={t("kpiAria")}>
            <div
              className={`kpi kpi-hero fx-frame fx-frame--loud${coverage >= 70 ? " is-accent" : ""}`}
            >
              <span className="spin-border" aria-hidden />
              <PushRing percent={coverage} active={live} />
              <div className="kpi-copy">
                <span className="kpi-value">
                  <CountUp value={coverage} suffix="%" />
                </span>
                <span className="kpi-label">{t("kpiArtistsWithGenre")}</span>
                <span className="kpi-hint">
                  {t("kpiArtistsHint", { classified, artists: artists || "—" })}
                </span>
              </div>
            </div>
            <SpotifyMetric
              label={t("metricLiked")}
              value={status.knowledge.likedCount}
            />
            <SpotifyMetric label={t("metricArtists")} value={status.knowledge.artistCount} />
            <SpotifyMetric label={t("metricFolders")} value={groups.length} />
          </div>

          <p className="local-hint">{t("apiNote")}</p>

          {live && groups.length > 0 && (
            <div className="plan-workspace">
              <aside className="plan-folders fx-frame fx-frame--mid">
                <span className="spin-border" aria-hidden />
                <div className="plan-folders-tools">
                  <input
                    type="search"
                    className="plan-search"
                    placeholder={t("filterGenrePlaceholder")}
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                  />
                </div>
                <VirtualList
                  className="folder-list"
                  items={filtered}
                  estimateSize={72}
                  threshold={24}
                  getKey={(group) => group.folder}
                >
                  {(group) => (
                    <button
                      type="button"
                      className={`folder-row${selected?.folder === group.folder ? " is-active" : ""}`}
                      onClick={() => setSelectedFolder(group.folder)}
                    >
                      <div className="folder-row-top">
                        <span className="folder-icon" aria-hidden />
                        <span className="folder-name">{group.genre}</span>
                        <span className="folder-count">{group.artistCount}</span>
                      </div>
                      <div className="folder-row-meta">
                        <span>{t("likesCount", { count: group.likes })}</span>
                      </div>
                    </button>
                  )}
                </VirtualList>
              </aside>
              {selected && <GroupDetail group={selected} />}
            </div>
          )}
        </>
      )}
    </section>
  );
}

function GroupDetail({ group }: { group: KnowledgeGroup }) {
  const { t } = useTranslation("spotify");
  const [artists, setArtists] = useState<string[]>(group.artists);
  const [loadingArtists, setLoadingArtists] = useState(group.artists.length === 0);

  useEffect(() => {
    let cancelled = false;
    if (group.artists.length > 0) {
      setArtists(group.artists);
      setLoadingArtists(false);
      return;
    }
    setLoadingArtists(true);
    void fetchGroupArtists(group.folder)
      .then((names) => {
        if (!cancelled) {
          setArtists(names);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setArtists([]);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoadingArtists(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [group.folder, group.artists]);

  return (
    <article className="plan-detail fx-frame fx-frame--soft">
      <span className="spin-border" aria-hidden />
      <header className="plan-detail-header">
        <div>
          <p className="plan-detail-kicker">{t("detailFolder")}</p>
          <h4>{group.genre}</h4>
          <p className="plan-detail-path">{group.folder}</p>
        </div>
        <div className="plan-detail-stats">
          <strong>{group.artistCount}</strong>
          <span>{t("detailArtists")}</span>
        </div>
      </header>
      {loadingArtists ? (
        <ArtistListSkeleton rows={8} />
      ) : (
        <ul className="spotify-artists">
          {artists.map((name) => (
            <li key={name}>{name}</li>
          ))}
          {artists.length === 0 && (
            <li className="is-empty">{t("noArtistsListed")}</li>
          )}
        </ul>
      )}
    </article>
  );
}

function SpotifyMetric({ label, value }: { label: string; value: number }) {
  return (
    <div className="kpi fx-frame fx-frame--soft">
      <span className="spin-border" aria-hidden />
      <span className="kpi-value">
        <CountUp value={value} />
      </span>
      <span className="kpi-label">{label}</span>
    </div>
  );
}

function formatSync(raw: string, loc: "en-US" | "fr-FR" = "fr-FR"): string {
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 1_000_000_000) {
    return raw;
  }
  return new Date(n * 1000).toLocaleString(loc, {
    dateStyle: "short",
    timeStyle: "short",
  });
}

function maskId(id: string): string {
  const t = id.trim();
  if (t.length <= 10) {
    return t;
  }
  return `${t.slice(0, 4)}…${t.slice(-4)}`;
}

function toMessage(err: unknown): string {
  if (typeof err === "string") {
    return err;
  }
  if (err instanceof Error) {
    return err.message;
  }
  return "Erreur Spotify inattendue.";
}
