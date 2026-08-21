import { useEffect, useMemo, useState, type FormEvent } from "react";
import { listLibraries } from "../local/libraryCache";
import { listImports } from "../spotify/importCache";
import { listProfiles } from "../spotify/profiles";
import { MagneticField, OrbitField } from "../ui/fx";
import { useExperience } from "../ui/Experience";
import { ProfilePageSkeleton } from "../ui/skeleton";
import { usePaintSkeleton } from "../ui/usePaintSkeleton";
import { ProfileAura } from "./ProfileAura";
import { USER_COLORS } from "./types";
import { useUserSession } from "./UserSession";

type Props = {
  onLeave: () => void;
};

export function ProfilePage({ onLeave }: Props) {
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
        title: "Pseudo trop court",
        body: "Au moins 2 caractères.",
      });
      return;
    }
    rename(user!.id, next);
    fx.toast({
      kind: "ok",
      title: "Pseudo mis à jour",
      body: `Tu es maintenant « ${next} ».`,
    });
  }

  function onColor(color: string) {
    recolor(user!.id, color);
    fx.toast({
      kind: "hint",
      title: "Couleur changée",
      body: "Ton avatar suit la nouvelle teinte.",
    });
  }

  function onPickAvatar(url: string | null) {
    void setAvatar(user!.id, url).then(() => {
      fx.toast({
        kind: "ok",
        title: url ? "Photo de profil" : "Monogramme",
        body: url
          ? "Ta PP Spotify est maintenant ton avatar BassOrder."
          : "Retour à l’avatar couleur + initiales.",
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
      title: "Espace effacé",
      body: "Tu pourras recréer un pseudo au prochain lancement.",
    });
    onLeave();
  }

  if (paintSkel) {
    return (
      <section className="profile-page local-stage">
        <ProfilePageSkeleton />
      </section>
    );
  }

  return (
    <section className="profile-page local-stage">
      <header className="local-topbar">
        <div className="local-topbar-copy">
          <p className="eyebrow">Profil BassOrder</p>
          <h2>Hey, {user.name}</h2>
          <p className="local-lede">
            Ton espace local : pseudo, couleur, photo, et un petit terrain de jeu.
            Rien n’est synchronisé dans le cloud — tout reste sur cette machine.
          </p>
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
          <p className="profile-kicker">Identité locale</p>
          <h3>{user.name}</h3>
          <p>
            Créé le{" "}
            {new Date(user.createdAt).toLocaleDateString("fr-FR", {
              day: "numeric",
              month: "long",
              year: "numeric",
            })}
            {" · "}
            dernière session{" "}
            {new Date(user.lastUsedAt).toLocaleString("fr-FR", {
              day: "numeric",
              month: "short",
              hour: "2-digit",
              minute: "2-digit",
            })}
          </p>
        </div>
      </div>

      <div className="profile-grid">
        <form className="profile-card fx-frame fx-frame--mid" onSubmit={onRename}>
          <span className="spin-border" aria-hidden />
          <h3>Pseudo</h3>
          <p>Change ton nom d’affichage dans le rail et la gate.</p>
          <label className="profile-field">
            <span>Ton pseudo</span>
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              maxLength={24}
              autoComplete="nickname"
              spellCheck={false}
            />
          </label>
          <button type="submit" className="btn-primary">
            Enregistrer
          </button>
        </form>

        <div className="profile-card fx-frame fx-frame--mid">
          <span className="spin-border" aria-hidden />
          <h3>Photo de profil</h3>
          <p>
            {spotifyAvatars.length > 0
              ? "Choisis une PP Spotify, ou reviens au monogramme."
              : "Connecte Spotify pour proposer ta photo de profil."}
          </p>
          <div className="profile-avatar-picks" role="list">
            <button
              type="button"
              role="listitem"
              className={`profile-avatar-pick${!user.avatarUrl ? " is-active" : ""}`}
              onClick={() => onPickAvatar(null)}
              title="Monogramme"
              aria-label="Utiliser le monogramme"
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
                aria-label={`Utiliser la photo de ${item.label}`}
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
          <h3>Couleur</h3>
          <p>Approche le curseur — les pastilles se collent à toi.</p>
          <MagneticField className="profile-swatches" strength={34} radius={120}>
            {USER_COLORS.map((c) => (
              <button
                key={c}
                type="button"
                className={`mag-node profile-swatch${user.color === c ? " is-active" : ""}`}
                style={{ ["--swatch" as string]: c }}
                onClick={() => onColor(c)}
                title={c}
                aria-label={`Couleur ${c}`}
              />
            ))}
          </MagneticField>
        </div>

        <div className="profile-card fx-frame fx-frame--mid profile-stats">
          <span className="spin-border" aria-hidden />
          <h3>Sur cette machine</h3>
          <dl>
            <div>
              <dt>Analyses locales</dt>
              <dd>{stats.libraries}</dd>
            </div>
            <div>
              <dt>Imports Spotify</dt>
              <dd>{stats.imports}</dd>
            </div>
            <div>
              <dt>Comptes Spotify</dt>
              <dd>{stats.spotifyProfiles}</dd>
            </div>
          </dl>
        </div>
      </div>

      <div className="profile-playground fx-frame fx-frame--soft">
        <span className="spin-border" aria-hidden />
        <div className="profile-playground-head">
          <h3>Terrain orbital</h3>
          <p>Fling les nœuds — gravité + collisions soft (style 2026).</p>
        </div>
        <OrbitField
          labels={["YOU", "TAGS", "LIKES", "MP3", "GENRE", "SYNC", "BASS", "ORDER"]}
          height={200}
        />
      </div>

      <footer className="profile-actions">
        <button type="button" className="btn-ghost" onClick={onLock}>
          Verrouiller
        </button>
        <button
          type="button"
          className={`btn-ghost profile-danger${confirmWipe ? " is-confirm" : ""}`}
          onClick={onDelete}
        >
          {confirmWipe ? "Confirmer la suppression" : "Réinitialiser l’espace"}
        </button>
        {confirmWipe && (
          <button
            type="button"
            className="btn-ghost"
            onClick={() => setConfirmWipe(false)}
          >
            Annuler
          </button>
        )}
      </footer>
    </section>
  );
}
