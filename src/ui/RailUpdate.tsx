import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { isTauri } from "../local/api";
import { useExperience } from "./Experience";
import { TipPanel } from "./AppTip";

type Phase = "idle" | "checking" | "ready" | "downloading" | "error";

const POLL_MS = 30 * 60 * 1000;

export function RailUpdateButton({ locked }: { locked: boolean }) {
  const { t } = useTranslation("nav");
  const fx = useExperience();
  const [phase, setPhase] = useState<Phase>("idle");
  const [version, setVersion] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const updateRef = useRef<Update | null>(null);
  const busy = phase === "checking" || phase === "downloading";

  const probe = useCallback(async () => {
    if (!isTauri() || locked || busy) {
      return;
    }
    setPhase("checking");
    try {
      const update = await check();
      if (update) {
        updateRef.current = update;
        setVersion(update.version);
        setPhase("ready");
      } else {
        updateRef.current = null;
        setVersion(null);
        setPhase("idle");
      }
    } catch {
      updateRef.current = null;
      setVersion(null);
      setPhase("idle");
    }
  }, [busy, locked]);

  useEffect(() => {
    if (!isTauri() || locked) {
      return;
    }
    void probe();
    const id = window.setInterval(() => void probe(), POLL_MS);
    return () => window.clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- boot + interval only
  }, [locked]);

  const install = useCallback(async () => {
    if (locked || busy) {
      return;
    }
    let update = updateRef.current;
    if (!update) {
      setPhase("checking");
      try {
        update = await check();
      } catch {
        setPhase("error");
        fx.toast({
          kind: "warn",
          title: t("updateFailTitle"),
          body: t("updateFailBody"),
        });
        return;
      }
      if (!update) {
        setPhase("idle");
        fx.toast({
          kind: "ok",
          title: t("updateCurrentTitle"),
          body: t("updateCurrentBody"),
        });
        return;
      }
      updateRef.current = update;
      setVersion(update.version);
    }

    setPhase("downloading");
    setProgress(0);
    fx.toast({
      kind: "ok",
      title: t("updateDownloadingTitle"),
      body: t("updateDownloadingBody", { version: update.version }),
    });

    let downloaded = 0;
    let total = 0;
    try {
      await update.downloadAndInstall((event) => {
        if (event.event === "Started") {
          total = event.data.contentLength ?? 0;
          downloaded = 0;
          setProgress(0);
        } else if (event.event === "Progress") {
          downloaded += event.data.chunkLength;
          if (total > 0) {
            setProgress(Math.min(99, Math.round((downloaded / total) * 100)));
          }
        } else if (event.event === "Finished") {
          setProgress(100);
        }
      });
      // Windows quitte déjà l’app ; macOS / Linux relancent.
      await relaunch();
    } catch {
      setPhase("error");
      fx.toast({
        kind: "warn",
        title: t("updateFailTitle"),
        body: t("updateFailBody"),
      });
    }
  }, [busy, fx, locked, t]);

  if (!isTauri()) {
    return null;
  }

  const label =
    phase === "downloading"
      ? t("updateProgress", { pct: progress })
      : phase === "ready"
        ? t("updateAvailable", { version: version ?? "" })
        : phase === "checking"
          ? t("updateChecking")
          : t("update");

  return (
    <button
      type="button"
      className={`rail-btn rail-update${phase === "ready" ? " is-ready" : ""}${phase === "downloading" ? " is-busy" : ""}${phase === "error" ? " is-error" : ""}`}
      onClick={() => void install()}
      disabled={locked || busy}
      aria-label={
        phase === "ready"
          ? t("updateAvailableAria", { version: version ?? "" })
          : t("updateAria")
      }
      tabIndex={locked ? -1 : 0}
    >
      <UpdateIcon spinning={busy} />
      <span className="rail-btn-label">{label}</span>
      {phase === "ready" && <span className="rail-update-dot" aria-hidden />}
      {phase === "downloading" && (
        <span
          className="rail-update-bar"
          style={{ width: `${Math.max(8, progress)}%` }}
          aria-hidden
        />
      )}
      <TipPanel>
        {phase === "ready"
          ? t("updateReadyTip", { version: version ?? "" })
          : t("updateTip")}
      </TipPanel>
    </button>
  );
}

function UpdateIcon({ spinning }: { spinning: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden
      className={spinning ? "rail-update-spin" : undefined}
    >
      <path
        d="M4.5 12a7.5 7.5 0 0 1 12.8-5.3M19.5 12a7.5 7.5 0 0 1-12.8 5.3"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
      <path
        d="M17 4.5v3.2h-3.2M7 19.5v-3.2h3.2"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
