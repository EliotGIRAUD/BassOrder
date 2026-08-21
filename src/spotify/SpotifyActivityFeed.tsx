import { useEffect, useMemo, useRef, useState } from "react";
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

/** Phrases d’ambiance — une banque par étape, pour que ça “vit” même si Spotify est lent. */
const TIPS: Record<string, string[]> = {
  sync: [
    "On ouvre ta bibliothèque likée, page après page…",
    "Chaque like nourrit le dictionnaire d’artistes.",
    "Aucun fichier sur ton PC n’est touché pour l’instant.",
    "Plus tu as de likes, plus la première passe est longue — c’est normal.",
    "Ensuite on pourra compléter les genres manquants automatiquement.",
    "Tu peux changer d’écran : l’import continue en fond.",
    "On ne lit que ce que Spotify expose à l’app — rien n’est modifié sur ton compte.",
    "Les doublons d’artistes sont fusionnés au fil de l’eau.",
  ],
  enrich: [
    "Lecture seule : ton compte Spotify n’est pas modifié.",
    "Quatre étapes : Spotify → liés+dico → iTunes/Deezer → MusicBrainz.",
    "Tu peux changer de page : le complément continue en fond.",
    "Un artiste classé = tous ses likes rangés d’un coup.",
    "Laisse tourner — plusieurs milliers d’artistes, ça prend du temps.",
    "Rien n’est écrit dans tes dossiers Windows pendant cette étape.",
  ],
  artists: [
    "Spotify bride les apps développeur : on interroge artiste par artiste.",
    "Le lot groupé a souvent échoué — bascule en mode unitaire, plus fiable.",
    "Chaque fiche ramène le nom officiel et, parfois, les genres bruts.",
    "Beaucoup d’artistes ont une liste de genres vide côté API — on rattrape après.",
    "La file avance même si le pourcentage reste bas au début.",
    "Pas d’écriture locale : on remplit seulement le dictionnaire en mémoire.",
    "Si Spotify throttle, on ralentit automatiquement — patience.",
    "Les artistes déjà classés sont ignorés pour gagner du temps.",
    "Objectif de cette étape : récupérer ce que Spotify veut bien donner.",
    "Ensuite on croisera avec les artistes proches pour combler les trous.",
  ],
  related: [
    "Quand la fiche est vide, on regarde les artistes liés pour voter un style.",
    "Plusieurs voisins du même genre = signal plus fiable.",
    "Toujours en lecture seule — Spotify n’est pas modifié.",
    "Cette passe sauve souvent les dumps YouTube / mixtapes sans tags.",
    "On ne force rien : si le signal est trop faible, on passe au catalogue.",
    "Les liens Spotify ressemblent à une carte de goûts — on s’en sert.",
    "Progression visible artiste après artiste.",
  ],
  catalog: [
    "Dernière passe catalogue : iTunes et Deezer pour les artistes encore flous.",
    "Les catalogues publics comblent ce que l’API Spotify laisse vide.",
    "On demande le genre principal, puis on le mappe vers un dossier BassOrder.",
    "Les échecs sont mémorisés pour ne pas reposer la même question en boucle.",
    "Ensuite MusicBrainz pour les plus likés encore « À classer ».",
    "Lecture réseau uniquement : tes MP3 restent où ils sont.",
  ],
  musicbrainz: [
    "MusicBrainz : tags communautaires, ~1 artiste / seconde (politesse serveur).",
    "On priorise les artistes que tu like le plus.",
    "Pas besoin de rester sur cet écran — ça continue en fond.",
    "Après ça, actualise Mes fichiers puis « Deviner les genres ».",
  ],
  done: [
    "Dictionnaire enregistré sur ton PC.",
    "Tu peux maintenant actualiser l’analyse de Mes fichiers.",
  ],
};

const ENRICH_STEPS = [
  { id: "artists", label: "1 · Fiches Spotify" },
  { id: "related", label: "2 · Artistes proches" },
  { id: "catalog", label: "3 · Catalogues" },
  { id: "musicbrainz", label: "4 · MusicBrainz" },
] as const;

