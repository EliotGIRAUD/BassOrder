import { useCallback, useEffect, useState, type FormEvent } from "react";
import { DEFAULT_PREFS, usePrefs } from "../ui/prefs";
import { useExperience } from "../ui/Experience";
import { LiveAvatar } from "../users/LiveAvatar";
import { useUserSession } from "../users/UserSession";
import {
  clearCloudLink,
  deleteAccountPreset,
  deleteFavorite,
  getCloudLink,
  listAccountPresets,
  listFavorites,
  setCloudLink,
  upsertAccountPreset,
  type AccountPreset,
  type CloudLink,
  type Favorite,
} from "./favorites";
import {
  cloudHealth,
  cloudLogin,
  cloudLogout,
  cloudOAuthStartUrl,
  cloudRegister,
  getApiBase,
  setApiBase,
} from "./cloudApi";
import {
  localAuthClearPassword,
  localAuthSetPassword,
  localAuthStatus,
} from "./localAuth";
import { syncKnowledgeCloud } from "../knowledge/api";

export function AccountPage() {
  const { user } = useUserSession();
  const { prefs, replace } = usePrefs();
  const fx = useExperience();
  const [link, setLink] = useState<CloudLink | null>(null);
  const [favorites, setFavorites] = useState<Favorite[]>([]);
  const [presets, setPresets] = useState<AccountPreset[]>([]);
  const [hasLocalPw, setHasLocalPw] = useState(false);
  const [apiUrl, setApiUrl] = useState(getApiBase());
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [localPin, setLocalPin] = useState("");
  const [localPinCurrent, setLocalPinCurrent] = useState("");
  const [busy, setBusy] = useState(false);
  const [apiOk, setApiOk] = useState<boolean | null>(null);
  const [mode, setMode] = useState<"login" | "register">("login");

  const reload = useCallback(async () => {
    if (!user) return;
    const [l, f, p, auth] = await Promise.all([
      getCloudLink(user.id),
      listFavorites(user.id),
      listAccountPresets(user.id),
      localAuthStatus(user.id),
    ]);
    setLink(l);
    setFavorites(f);
    setPresets(p);
    setHasLocalPw(auth.hasPassword);
    if (l?.apiBaseUrl) {
      try {
        setApiBase(l.apiBaseUrl);
        setApiUrl(l.apiBaseUrl);
      } catch {
        setApiUrl(getApiBase());
      }
    }
  }, [user]);

  useEffect(() => {
    void reload();
  }, [reload]);

  useEffect(() => {
    let cancelled = false;
    void cloudHealth()
      .then(() => {
        if (!cancelled) setApiOk(true);
      })
      .catch(() => {
        if (!cancelled) setApiOk(false);
      });
    return () => {
      cancelled = true;
    };
  }, [apiUrl]);

  if (!user) return null;

  async function onCloudAuth(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    try {
      setApiBase(apiUrl);
    } catch (err) {
      setBusy(false);
      fx.toast({
        kind: "warn",
        title: "URL API refusée",
        body: err instanceof Error ? err.message : String(err),
      });
      return;
    }
    try {
      const tokens =
        mode === "register"
          ? await cloudRegister(email.trim(), password)
          : await cloudLogin(email.trim(), password);
      const next = await setCloudLink({
        userId: user!.id,
        accountId: tokens.accountId,
        email: tokens.email,
        apiBaseUrl: getApiBase(),
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        expiresAt: tokens.expiresAt,
      });
      setLink(next);
      setPassword("");
      fx.toast({
        kind: "ok",
        title: mode === "register" ? "Compte créé" : "Connecté",
        body: tokens.email,
      });
      await reload();
    } catch (err) {
      fx.toast({
        kind: "warn",
        title: "Cloud indisponible",
        body: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setBusy(false);
    }
  }

  async function onCloudDisconnect() {
    if (!user || !link) return;
    setBusy(true);
    try {
      // best-effort logout serveur
      try {
        /* tokens not exposed in CloudLink UI — clear local link */
        await cloudLogout("", "");
      } catch {
        /* offline */
      }
      await clearCloudLink(user.id);
      setLink(null);
      fx.toast({ kind: "ok", title: "Déconnecté du cloud", body: "Profil local intact." });
    } finally {
      setBusy(false);
    }
  }

  async function onSyncKnowledge() {
    if (!user || busy) return;
    setBusy(true);
    try {
      const result = await syncKnowledgeCloud(user.id);
      await reload();
      const filled =
        result.filled > 0
          ? ` · ${result.filled} genre${result.filled > 1 ? "s" : ""} comblé${result.filled > 1 ? "s" : ""} via le pool`
          : "";
      fx.toast({
        kind: "ok",
        title: "Knowledge synchronisée",
        body: `${result.pushed} artiste${result.pushed > 1 ? "s" : ""} poussé${result.pushed > 1 ? "s" : ""} vers le cloud${filled}.`,
      });
    } catch (err) {
      fx.toast({
        kind: "warn",
        title: "Sync knowledge",
        body: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setBusy(false);
    }
  }

  async function onSetLocalPin(event: FormEvent) {
    event.preventDefault();
    if (!user || localPin.trim().length < 6) return;
    setBusy(true);
    try {
      const status = await localAuthSetPassword(
        user.id,
        localPin,
        hasLocalPw ? localPinCurrent : undefined,
      );
      setHasLocalPw(status.hasPassword);
      setLocalPin("");
      setLocalPinCurrent("");
      fx.toast({
        kind: "ok",
        title: "Verrou local activé",
        body: "PIN / mot de passe enregistré (Argon2).",
      });
    } catch (err) {
      fx.toast({
        kind: "warn",
        title: "Impossible",
        body: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setBusy(false);
    }
  }

  async function onClearLocalPin() {
    if (!user || !localPinCurrent) return;
    setBusy(true);
    try {
      await localAuthClearPassword(user.id, localPinCurrent);
      setHasLocalPw(false);
      setLocalPinCurrent("");
      fx.toast({ kind: "ok", title: "Verrou retiré", body: "Profil sans PIN." });
    } catch (err) {
      fx.toast({
        kind: "warn",
        title: "Mot de passe incorrect",
        body: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setBusy(false);
    }
  }

  async function onSavePreset() {
    if (!user) return;
    const name = `Réglages ${new Date().toLocaleString("fr-FR", {
      day: "2-digit",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    })}`;
    await upsertAccountPreset({
      userId: user.id,
      name,
      prefs: { ...prefs },
    });
    await reload();
    fx.toast({
      kind: "ok",
      title: "Preset sauvegardé",
      body: "Tu pourras le réappliquer depuis cette liste.",
    });
  }

  async function onApplyPreset(preset: AccountPreset) {
    replace({ ...DEFAULT_PREFS, ...(preset.prefs as Partial<typeof DEFAULT_PREFS>) });
    fx.toast({
      kind: "ok",
      title: "Preset appliqué",
      body: preset.name,
    });
  }

  async function onRemovePreset(id: string) {
    await deleteAccountPreset(id);
    setPresets((prev) => prev.filter((p) => p.id !== id));
    fx.toast({ kind: "hint", title: "Preset retiré", body: "Les réglages actuels restent en place." });
  }

  async function onRemoveFavorite(id: string) {
    await deleteFavorite(id);
    setFavorites((prev) => prev.filter((f) => f.id !== id));
  }

  const connected = Boolean(link?.accountId || link?.email);

  return (
    <div className="account-page">
      <header className="account-hero">
        <p className="eyebrow">Compte BassOrder</p>
        <h1>Identité & cloud</h1>
        <p className="account-lede">
          Profil local sécurisé, connexion cloud optionnelle, et presets de
          réglages d’interface.
        </p>
      </header>

      <section className="account-identity">
        <LiveAvatar
          name={user.name}
          color={user.color}
          size="xl"
          imageUrl={user.avatarUrl}
        />
        <div>
          <strong>{user.name}</strong>
          <em>Profil local actif</em>
        </div>
      </section>

      <div className="account-grid">
        <section className="account-block">
          <h2>Cloud</h2>
          <p className="account-hint">
            API{" "}
            <span className={apiOk === true ? "is-ok" : apiOk === false ? "is-bad" : ""}>
              {apiOk === true ? "en ligne" : apiOk === false ? "hors ligne" : "…"}
            </span>
            {" · "}
            {getApiBase()}
          </p>

          {connected ? (
            <div className="account-cloud-on">
              <p>
                Connecté en tant que <strong>{link?.email ?? "compte"}</strong>
              </p>
              {link?.lastSyncAt ? (
                <p className="account-hint">
                  Dernière sync knowledge :{" "}
                  {new Date(link.lastSyncAt).toLocaleString("fr-FR", {
                    day: "2-digit",
                    month: "short",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </p>
              ) : (
                <p className="account-hint">Knowledge cloud pas encore synchronisée.</p>
              )}
              <div className="account-cloud-actions">
                <button
                  type="button"
                  className="btn-primary"
                  disabled={busy}
                  onClick={() => void onSyncKnowledge()}
                >
                  Sync knowledge
                </button>
                <button
                  type="button"
                  className="btn-ghost"
                  disabled={busy}
                  onClick={() => void onCloudDisconnect()}
                >
                  Déconnecter le cloud
                </button>
              </div>
            </div>
          ) : (
            <form className="account-form" onSubmit={(e) => void onCloudAuth(e)}>
              <div className="account-tabs" role="tablist">
                <button
                  type="button"
                  className={mode === "login" ? "is-on" : undefined}
                  onClick={() => setMode("login")}
                >
                  Connexion
                </button>
                <button
                  type="button"
                  className={mode === "register" ? "is-on" : undefined}
                  onClick={() => setMode("register")}
                >
                  Créer un compte
                </button>
              </div>
              <label>
                <span>URL API</span>
                <input
                  value={apiUrl}
                  onChange={(e) => setApiUrl(e.target.value)}
                  placeholder="http://127.0.0.1:8787"
                  autoComplete="off"
                />
              </label>
              <label>
                <span>Email</span>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  autoComplete="username"
                />
              </label>
              <label>
                <span>Mot de passe</span>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  minLength={8}
                  autoComplete={mode === "login" ? "current-password" : "new-password"}
                />
              </label>
              <button type="submit" className="btn-primary" disabled={busy}>
                {mode === "register" ? "Créer & lier" : "Se connecter"}
              </button>
              <div className="account-oauth">
                <a
                  className="btn-ghost"
                  href={cloudOAuthStartUrl("google")}
                  target="_blank"
                  rel="noreferrer"
                >
                  Google
                </a>
                <a
                  className="btn-ghost"
                  href={cloudOAuthStartUrl("discord")}
                  target="_blank"
                  rel="noreferrer"
                >
                  Discord
                </a>
              </div>
            </form>
          )}
        </section>

        <section className="account-block">
          <h2>Verrou local</h2>
          <p className="account-hint">
            {hasLocalPw
              ? "PIN / mot de passe actif (Argon2id)."
              : "Optionnel — protège ce profil sur la machine."}
          </p>
          <form className="account-form" onSubmit={(e) => void onSetLocalPin(e)}>
            {hasLocalPw && (
              <label>
                <span>Actuel</span>
                <input
                  type="password"
                  value={localPinCurrent}
                  onChange={(e) => setLocalPinCurrent(e.target.value)}
                  autoComplete="current-password"
                />
              </label>
            )}
            <label>
              <span>{hasLocalPw ? "Nouveau" : "PIN / mot de passe"}</span>
              <input
                type="password"
                value={localPin}
                onChange={(e) => setLocalPin(e.target.value)}
                minLength={6}
                autoComplete="new-password"
              />
            </label>
            <button type="submit" className="btn-primary" disabled={busy || localPin.length < 6}>
              {hasLocalPw ? "Mettre à jour" : "Activer"}
            </button>
            {hasLocalPw && (
              <button
                type="button"
                className="btn-ghost"
                disabled={busy || !localPinCurrent}
                onClick={() => void onClearLocalPin()}
              >
                Retirer le verrou
              </button>
            )}
          </form>
        </section>
      </div>

      <section className="account-block account-block--wide">
        <div className="account-block-head">
          <h2>Presets de réglages</h2>
          <button type="button" className="btn-accent" onClick={() => void onSavePreset()}>
            Sauver mes réglages
          </button>
        </div>
        <p className="account-hint">
          Snapshot des préférences d’interface (effets, volume, sons…). Applique
          un preset pour retrouver exactement la même config.
        </p>
        {presets.length === 0 && favorites.length === 0 ? (
          <p className="account-empty">
            Aucun preset pour l’instant — clique « Sauver mes réglages ».
          </p>
        ) : (
          <ul className="account-fav-list">
            {presets.map((p) => (
              <li key={p.id}>
                <span className="account-fav-kind">preset</span>
                <strong>{p.name}</strong>
                <button
                  type="button"
                  className="btn-primary"
                  onClick={() => void onApplyPreset(p)}
                >
                  Appliquer
                </button>
                <button
                  type="button"
                  className="btn-ghost"
                  onClick={() => void onRemovePreset(p.id)}
                >
                  Retirer
                </button>
              </li>
            ))}
            {favorites.map((f) => (
              <li key={f.id}>
                <span className="account-fav-kind">{f.kind}</span>
                <strong>{f.title}</strong>
                <button
                  type="button"
                  className="btn-ghost"
                  onClick={() => void onRemoveFavorite(f.id)}
                >
                  Retirer
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
