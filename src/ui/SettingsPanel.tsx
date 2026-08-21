import { useEffect, useState } from "react";
import { dbGetPath, dbRevealPath, isTauri } from "../db";
import { playNotify, unlockAudio } from "./sounds";
import {
  DEFAULT_PREFS,
  isFxMuted,
  usePrefs,
  type Prefs,
} from "./prefs";
import { SettingsSkeleton } from "./skeleton";
import { usePaintSkeleton } from "./usePaintSkeleton";

type Props = {
  open: boolean;
  onClose: () => void;
};

export function SettingsPanel({ open, onClose }: Props) {
  const { prefs, patch, reset, muteFx, unmuteFx } = usePrefs();
  const muted = isFxMuted(prefs);

  useEffect(() => {
    if (!open) {
      return;
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) {
    return null;
  }

  return (
    <div className="settings-overlay" role="dialog" aria-modal="true" aria-label="Paramètres">
      <button type="button" className="settings-backdrop" onClick={onClose} aria-label="Fermer" />
      <aside className="settings-sheet">
        <header className="settings-top">
          <div>
            <p className="eyebrow">Machine</p>
            <h2>Paramètres</h2>
          </div>
          <button type="button" className="btn-ghost" onClick={onClose}>
            Fermer
          </button>
        </header>
        <SettingsSheetBody
          prefs={prefs}
          muted={muted}
          patch={patch}
          reset={reset}
          muteFx={muteFx}
          unmuteFx={unmuteFx}
        />
      </aside>
    </div>
  );
}

function SettingsSheetBody({
  prefs,
  muted,
  patch,
  reset,
  muteFx,
  unmuteFx,
}: {
  prefs: Prefs;
  muted: boolean;
  patch: (partial: Partial<Prefs>) => void;
  reset: () => void;
  muteFx: () => void;
  unmuteFx: () => void;
}) {
  const paintSkel = usePaintSkeleton(140);
  if (paintSkel) {
    return <SettingsSkeleton />;
  }

  return (
    <>
      <section
        className={`settings-fx-master${muted ? " is-perf" : " is-show"}`}
        aria-label="Mode effets"
      >
        <div className="settings-fx-master-glow" aria-hidden />
        <div className="settings-fx-master-copy">
          <p className="eyebrow">{muted ? "Mode perf" : "Mode spectacle"}</p>
          <strong>{muted ? "Animations coupées" : "Tout allumé"}</strong>
          <em>
            {muted
              ? "Curseur, EQ, cadres, sons — off. Clique Spectacle pour tout remettre."
              : "Un clic sur Perf coupe tout d’un coup. Tu peux retoucher ensuite."}
          </em>
        </div>
        <div
          className="settings-fx-switch"
          role="group"
          aria-label="Basculer les effets"
        >
          <span
            className="settings-fx-thumb"
            aria-hidden
            data-side={muted ? "perf" : "show"}
          />
          <button
            type="button"
            className={!muted ? "is-active" : undefined}
            aria-pressed={!muted}
            onClick={() => {
              unmuteFx();
              unlockAudio();
              playNotify("go", prefs.volume || DEFAULT_PREFS.volume);
            }}
          >
            <span className="settings-fx-ico" aria-hidden>
              ✦
            </span>
            Spectacle
          </button>
          <button
            type="button"
            className={muted ? "is-active" : undefined}
            aria-pressed={muted}
            onClick={() => muteFx()}
          >
            <span className="settings-fx-ico" aria-hidden>
              ◆
            </span>
            Perf
          </button>
        </div>
      </section>

      <section className="settings-block">
        <h3>Effets visuels</h3>
        <Toggle
          label="Curseur magnétique"
          hint="Halo lumineux + anneau. Sans traînée laser."
          checked={prefs.cursor}
          onChange={(cursor) => patch({ cursor })}
        />
        <Toggle
          label="Impacts au clic"
          hint="Flash, ripples et étincelles"
          checked={prefs.particles}
          onChange={(particles) => patch({ particles })}
        />
        <Toggle
          label="Cadres animés"
          hint="Filet lumineux et respiration des groupes"
          checked={prefs.frames}
          onChange={(frames) => patch({ frames })}
        />
        <Toggle
          label="Lueur des boutons"
          hint="Anneau or / mint qui tourne"
          checked={prefs.shine}
          onChange={(shine) => patch({ shine })}
        />
        <Toggle
          label="Fond atmosphère"
          hint="Orbes et grille. Sans grain (noir OLED)."
          checked={prefs.background}
          onChange={(background) => patch({ background })}
        />
        <Toggle
          label="Effets du rail"
          hint="Scan, pulse et EQ du menu gauche (pas la navigation)"
          checked={prefs.rail}
          onChange={(rail) => patch({ rail })}
        />
        <Toggle
          label="Texte scramble"
          hint="Décodage au survol des titres"
          checked={prefs.scramble}
          onChange={(scramble) => patch({ scramble })}
        />
        <Toggle
          label="Interactions jouables"
          hint="Springs / idle des EQ et barres. Le drag reste toujours actif."
          checked={prefs.playful}
          onChange={(playful) => patch({ playful })}
        />
        <label className="settings-slider">
          <span>
            Intensité des effets
            <em>{Math.round(prefs.intensity * 100)}%</em>
          </span>
          <input
            type="range"
            min={0.35}
            max={1.4}
            step={0.05}
            value={prefs.intensity}
            onChange={(e) => patch({ intensity: Number(e.target.value) })}
          />
        </label>
      </section>

      <section className="settings-block">
        <h3>Lecture</h3>
        <label className="settings-slider">
          <span>
            Volume de la musique
            <em>{Math.round(prefs.musicVolume * 100)}%</em>
          </span>
          <input
            type="range"
            min={0}
            max={1}
            step={0.02}
            value={prefs.musicVolume}
            onChange={(e) => patch({ musicVolume: Number(e.target.value) })}
          />
        </label>
      </section>

      <section className="settings-block">
        <h3>Notifications</h3>
        <Toggle
          label="Toasts à l’écran"
          hint="Messages en bas à droite"
          checked={prefs.toasts}
          onChange={(toasts) => patch({ toasts })}
        />
        <Toggle
          label="Son « poc »"
          hint="Petit clic à chaque notification"
          checked={prefs.sounds}
          onChange={(sounds) => {
            patch({ sounds });
            if (sounds) {
              unlockAudio();
              playNotify("ok", prefs.volume);
            }
          }}
        />
        <label className="settings-slider">
          <span>
            Volume des toasts
            <em>{Math.round(prefs.volume * 100)}%</em>
          </span>
          <input
            type="range"
            min={0}
            max={1}
            step={0.02}
            value={prefs.volume}
            disabled={!prefs.sounds}
            onChange={(e) => patch({ volume: Number(e.target.value) })}
          />
        </label>
        <label className="settings-select">
          <span>Durée des toasts</span>
          <select
            value={prefs.toastMs}
            onChange={(e) => patch({ toastMs: Number(e.target.value) as Prefs["toastMs"] })}
          >
            <option value={5000}>Court — 5 s</option>
            <option value={12000}>Normal — 12 s</option>
            <option value={20000}>Long — 20 s</option>
          </select>
        </label>
        <button
          type="button"
          className="btn-accent"
          onClick={() => {
            unlockAudio();
            playNotify("go", prefs.volume);
          }}
        >
          Tester le son
        </button>
      </section>

      <footer className="settings-actions">
        <DbRevealButton />
        <button
          type="button"
          className="btn-ghost"
          onClick={() => {
            reset();
            playNotify("ok", DEFAULT_PREFS.volume);
          }}
        >
          Réinitialiser tout
        </button>
      </footer>
    </>
  );
}

function DbRevealButton() {
  const [path, setPath] = useState<string | null>(null);
  useEffect(() => {
    if (!isTauri()) return;
    void dbGetPath().then(setPath).catch(() => setPath(null));
  }, []);
  if (!isTauri()) return null;
  return (
    <section className="settings-block" style={{ marginBottom: "1rem" }}>
      <h3>Base locale</h3>
      <p style={{ opacity: 0.7, fontSize: "0.85rem", marginBottom: "0.75rem" }}>
        Fichier SQLite <code>bassorder.db</code>
        {path ? (
          <>
            {" "}
            — <code style={{ wordBreak: "break-all" }}>{path}</code>
          </>
        ) : null}
        . Ferme BassOrder avant d’éditer avec DB Browser.
      </p>
      <button
        type="button"
        className="btn-accent"
        onClick={() => {
          void dbRevealPath();
        }}
      >
        Ouvrir le dossier de la base
      </button>
    </section>
  );
}

function Toggle({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string;
  hint: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <button
      type="button"
      className={`settings-toggle${checked ? " is-on" : ""}`}
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
    >
      <span>
        <strong>{label}</strong>
        <em>{hint}</em>
      </span>
      <i aria-hidden />
    </button>
  );
}
