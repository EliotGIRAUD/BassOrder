import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { SpaceAccountPanels } from "../account/SpaceAccountPanels";
import { intlLocale, type AppLocale } from "../i18n";
import { listLibraries } from "../local/libraryCache";
import { listImports } from "../spotify/importCache";
import { listProfiles } from "../spotify/profiles";
import { MagneticField } from "../ui/fx";
import { useExperience } from "../ui/Experience";
import { ProfilePageSkeleton } from "../ui/skeleton";
import { usePaintSkeleton } from "../ui/usePaintSkeleton";
import { ProfileAura } from "./ProfileAura";
import { USER_COLORS } from "./types";
import { useUserSession } from "./UserSession";

type Props = {
  onLeave: () => void;
};

/** Identité locale + sécurité/cloud/presets — une seule page « Mon espace ». */
export function SpacePage({ onLeave }: Props) {
  const { t, i18n } = useTranslation("profile");
  const { t: tc } = useTranslation("common");
  const loc = intlLocale((i18n.language.startsWith("fr") ? "fr" : "en") as AppLocale);
  const { user, rename, recolor, setAvatar, remove, leave } = useUserSession();
  const fx = useExperience();
  const paintSkel = usePaintSkeleton(200);
  const [draft, setDraft] = useState(user?.name ?? "");
  const [confirmWipe, setConfirmWipe] = useState(false);

  useEffect(() => {
    setDraft(user?.name ?? "");
  }, [user?.name]);

  const stats = useMemo(() => {
    return {
      libraries: listLibraries().length,
      imports: listImports().length,
      spotifyProfiles: listProfiles().length,
    };
  }, [user?.id, user?.avatarUrl]);

  const spotifyAvatars = useMemo(() => {
    const seen = new Set<string>();
    const out: { url: string; label: string }[] = [];
    for (const p of listProfiles()) {
      const url = p.avatarUrl?.trim();
      if (!url || seen.has(url)) {
        continue;
      }
      seen.add(url);
      out.push({
        url,
        label: p.displayName || p.name || "Spotify",
      });
    }
    return out;
  }, [user?.id, user?.avatarUrl]);

  if (!user) {
    return null;
  }

  function onRename(event: FormEvent) {
    event.preventDefault();
    const next = draft.trim();
    if (next.length < 2) {
      fx.toast({
        kind: "warn",
        title: t("toastShortName"),
        body: t("toastShortNameBody"),
      });
      return;
    }
    rename(user!.id, next);
    fx.toast({
      kind: "ok",
      title: t("toastRenamed"),
      body: t("toastRenamedBody", { name: next }),
    });
  }

  function onColor(color: string) {
    recolor(user!.id, color);
    fx.toast({
      kind: "hint",
      title: t("toastColor"),
      body: t("toastColorBody"),
    });
  }

  function onPickAvatar(url: string | null) {
    void setAvatar(user!.id, url).then(() => {
      fx.toast({
        kind: "ok",
        title: url ? t("toastPhoto") : t("toastMonogram"),
        body: url ? t("toastPhotoBody") : t("toastMonogramBody"),
      });
    });
  }

  function onLock() {
    leave();
    onLeave();
  }

  function onDelete() {
    if (!confirmWipe) {
      setConfirmWipe(true);
      return;
    }
    remove(user!.id);
    fx.toast({
      kind: "warn",
      title: t("toastWiped"),
      body: t("toastWipedBody"),
    });
    onLeave();
  }

  if (paintSkel) {
    return (
      <section className="profile-page space-page local-stage">
        <ProfilePageSkeleton />
      </section>
    );
  }

  return (
    <section
      className="profile-page space-page local-stage"
      style={{ ["--user-color" as string]: user.color }}
    >
      <header className="local-topbar">
        <div className="local-topbar-copy">
          <p className="eyebrow">{t("eyebrow")}</p>
          <h2>{t("title", { name: user.name })}</h2>
          <p className="local-lede">{t("lede")}</p>
        </div>
      </header>

      <div className="profile-hero fx-frame fx-frame--loud">
        <span className="spin-border" aria-hidden />
        <ProfileAura
          name={user.name}
          color={user.color}
          size={240}
          imageUrl={user.avatarUrl}
        />
        <div className="profile-hero-copy">
          <p className="profile-kicker">{t("identity")}</p>
          <h3>{user.name}</h3>
          <p className="profile-identity-hint">{t("identityHint")}</p>
          <p>
            {t("createdOn", {
              date: new Date(user.createdAt).toLocaleDateString(loc, {
                day: "numeric",
                month: "long",
                year: "numeric",
              }),
            })}
            {t("lastSession", {
              when: new Date(user.lastUsedAt).toLocaleString(loc, {
                day: "numeric",
                month: "short",
                hour: "2-digit",
                minute: "2-digit",
              }),
            })}
          </p>
        </div>
      </div>

      <div className="profile-grid">
        <form
          className="profile-card profile-card--pseudo fx-frame fx-frame--mid"
          onSubmit={onRename}
        >
          <span className="spin-border" aria-hidden />
          <h3>{t("pseudoTitle")}</h3>
          <p>{t("pseudoHelp")}</p>
          <div className="profile-pseudo-row">
            <label className="profile-field profile-field--grow">
              <span>{t("pseudoLabel")}</span>
              <input
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                maxLength={24}
                autoComplete="nickname"
                spellCheck={false}
              />
            </label>
            <button type="submit" className="btn-primary profile-pseudo-save">
              {t("save")}
            </button>
          </div>
        </form>

        <div className="profile-card fx-frame fx-frame--mid">
          <span className="spin-border" aria-hidden />
          <h3>{t("photoTitle")}</h3>
          <p>
            {spotifyAvatars.length > 0 ? t("photoHelpHas") : t("photoHelpEmpty")}
          </p>
          <div className="profile-avatar-picks" role="list">
            <button
              type="button"
              role="listitem"
              className={`profile-avatar-pick${!user.avatarUrl ? " is-active" : ""}`}
              onClick={() => onPickAvatar(null)}
              title={t("monogramTitle")}
              aria-label={t("monogramAria")}
            >
              <ProfileAura
                name={user.name}
                color={user.color}
                size={52}
                compact
                interactive={false}
              />
            </button>
            {spotifyAvatars.map((item) => (
              <button
                key={item.url}
                type="button"
                role="listitem"
                className={`profile-avatar-pick${user.avatarUrl === item.url ? " is-active" : ""}`}
                onClick={() => onPickAvatar(item.url)}
                title={item.label}
                aria-label={t("photoAria", { label: item.label })}
              >
                <ProfileAura
                  name={item.label}
                  color={user.color}
                  size={52}
                  compact
                  interactive={false}
                  imageUrl={item.url}
                />
              </button>
            ))}
          </div>
        </div>

        <div className="profile-card fx-frame fx-frame--mid">
          <span className="spin-border" aria-hidden />
          <h3>{t("colorTitle")}</h3>
          <p>{t("colorHelp")}</p>
          <MagneticField className="profile-swatches" strength={34} radius={120}>
            {USER_COLORS.map((c) => (
              <button
                key={c}
                type="button"
                className={`mag-node profile-swatch${user.color === c ? " is-active" : ""}`}
                style={{ ["--swatch" as string]: c }}
                onClick={() => onColor(c)}
                title={c}
                aria-label={t("colorAria", { hex: c })}
              />
            ))}
          </MagneticField>
        </div>

        <div className="profile-card fx-frame fx-frame--mid profile-stats">
          <span className="spin-border" aria-hidden />
          <h3>{t("statsTitle")}</h3>
          <dl>
            <div>
              <dt>{t("statLocal")}</dt>
              <dd>{stats.libraries}</dd>
            </div>
            <div>
              <dt>{t("statImports")}</dt>
              <dd>{stats.imports}</dd>
            </div>
            <div>
              <dt>{t("statAccounts")}</dt>
              <dd>{stats.spotifyProfiles}</dd>
            </div>
          </dl>
        </div>
      </div>

      <details className="space-fold fx-frame fx-frame--mid">
        <summary className="space-fold-summary">
          <span className="spin-border" aria-hidden />
          <strong>{t("foldTitle")}</strong>
          <em>{t("foldHint")}</em>
        </summary>
        <div className="space-fold-body">
          <SpaceAccountPanels />
        </div>
      </details>

      <footer className="profile-actions">
        <button type="button" className="btn-ghost" onClick={onLock}>
          {t("lock")}
        </button>
        <button
          type="button"
          className={`btn-ghost profile-danger${confirmWipe ? " is-confirm" : ""}`}
          onClick={onDelete}
        >
          {confirmWipe ? t("confirmDelete") : t("resetSpace")}
        </button>
        {confirmWipe && (
          <button
            type="button"
            className="btn-ghost"
            onClick={() => setConfirmWipe(false)}
          >
            {tc("cancel")}
          </button>
        )}
      </footer>
    </section>
  );
}
