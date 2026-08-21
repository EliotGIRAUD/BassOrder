import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type { AppLocale } from "../i18n";
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
  const { t } = useTranslation("settings");
  const { t: tc } = useTranslation("common");
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
    <div className="settings-overlay" role="dialog" aria-modal="true" aria-label={t("dialogAria")}>
      <button type="button" className="settings-backdrop" onClick={onClose} aria-label={tc("close")} />
      <aside className="settings-sheet">
        <header className="settings-top">
          <div>
            <p className="eyebrow">{t("eyebrow")}</p>
            <h2>{t("title")}</h2>
          </div>
          <button type="button" className="btn-ghost" onClick={onClose}>
            {tc("close")}
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
  const { t } = useTranslation("settings");
  const paintSkel = usePaintSkeleton(140);
  if (paintSkel) {
    return <SettingsSkeleton />;
  }

  return (
    <>
      <section className="settings-block">
        <h3>{t("language")}</h3>
        <p style={{ opacity: 0.7, fontSize: "0.85rem", marginBottom: "0.75rem" }}>
          {t("languageHint")}
        </p>
        <label className="settings-select">
          <span>{t("language")}</span>
          <select
            value={prefs.locale}
            onChange={(e) =>
              patch({ locale: e.target.value as AppLocale })
            }
          >
            <option value="en">{t("langEn")}</option>
            <option value="fr">{t("langFr")}</option>
          </select>
        </label>
      </section>

      <section
        className={`settings-fx-master${muted ? " is-perf" : " is-show"}`}
        aria-label={t("fxMasterAria")}
      >
        <div className="settings-fx-master-glow" aria-hidden />
        <div className="settings-fx-master-copy">
          <p className="eyebrow">{muted ? t("modePerf") : t("modeShow")}</p>
          <strong>{muted ? t("fxOffTitle") : t("fxOnTitle")}</strong>
          <em>{muted ? t("fxOffHint") : t("fxOnHint")}</em>
        </div>
        <div
          className="settings-fx-switch"
          role="group"
          aria-label={t("fxSwitchAria")}
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
            {t("spectacle")}
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
            {t("perf")}
          </button>
        </div>
      </section>

      <section className="settings-block">
        <h3>{t("visualEffects")}</h3>
        <Toggle
          label={t("cursor")}
          hint={t("cursorHint")}
          checked={prefs.cursor}
          onChange={(cursor) => patch({ cursor })}
        />
        <Toggle
          label={t("particles")}
          hint={t("particlesHint")}
          checked={prefs.particles}
          onChange={(particles) => patch({ particles })}
        />
        <Toggle
          label={t("frames")}
          hint={t("framesHint")}
          checked={prefs.frames}
          onChange={(frames) => patch({ frames })}
        />
        <Toggle
          label={t("shine")}
          hint={t("shineHint")}
          checked={prefs.shine}
          onChange={(shine) => patch({ shine })}
        />
        <Toggle
          label={t("background")}
          hint={t("backgroundHint")}
          checked={prefs.background}
          onChange={(background) => patch({ background })}
        />
        <Toggle
          label={t("rail")}
          hint={t("railHint")}
          checked={prefs.rail}
          onChange={(rail) => patch({ rail })}
        />
        <Toggle
          label={t("scramble")}
          hint={t("scrambleHint")}
          checked={prefs.scramble}
          onChange={(scramble) => patch({ scramble })}
        />
        <Toggle
          label={t("playful")}
          hint={t("playfulHint")}
          checked={prefs.playful}
          onChange={(playful) => patch({ playful })}
        />
        <label className="settings-slider">
          <span>
            {t("intensity")}
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
        <h3>{t("playback")}</h3>
        <label className="settings-slider">
          <span>
            {t("musicVolume")}
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
        <h3>{t("notifications")}</h3>
        <Toggle
          label={t("toasts")}
          hint={t("toastsHint")}
          checked={prefs.toasts}
          onChange={(toasts) => patch({ toasts })}
        />
        <Toggle
          label={t("sounds")}
          hint={t("soundsHint")}
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
            {t("toastVolume")}
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
          <span>{t("toastDuration")}</span>
          <select
            value={prefs.toastMs}
            onChange={(e) => patch({ toastMs: Number(e.target.value) as Prefs["toastMs"] })}
          >
            <option value={5000}>{t("toastShort")}</option>
            <option value={12000}>{t("toastNormal")}</option>
            <option value={20000}>{t("toastLong")}</option>
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
          {t("testSound")}
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
          {t("resetAll")}
        </button>
      </footer>
    </>
  );
}

function DbRevealButton() {
  const { t } = useTranslation("settings");
  const [path, setPath] = useState<string | null>(null);
  useEffect(() => {
    if (!isTauri()) return;
    void dbGetPath().then(setPath).catch(() => setPath(null));
  }, []);
  if (!isTauri()) return null;
  return (
    <section className="settings-block" style={{ marginBottom: "1rem" }}>
      <h3>{t("localDb")}</h3>
      <p style={{ opacity: 0.7, fontSize: "0.85rem", marginBottom: "0.75rem" }}>
        {t("localDbHint", {
          path: path ? ` — ${path}` : "",
        })}
      </p>
      <button
        type="button"
        className="btn-accent"
        onClick={() => {
          void dbRevealPath();
        }}
      >
        {t("openDbFolder")}
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
