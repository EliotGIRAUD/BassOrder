import { useEffect, useMemo, useRef, useState } from "react";
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
              ? `${next.knowledge.displayName ?? "Compte lié"} · ${next.knowledge.likedCount} likes · dictionnaire de ce profil.`
              : next.hasStoredAuth
                ? "Session Spotify à raviver — un clic sur Connecter suffit (souvent sans login)."
                : "Profil actif — connecte Spotify pour importer les likes de ce compte.",
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
            ? `Dictionnaire de ce profil · ${next.knowledge.likedCount} likes.`
            : next.hasStoredAuth
              ? "Session à raviver — Connecter reprend sans tout recommencer."
              : "Profil actif — session séparée des autres comptes.",
        });
      })
      .catch((err) => setError(toMessage(err)))
      .finally(() => setBusy(null));
  }

  function onSaveProfile() {
    if (!isValidSpotifyClientId(clientId)) {
      setError("Colle un Client ID Spotify valide (32 caractères hex) avant de sauvegarder.");
      return;
    }
    const saved = rememberProfile(profileName || "Spotify", clientId);
    refreshProfiles();
    void activateSpotifyProfile(saved.id).catch(() => undefined);
    fx.toast({
      kind: "ok",
      title: "Profil enregistré",
      body: `${saved.name} · session & dictionnaire séparés des autres profils.`,
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
      title: "Profil supprimé",
      body: next.length ? "Un autre profil est sélectionné." : "Aucun profil restant.",
    });
  }

  async function connect() {
    setError(null);
    if (!isValidSpotifyClientId(clientId)) {
      setError("Client ID Spotify invalide (attendu : 32 caractères hexadécimaux).");
      fx.toast({
        kind: "warn",
        title: "Client ID invalide",
        body: "Colle l’ID depuis le dashboard développeur Spotify.",
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
        ? "Reprise de session — ton dictionnaire existant sera conservé."
        : "Reprise de session si déjà liée — sinon autorise BassOrder dans le navigateur.",
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
          title: next.knowledge.displayName ?? "Spotify lié",
          body: `Session OK · ${next.knowledge.likedCount || saved.likedCount || 0} likes déjà en dictionnaire. Pas de nouvel import — utilise « Mettre à jour » si tu veux rescanner.`,
        });
        return;
      }

      fx.toast({
        kind: "ok",
        title: next.knowledge.displayName ?? "Spotify lié",
        body: "Première connexion — je récupère tes likes pour construire la base.",
      });
      setBusy("sync");
      setActivityStartedAt(Date.now());
      const synced = await spotifySyncLikes();
      setStatus(synced);
      persistKnowledge(synced);
      maybeOfferAvatar(synced.avatarUrl ?? next.avatarUrl);
      fx.toast({
        kind: "ok",
        title: "Dictionnaire prêt",
        body: `${synced.knowledge.likedCount} likes · ${synced.knowledge.classifiedArtists} artistes classés. Va dans Mes fichiers → Actualiser l’analyse pour en profiter.`,
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
      title: "Import des likes",
      body: "Ça peut prendre un moment — la progression s’affiche ici.",
    });
    try {
      const next = await spotifySyncLikes();
      setStatus(next);
      persistKnowledge(next);
      fx.toast({
        kind: "ok",
        title: "Likes importés",
        body: `${next.knowledge.likedCount} titres · ${next.knowledge.classifiedArtists}/${next.knowledge.artistCount} artistes classés.`,
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
      label: "Préparation — on repère les artistes sans genre…",
    });
    setActivityStartedAt(Date.now());
    setBusy("enrich");
    fx.toast({
      kind: "go",
      title: "Enrichissement lancé",
      body: "3 étapes : Spotify, artistes liés, puis iTunes/Deezer. Tu peux laisser tourner.",
    });
    try {
      const next = await spotifyEnrichKnowledge();
      setStatus(next);
      persistKnowledge(next);
      fx.toast({
        kind: "ok",
        title: "Dictionnaire enrichi",
        body: `${next.knowledge.classifiedArtists}/${next.knowledge.artistCount} artistes avec un dossier. Actualise ensuite l’analyse de Mes fichiers.`,
      });
    } catch (err) {
      setError(toMessage(err));
      fx.toast({
        kind: "warn",
        title: "Enrichissement interrompu",
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
        title: "Spotify déconnecté",
        body: "La base de savoir reste sur le PC tant que tu ne la reconstruis pas.",
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
          <p className="eyebrow">Compte cloud</p>
          <h2>
            <ScrambleText text="Spotify" as="span" />
          </h2>
          <p className="local-lede">
            Importe tes titres likés pour construire un dictionnaire
            artiste → genre. Ensuite, le module « Mes fichiers » s’en sert pour
            classer tes MP3.
          </p>
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
                {busy === "enrich" ? "Complément en cours…" : "Compléter les genres manquants"}
                <TipPanel side="bottom">
                  Complète les genres manquants via Spotify, iTunes et Deezer. N’écrit rien sur ta bibliothèque locale.
                </TipPanel>
              </button>
              <button
                type="button"
                className="btn-ghost"
                onClick={() => void sync()}
                disabled={busy !== null}
              >
                {busy === "sync" ? "Mise à jour…" : "Mettre à jour depuis Spotify"}
                <TipPanel side="bottom">
                  Retélécharge ta liste de likes depuis Spotify pour mettre à jour le dictionnaire
                </TipPanel>
              </button>
              <button
                type="button"
                className="btn-ghost"
                onClick={() => void disconnect()}
                disabled={busy !== null}
              >
                Déconnecter le compte
                <TipPanel side="bottom">
                  Déconnecte Spotify (la base déjà apprise reste sur le PC)
                </TipPanel>
              </button>
            </>
          )}
        </div>
      </div>

      {error && (
        <div className="local-error spotify-error">
          <strong>Import bloqué</strong>
          <p>{error}</p>
        </div>
      )}

      {!tauri && (
        <p className="local-hint">
          Pour lier Spotify, ouvre BassOrder en application bureau (
          <code>pnpm tauri dev</code>), pas seulement dans le navigateur.
        </p>
      )}

      {tauri && status && !status.connected && (
        <div className="spotify-connect fx-frame fx-frame--mid">
          <span className="spin-border" aria-hidden />
          {status.hasStoredAuth ||
          (activeProfile?.likedCount ?? 0) > 0 ||
          status.knowledge.likedCount > 0 ? (
            <>
              <p className="eyebrow">Session Spotify</p>
              <h3>Compte déjà connu — ravive la connexion</h3>
              <p>
                Le dictionnaire (
                {status.knowledge.likedCount || activeProfile?.likedCount || 0} likes) est
                bien conservé. Clique sur connecter pour reprendre la session — souvent
                sans re-login Spotify.
              </p>
            </>
          ) : (
            <>
              <p className="eyebrow">Étape 1 — connexion</p>
              <h3>Tes likes Spotify deviennent un dictionnaire</h3>
              <p>
                Chaque compte Spotify (Perso, DJ…) a sa propre connexion et son propre
                dictionnaire — le tout reste dans <em>ton</em> profil utilisateur.
                Cherche partout avec Ctrl+K.
              </p>
              <ol className="spotify-steps">
                <li>
                  Crée une application gratuite sur{" "}
                  <strong>developer.spotify.com/dashboard</strong>
                </li>
                <li>
                  Dans l’app Spotify, ajoute ces Redirect URI :{" "}
                  <code>http://127.0.0.1:41821/callback</code> et{" "}
                  <code>http://127.0.0.1:41822/callback</code>
                </li>
                <li>
                  Dans User Management, ajoute ton compte Spotify (celui qui like
                  les titres)
                </li>
                <li>
                  Colle le Client ID ci-dessous, clique sur connecter, autorise dans
                  le navigateur — l’import des likes démarre ensuite tout seul
                </li>
              </ol>
            </>
          )}
          <div className="spotify-profiles">
            <label className="spotify-client">
              <span>Profils sauvegardés</span>
              <select
                value={activeProfileId}
                onChange={(e) => onPickProfile(e.target.value)}
              >
                <option value="">Nouveau / libre</option>
                {profiles.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} · {maskId(p.clientId)}
                  </option>
                ))}
              </select>
            </label>
            <label className="spotify-client">
              <span>Nom du profil</span>
              <input
                type="text"
                value={profileName}
                autoComplete="off"
                placeholder="Ex. Perso, DJ, Colloc…"
                onChange={(e) => setProfileName(e.target.value)}
              />
            </label>
            <label className="spotify-client">
              <span>Client ID</span>
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
                title="Enregistre ce Client ID sous un nom (Perso, DJ…) pour le retrouver plus tard"
              >
                Enregistrer ce profil
              </button>
              <button
                type="button"
                className="btn-ghost"
                onClick={onDeleteProfile}
                disabled={!activeProfileId}
                title="Supprime ce profil de BassOrder (pas ton compte Spotify)"
              >
                Supprimer ce profil
              </button>
            </div>
          </div>
          <button
            type="button"
            className="btn-accent"
            onClick={() => void connect()}
            disabled={busy !== null || !isValidSpotifyClientId(clientId)}
            title="Reprend la session Spotify (refresh) ou ouvre le navigateur si besoin"
          >
            {busy === "connect"
              ? "Reprise de session…"
              : busy === "sync"
                ? "Import des titres likés…"
                : status.hasStoredAuth || (activeProfile?.likedCount ?? 0) > 0
                  ? "Reconnecter Spotify"
                  : "Connecter Spotify et importer mes likes"}
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
            <div className="spotify-avatar-offer fx-frame fx-frame--mid" role="dialog" aria-label="Photo de profil">
              <span className="spin-border" aria-hidden />
              <img
                className="spotify-avatar-offer-photo"
                src={avatarOfferUrl}
                alt=""
              />
              <div className="spotify-avatar-offer-copy">
                <h3>Utiliser ta photo Spotify ?</h3>
                <p>
                  Elle remplacera ton monogramme dans le rail et sur ton profil BassOrder.
                </p>
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
                          title: "Photo de profil",
                          body: "Ta PP Spotify est maintenant ton avatar.",
                        });
                      });
                    }}
                  >
                    Oui, l’utiliser
                  </button>
                  <button
                    type="button"
                    className="btn-ghost"
                    onClick={() => {
                      dismissAvatarOffer(user.id, avatarOfferUrl);
                      setAvatarOfferUrl(null);
                    }}
                  >
                    Plus tard
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
              {status.knowledge.displayName ?? "Compte Spotify"}
              {status.knowledge.syncedAt
                ? ` · dernière mise à jour ${formatSync(status.knowledge.syncedAt)}`
                : " · pas encore importé"}
            </span>
          </p>

          <div className="kpi-grid" aria-label="Résumé du dictionnaire">
            <div
              className={`kpi kpi-hero fx-frame fx-frame--loud${coverage >= 70 ? " is-accent" : ""}`}
            >
              <span className="spin-border" aria-hidden />
              <PushRing percent={coverage} active={live} />
              <div className="kpi-copy">
                <span className="kpi-value">
                  <CountUp value={coverage} suffix="%" />
                </span>
                <span className="kpi-label">Artistes avec un genre</span>
                <span className="kpi-hint">
                  {classified} sur {artists || "—"} dans le dictionnaire
                </span>
              </div>
            </div>
            <SpotifyMetric
              label="Titres likés"
              value={status.knowledge.likedCount}
            />
            <SpotifyMetric label="Artistes" value={status.knowledge.artistCount} />
            <SpotifyMetric label="Dossiers" value={groups.length} />
          </div>

          <p className="local-hint">
            Ce n’est <strong>pas</strong> un bug de ton import : depuis 2025,
            l’API Spotify renvoie souvent <code>genres: []</code> même pour des
            gros artistes. Le complément multi-sources (liés + dico + iTunes /
            Deezer + MusicBrainz) monte la couverture — chez toi on est déjà
            bien au-dessus du vieux plafond ~37&nbsp;%. On classe des{" "}
            <strong>artistes</strong>, pas chaque titre. Ensuite, dans{" "}
            <strong>Mes fichiers</strong>, Actualiser puis{" "}
            <strong>Deviner les genres</strong>.
          </p>

          {live && groups.length > 0 && (
            <div className="plan-workspace">
              <aside className="plan-folders fx-frame fx-frame--mid">
                <span className="spin-border" aria-hidden />
                <div className="plan-folders-tools">
                  <input
                    type="search"
                    className="plan-search"
                    placeholder="Filtrer un genre…"
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
                        <span>{group.likes} likes</span>
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
          <p className="plan-detail-kicker">Dossier</p>
          <h4>{group.genre}</h4>
          <p className="plan-detail-path">{group.folder}</p>
        </div>
        <div className="plan-detail-stats">
          <strong>{group.artistCount}</strong>
          <span>artistes</span>
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
            <li className="is-empty">Aucun artiste listé pour ce dossier.</li>
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

function formatSync(raw: string): string {
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 1_000_000_000) {
    return raw;
  }
  return new Date(n * 1000).toLocaleString("fr-FR", {
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
