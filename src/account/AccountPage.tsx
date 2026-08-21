import { useCallback, useEffect, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { intlLocale, type AppLocale } from "../i18n";
import { DEFAULT_PREFS, usePrefs } from "../ui/prefs";
import { useExperience } from "../ui/Experience";
import { LiveAvatar } from "../users/LiveAvatar";
import { useUserSession } from "../users/UserSession";
import {
  clearCloudLink,
  cloudDisconnect,
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
  const { t, i18n } = useTranslation("account");
  const loc = intlLocale((i18n.language.startsWith("fr") ? "fr" : "en") as AppLocale);
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
        title: t("toastBadApiUrl"),
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
        title: mode === "register" ? t("toastAccountCreated") : t("toastConnected"),
        body: tokens.email,
      });
      await reload();
    } catch (err) {
      fx.toast({
        kind: "warn",
        title: t("toastCloudUnavailable"),
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
      try {
        await cloudDisconnect(user.id);
      } catch {
        await clearCloudLink(user.id);
      }
      setLink(null);
      fx.toast({
        kind: "ok",
        title: t("toastCloudDisconnected"),
        body: t("toastCloudDisconnectedBody"),
      });
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
          ? t("toastFilled", { count: result.filled })
          : "";
      fx.toast({
        kind: "ok",
        title: t("toastKnowledgeSynced"),
        body: t("toastKnowledgeSyncedBody", {
          count: result.pushed,
          pushed: result.pushed,
          filled,
        }),
      });
    } catch (err) {
      fx.toast({
        kind: "warn",
        title: t("toastSyncKnowledge"),
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
        title: t("toastLockOn"),
        body: t("toastLockOnBody"),
      });
    } catch (err) {
      fx.toast({
        kind: "warn",
        title: t("toastImpossible"),
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
      fx.toast({
        kind: "ok",
        title: t("toastLockOff"),
        body: t("toastLockOffBody"),
      });
    } catch (err) {
      fx.toast({
        kind: "warn",
        title: t("toastWrongPassword"),
        body: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setBusy(false);
    }
  }

  async function onSavePreset() {
    if (!user) return;
    const when = new Date().toLocaleString(loc, {
      day: "2-digit",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    });
    const name = t("presetName", { when });
    await upsertAccountPreset({
      userId: user.id,
      name,
      prefs: { ...prefs },
    });
    await reload();
    fx.toast({
      kind: "ok",
      title: t("toastPresetSaved"),
      body: t("toastPresetSavedBody"),
    });
  }

  async function onApplyPreset(preset: AccountPreset) {
    replace({
      ...DEFAULT_PREFS,
      ...(preset.prefs as Partial<typeof DEFAULT_PREFS>),
      locale: prefs.locale,
    });
    fx.toast({
      kind: "ok",
      title: t("toastPresetApplied"),
      body: preset.name,
    });
  }

  async function onRemovePreset(id: string) {
    await deleteAccountPreset(id);
    setPresets((prev) => prev.filter((p) => p.id !== id));
    fx.toast({
      kind: "hint",
      title: t("toastPresetRemoved"),
      body: t("toastPresetRemovedBody"),
    });
  }

  async function onRemoveFavorite(id: string) {
    await deleteFavorite(id);
    setFavorites((prev) => prev.filter((f) => f.id !== id));
  }

  const connected = Boolean(link?.accountId || link?.email);

  return (
    <div className="account-page">
      <header className="account-hero">
        <p className="eyebrow">{t("eyebrow")}</p>
        <h1>{t("title")}</h1>
        <p className="account-lede">{t("lede")}</p>
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
          <em>{t("localActive")}</em>
        </div>
      </section>

      <div className="account-grid">
        <section className="account-block">
          <h2>{t("cloud")}</h2>
          <p className="account-hint">
            API{" "}
            <span className={apiOk === true ? "is-ok" : apiOk === false ? "is-bad" : ""}>
              {apiOk === true ? t("apiOnline") : apiOk === false ? t("apiOffline") : "…"}
            </span>
            {" · "}
            {getApiBase()}
          </p>

          {connected ? (
            <div className="account-cloud-on">
              <p>
                {t("connectedAs", {
                  email: link?.email ?? t("accountFallback"),
                })}
              </p>
              {link?.lastSyncAt ? (
                <p className="account-hint">
                  {t("lastKnowledgeSync", {
                    when: new Date(link.lastSyncAt).toLocaleString(loc, {
                      day: "2-digit",
                      month: "short",
                      hour: "2-digit",
                      minute: "2-digit",
                    }),
                  })}
                </p>
              ) : (
                <p className="account-hint">{t("knowledgeNotSynced")}</p>
              )}
              <div className="account-cloud-actions">
                <button
                  type="button"
                  className="btn-primary"
                  disabled={busy}
                  onClick={() => void onSyncKnowledge()}
                >
                  {t("syncKnowledge")}
                </button>
                <button
                  type="button"
                  className="btn-ghost"
                  disabled={busy}
                  onClick={() => void onCloudDisconnect()}
                >
                  {t("disconnectCloud")}
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
                  {t("login")}
                </button>
                <button
                  type="button"
                  className={mode === "register" ? "is-on" : undefined}
                  onClick={() => setMode("register")}
                >
                  {t("register")}
                </button>
              </div>
              <label>
                <span>{t("apiUrl")}</span>
                <input
                  value={apiUrl}
                  onChange={(e) => setApiUrl(e.target.value)}
                  placeholder="http://127.0.0.1:8787"
                  autoComplete="off"
                />
              </label>
              <label>
                <span>{t("email")}</span>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  autoComplete="username"
                />
              </label>
              <label>
                <span>{t("password")}</span>
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
                {mode === "register" ? t("createAndLink") : t("signIn")}
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
          <h2>{t("localLock")}</h2>
          <p className="account-hint">
            {hasLocalPw ? t("localLockOn") : t("localLockOff")}
          </p>
          <form className="account-form" onSubmit={(e) => void onSetLocalPin(e)}>
            {hasLocalPw && (
              <label>
                <span>{t("current")}</span>
                <input
                  type="password"
                  value={localPinCurrent}
                  onChange={(e) => setLocalPinCurrent(e.target.value)}
                  autoComplete="current-password"
                />
              </label>
            )}
            <label>
              <span>{hasLocalPw ? t("newPin") : t("pinPassword")}</span>
              <input
                type="password"
                value={localPin}
                onChange={(e) => setLocalPin(e.target.value)}
                minLength={6}
                autoComplete="new-password"
              />
            </label>
            <button type="submit" className="btn-primary" disabled={busy || localPin.length < 6}>
              {hasLocalPw ? t("update") : t("activate")}
            </button>
            {hasLocalPw && (
              <button
                type="button"
                className="btn-ghost"
                disabled={busy || !localPinCurrent}
                onClick={() => void onClearLocalPin()}
              >
                {t("removeLock")}
              </button>
            )}
          </form>
        </section>
      </div>

      <section className="account-block account-block--wide">
        <div className="account-block-head">
          <h2>{t("presetsTitle")}</h2>
          <button type="button" className="btn-accent" onClick={() => void onSavePreset()}>
            {t("saveSettings")}
          </button>
        </div>
        <p className="account-hint">{t("presetsHint")}</p>
        {presets.length === 0 && favorites.length === 0 ? (
          <p className="account-empty">{t("presetsEmpty")}</p>
        ) : (
          <ul className="account-fav-list">
            {presets.map((p) => (
              <li key={p.id}>
                <span className="account-fav-kind">{t("presetKind")}</span>
                <strong>{p.name}</strong>
                <button
                  type="button"
                  className="btn-primary"
                  onClick={() => void onApplyPreset(p)}
                >
                  {t("apply")}
                </button>
                <button
                  type="button"
                  className="btn-ghost"
                  onClick={() => void onRemovePreset(p.id)}
                >
                  {t("remove")}
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
                  {t("remove")}
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
