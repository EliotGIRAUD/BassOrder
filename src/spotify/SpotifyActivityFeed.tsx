import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { intlLocale, type AppLocale } from "../i18n";
import { PushFill } from "../ui/push";
import { TermMorphCaret } from "../ui/TermMorphCaret";
import type { SpotifySyncProgress } from "./types";

type Mode = "sync" | "enrich";
type EnrichPhase =
  | "enrich"
  | "artists"
  | "related"
  | "catalog"
  | "itunes"
  | "musicbrainz"
  | "done";

type Props = {
  mode: Mode;
  progress: SpotifySyncProgress | null;
  startedAt: number;
};

/** Poids cumulés pour une barre « globale » (évite les reset 100%→0% entre étapes). */
const PHASE_SPAN: Record<string, { start: number; weight: number }> = {
  enrich: { start: 0, weight: 0.02 },
  artists: { start: 0.02, weight: 0.38 },
  related: { start: 0.4, weight: 0.28 },
  catalog: { start: 0.68, weight: 0.18 },
  itunes: { start: 0.68, weight: 0.18 },
  musicbrainz: { start: 0.86, weight: 0.14 },
  done: { start: 1, weight: 0 },
};

const TIP_BANK_KEYS = [
  "sync",
  "enrich",
  "artists",
  "related",
  "catalog",
  "musicbrainz",
  "done",
] as const;