export function SpotifyActivityFeed({ mode, progress, startedAt }: Props) {
  const [tipIndex, setTipIndex] = useState(0);
  const [typed, setTyped] = useState("");
  const [now, setNow] = useState(() => Date.now());
  const [logPulse, setLogPulse] = useState(0);
  const [smoothPct, setSmoothPct] = useState(0);
  const rateSamples = useRef<{ t: number; overall: number }[]>([]);

  const phaseKey = useMemo(() => resolveTipBank(mode, progress?.phase), [mode, progress?.phase]);
  const tips = TIPS[phaseKey] ?? TIPS.enrich;

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

  const phaseInfo = useMemo(() => describePhase(mode, progress), [mode, progress]);
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
    const t = Date.now();
    rateSamples.current.push({ t, overall: rawPercent });
    rateSamples.current = rateSamples.current.filter((s) => t - s.t < 45_000);
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

  const activeTip = tips[tipIndex % tips.length];
  const recentTips = useMemo(() => {
    const out: string[] = [];
    for (let i = 2; i >= 0; i -= 1) {
      const idx = (tipIndex - i + tips.length * 8) % tips.length;
      out.push(tips[idx]);
    }
    return out;
  }, [tipIndex, tips]);

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
          <ol className="spotify-phase-steps" aria-label="Étapes du complément">
            {ENRICH_STEPS.map((step) => {
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
            <span>{mode === "enrich" ? "bassorder · complément" : "bassorder · import"}</span>
          </div>
          <div className="analysis-term-body">
            <p className="analysis-term-line">
              <span className="analysis-term-prompt">&gt;</span>
              <span className="analysis-term-type is-with-runway">{typed || "…"}</span>
              <TermMorphCaret percent={percent} />
            </p>
            <p className="analysis-term-detail">
              {progress && progress.total > 0
                ? `${progress.done.toLocaleString("fr-FR")} / ${progress.total.toLocaleString("fr-FR")} · ${phaseInfo.hint}`
                : phaseInfo.hint}
            </p>
            {waiting && (
              <p className="analysis-term-wait">
                Spotify répond lentement — l’horloge tourne, la file est en cours.
                Première avance visible dès qu’une fiche revient.
              </p>
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
            <strong className="is-pulse">En cours</strong>
          )}
          <span>
            {formatDuration(elapsedSec)} écoulé
            {etaLabel ? ` · ~${etaLabel} restantes` : ""}
          </span>
        </div>

        <div className="analysis-log" key={`${phaseKey}-${logPulse}`}>
          <p className="analysis-log-kicker">Journal live</p>
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
  if (key in TIPS) {
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

function describePhase(mode: Mode, progress: SpotifySyncProgress | null) {
  if (mode === "sync") {
    return {
      eyebrow: "Import Spotify",
      title: "Import de tes titres likés",
      subtitle: "On construit le dictionnaire d’artistes à partir de ton compte.",
      headline: "Lecture de ta bibliothèque likée…",
      hint: "Patience — un gros compte = plus de pages à charger.",
    };
  }

  switch (progress?.phase) {
    case "related":
      return {
        eyebrow: "Complément · étape 2/4",
        title: "Artistes proches + ton dico",
        subtitle:
          "Spotify ne donne plus les genres : on regarde les artistes liés, et on propage les dossiers déjà classés dans ton dictionnaire.",
        headline: "Croisement réseau + dico local…",
        hint: "Lecture seule — rien n’est modifié sur ton compte.",
      };
    case "catalog":
    case "itunes":
      return {
        eyebrow: "Complément · étape 3/4",
        title: "Catalogues publics",
        subtitle:
          "Passe iTunes / Deezer pour les artistes encore sans dossier.",
        headline: "Recherche dans les catalogues…",
        hint: "Ensuite MusicBrainz pour le reste prioritaire.",
      };
    case "musicbrainz":
      return {
        eyebrow: "Complément · étape 4/4",
        title: "MusicBrainz",
        subtitle:
          "Tags communautaires MusicBrainz — lent (~1 artiste/s) mais utile quand Spotify est vide.",
        headline: "Tags MusicBrainz…",
        hint: "Priorité aux artistes les plus likés encore « À classer ».",
      };
    case "done":
      return {
        eyebrow: "Complément terminé",
        title: "Dictionnaire à jour",
        subtitle: "On enregistre le résultat sur ton PC.",
        headline: "Enregistrement local…",
        hint: "Encore une seconde.",
      };
    case "artists":
    default:
      return {
        eyebrow: "Complément · étape 1/4",
        title: "Fiches artistes Spotify",
        subtitle:
          "On demande les fiches Spotify. Attention : le champ genres est souvent vide depuis 2025 — ce n’est pas un bug BassOrder.",
        headline: "Interrogation des fiches artistes…",
        hint: "Laisse tourner — la première avance peut prendre une minute.",
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