export function SpotifyActivityFeed({ mode, progress, startedAt }: Props) {
  const { t, i18n } = useTranslation("spotify");
  const loc = intlLocale((i18n.language.startsWith("fr") ? "fr" : "en") as AppLocale);
  const enrichSteps = [
    { id: "artists" as const, label: t("feedStep1") },
    { id: "related" as const, label: t("feedStep2") },
    { id: "catalog" as const, label: t("feedStep3") },
    { id: "musicbrainz" as const, label: t("feedStep4") },
  ];
  const [tipIndex, setTipIndex] = useState(0);
  const [typed, setTyped] = useState("");
  const [now, setNow] = useState(() => Date.now());
  const [logPulse, setLogPulse] = useState(0);
  const [smoothPct, setSmoothPct] = useState(0);
  const rateSamples = useRef<{ t: number; overall: number }[]>([]);

  const phaseKey = useMemo(() => resolveTipBank(mode, progress?.phase), [mode, progress?.phase]);
  const tips = useMemo(() => {
    const bank = t(`tipBank.${phaseKey}`, { returnObjects: true });
    if (Array.isArray(bank) && bank.every((line) => typeof line === "string")) {
      return bank as string[];
    }
    const fallback = t("tipBank.enrich", { returnObjects: true });
    return Array.isArray(fallback) ? (fallback as string[]) : [];
  }, [t, phaseKey, i18n.language]);

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    setTipIndex(0);
  }, [phaseKey]);

  useEffect(() => {
    const id = window.setInterval(() => {
      setTipIndex((value) => value + 1);
      setLogPulse((value) => value + 1);
    }, 2800);
    return () => window.clearInterval(id);
  }, [phaseKey]);

  const phaseInfo = useMemo(() => describePhase(mode, progress, t), [mode, progress, t]);
  const liveLabel = progress?.label?.trim() || phaseInfo.headline;

  useEffect(() => {
    setTyped("");
    let i = 0;
    const text = liveLabel;
    const id = window.setInterval(() => {
      i += 1;
      setTyped(text.slice(0, i));
      if (i >= text.length) {
        window.clearInterval(id);
      }
    }, 12);
    return () => window.clearInterval(id);
  }, [liveLabel]);

  const rawPercent = useMemo(
    () => overallJobPercent(mode, progress),
    [mode, progress],
  );

  useEffect(() => {
    if (rawPercent == null) {
      return;
    }
    let raf = 0;
    const tick = () => {
      setSmoothPct((prev) => {
        const delta = rawPercent - prev;
        if (Math.abs(delta) < 0.15) {
          return rawPercent;
        }
        const step = delta > 0 ? Math.max(0.35, delta * 0.12) : delta * 0.04;
        return Math.max(0, Math.min(100, prev + step));
      });
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [rawPercent]);

  useEffect(() => {
    if (rawPercent == null) {
      return;
    }
    const sampleAt = Date.now();
    rateSamples.current.push({ t: sampleAt, overall: rawPercent });
    rateSamples.current = rateSamples.current.filter((s) => sampleAt - s.t < 45_000);
  }, [rawPercent]);

  const percent = rawPercent == null ? null : Math.round(smoothPct);
  const elapsedSec = Math.max(0, Math.floor((now - startedAt) / 1000));

  const etaLabel = useMemo(() => {
    if (rawPercent == null || rawPercent >= 99.5 || elapsedSec < 6) {
      return null;
    }
    const samples = rateSamples.current;
    if (samples.length < 2) {
      return null;
    }
    const latest = samples[samples.length - 1];
    const windowStart = samples.find((s) => latest.t - s.t >= 12_000) ?? samples[0];
    const dt = (latest.t - windowStart.t) / 1000;
    const dPct = latest.overall - windowStart.overall;
    if (dt < 4 || dPct <= 0.2) {
      return null;
    }
    const pctPerSec = dPct / dt;
    const remainingSec = Math.ceil(((100 - latest.overall) / pctPerSec) * 0.55);
    if (!Number.isFinite(remainingSec) || remainingSec < 0) {
      return null;
    }
    return formatDuration(Math.min(remainingSec, 3_600));
  }, [rawPercent, elapsedSec, now]);

  const tipCount = Math.max(tips.length, 1);
  const activeTip = tips.length > 0 ? tips[tipIndex % tips.length] : "";
  const recentTips = useMemo(() => {
    if (tips.length === 0) {
      return [] as string[];
    }
    const out: string[] = [];
    for (let i = 2; i >= 0; i -= 1) {
      const idx = (tipIndex - i + tipCount * 8) % tipCount;
      out.push(tips[idx]);
    }
    return out;
  }, [tipIndex, tips, tipCount]);

  const waiting =
    Boolean(progress && progress.total > 0 && progress.done === 0 && elapsedSec >= 8);

  return (
    <div
      className={`analysis-feed is-spotify is-${mode}`}
      role="status"
      aria-live="polite"
    >
      <div className="analysis-radar" aria-hidden>
        <span className="analysis-radar-ring" />
        <span className="analysis-radar-ring analysis-radar-ring-2" />
        <span className="analysis-radar-grid" />
        <span className="analysis-radar-sweep" />
        <span className="analysis-radar-blip a" />
        <span className="analysis-radar-blip b" />
        <span className="analysis-radar-blip c" />
        <span className="analysis-radar-core" />
      </div>

      <div className="analysis-copy">
        <p className="eyebrow">{phaseInfo.eyebrow}</p>
        <h3>{phaseInfo.title}</h3>
        <p className="analysis-sub">{phaseInfo.subtitle}</p>

        {mode === "enrich" && (
          <ol className="spotify-phase-steps" aria-label={t("feedStepsAria")}>
            {enrichSteps.map((step) => {
              const state = stepState(step.id, progress?.phase);
              return (
                <li key={step.id} className={`is-${state}`}>
                  <span className="spotify-phase-dot" aria-hidden />
                  <span>{step.label}</span>
                </li>
              );
            })}
          </ol>
        )}

        <div className="analysis-term">
          <div className="analysis-term-bar" aria-hidden>
            <i />
            <i />
            <i />
            <span>{mode === "enrich" ? t("feedTermEnrich") : t("feedTermImport")}</span>
          </div>
          <div className="analysis-term-body">
            <p className="analysis-term-line">
              <span className="analysis-term-prompt">&gt;</span>
              <span className="analysis-term-type is-with-runway">{typed || "…"}</span>
              <TermMorphCaret percent={percent} />
            </p>
            <p className="analysis-term-detail">
              {progress && progress.total > 0
                ? `${progress.done.toLocaleString(loc)} / ${progress.total.toLocaleString(loc)} · ${phaseInfo.hint}`
                : phaseInfo.hint}
            </p>
            {waiting && (
              <p className="analysis-term-wait">{t("feedWaitingSlow")}</p>
            )}
          </div>
        </div>

        <div
          className="analysis-bar"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={percent ?? undefined}
          aria-label={phaseInfo.title}
        >
          <PushFill
            value={percent ?? 0}
            indeterminate={percent == null}
            className="analysis-bar-fill"
          />
        </div>

        <div className="analysis-meta">
          {percent != null ? (
            <strong>{percent}%</strong>
          ) : (
            <strong className="is-pulse">{t("feedInProgress")}</strong>
          )}
          <span>
            {formatDuration(elapsedSec)}
            {etaLabel ? t("feedEtaLeft", { eta: etaLabel }) : ""}
          </span>
        </div>

        <div className="analysis-log" key={`${phaseKey}-${logPulse}`}>
          <p className="analysis-log-kicker">{t("feedJournal")}</p>
          <ul className="analysis-log-lines">
            {recentTips.map((line, index) => {
              const isCurrent = index === recentTips.length - 1;
              return (
                <li
                  key={`${line}-${index}-${tipIndex}`}
                  className={isCurrent ? "is-current" : "is-past"}
                >
                  <span className="analysis-log-mark" aria-hidden>
                    {isCurrent ? "▸" : "·"}
                  </span>
                  <span>{line}</span>
                </li>
              );
            })}
          </ul>
          <p className="analysis-log-focus" key={activeTip}>
            {activeTip}
          </p>
        </div>
      </div>
    </div>
  );
}

function overallJobPercent(
  mode: Mode,
  progress: SpotifySyncProgress | null,
): number | null {
  if (!progress || progress.total <= 0) {
    return null;
  }
  const local = Math.min(1, Math.max(0, progress.done / progress.total));
  if (mode === "sync") {
    return Math.min(100, Math.round(local * 1000) / 10);
  }
  const span = PHASE_SPAN[progress.phase] ?? PHASE_SPAN.artists;
  const overall = (span.start + local * span.weight) * 100;
  return Math.min(100, Math.round(overall * 10) / 10);
}

function resolveTipBank(mode: Mode, phase: string | undefined): string {
  if (mode === "sync") {
    return "sync";
  }
  const key = (phase ?? "enrich") as EnrichPhase;
  if (key === "itunes") {
    return "catalog";
  }
  if ((TIP_BANK_KEYS as readonly string[]).includes(key)) {
    return key;
  }
  return "enrich";
}

function stepState(
  id: string,
  phase: string | undefined,
): "todo" | "active" | "done" {
  const order = ["artists", "related", "catalog", "musicbrainz"] as const;
  if (phase === "done") {
    return "done";
  }
  let currentPhase = phase ?? "artists";
  if (currentPhase === "enrich") {
    currentPhase = "artists";
  }
  if (currentPhase === "itunes") {
    currentPhase = "catalog";
  }
  const current = order.indexOf(currentPhase as (typeof order)[number]);
  const mine = order.indexOf(id as (typeof order)[number]);
  if (current < 0 || mine < 0) {
    return "todo";
  }
  if (mine < current) {
    return "done";
  }
  if (mine === current) {
    return "active";
  }
  return "todo";
}

function describePhase(
  mode: Mode,
  progress: SpotifySyncProgress | null,
  t: (key: string) => string,
) {
  if (mode === "sync") {
    return {
      eyebrow: t("feedSyncEyebrow"),
      title: t("feedSyncTitle"),
      subtitle: t("feedSyncSubtitle"),
      headline: t("feedSyncHeadline"),
      hint: t("feedSyncHint"),
    };
  }

  switch (progress?.phase) {
    case "related":
      return {
        eyebrow: t("feedRelatedEyebrow"),
        title: t("feedRelatedTitle"),
        subtitle: t("feedRelatedSubtitle"),
        headline: t("feedRelatedHeadline"),
        hint: t("feedRelatedHint"),
      };
    case "catalog":
    case "itunes":
      return {
        eyebrow: t("feedCatalogEyebrow"),
        title: t("feedCatalogTitle"),
        subtitle: t("feedCatalogSubtitle"),
        headline: t("feedCatalogHeadline"),
        hint: t("feedCatalogHint"),
      };
    case "musicbrainz":
      return {
        eyebrow: t("feedMbEyebrow"),
        title: t("feedMbTitle"),
        subtitle: t("feedMbSubtitle"),
        headline: t("feedMbHeadline"),
        hint: t("feedMbHint"),
      };
    case "done":
      return {
        eyebrow: t("feedDoneEyebrow"),
        title: t("feedDoneTitle"),
        subtitle: t("feedDoneSubtitle"),
        headline: t("feedDoneHeadline"),
        hint: t("feedDoneHint"),
      };
    case "artists":
    default:
      return {
        eyebrow: t("feedArtistsEyebrow"),
        title: t("feedArtistsTitle"),
        subtitle: t("feedArtistsSubtitle"),
        headline: t("feedArtistsHeadline"),
        hint: t("feedArtistsHint"),
      };
  }
}

function formatDuration(totalSec: number): string {
  const sec = Math.max(0, Math.floor(totalSec));
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  if (m <= 0) {
    return `${s}s`;
  }
  return `${m} min ${s.toString().padStart(2, "0")}s`;
}
