import { useEffect, useMemo, useState } from "react";
import { PushFill } from "../ui/push";
import { TermMorphCaret } from "../ui/TermMorphCaret";
import type { LookupProgress, ScanProgress } from "./types";

const SCAN_LINES = [
  "On ouvre ton dossier sans toucher aux titres…",
  "On repère les MP3, FLAC, M4A et compagnie…",
  "Lecture des tags : artiste, titre, album…",
  "On croise avec ta base Spotify si elle est là…",
  "Regroupement des titres par genre…",
  "Préparation du plan de dossiers…",
  "Patience — une grosse bibliothèque prend un moment…",
];

const LOOKUP_LINES = [
  "On cherche les genres manquants…",
  "Consultation des catalogues en ligne (iTunes, Deezer)…",
  "Si un artiste est classé, on applique le genre à ses autres titres…",
  "Objectif : classer automatiquement au moins 85 % des titres…",
  "Ce qui reste flou pourra être rangé à la main ensuite…",
];

type Mode = "scan" | "lookup";

type Props = {
  mode: Mode;
  scan?: ScanProgress | null;
  lookup?: LookupProgress | null;
};

export function AnalysisFeed({ mode, scan = null, lookup = null }: Props) {
  const lines = mode === "scan" ? SCAN_LINES : LOOKUP_LINES;
  const [lineIndex, setLineIndex] = useState(0);
  const [typed, setTyped] = useState("");

  const liveLabel = useMemo(() => {
    if (mode === "scan" && scan?.label) {
      return scan.label;
    }
    if (mode === "lookup" && lookup) {
      if (lookup.artist) {
        return `Recherche du genre — ${lookup.artist}`;
      }
      if (lookup.total > 0) {
        return `Détection des genres — ${lookup.done} / ${lookup.total} artistes`;
      }
    }
    return lines[lineIndex % lines.length];
  }, [mode, scan, lookup, lines, lineIndex]);

  const percent = useMemo(() => {
    if (mode === "scan" && scan && scan.total > 0) {
      return Math.min(100, Math.round((scan.done / scan.total) * 100));
    }
    if (mode === "lookup" && lookup && lookup.total > 0) {
      return Math.min(100, Math.round((lookup.done / lookup.total) * 100));
    }
    return null;
  }, [mode, scan, lookup]);

  const detail =
    mode === "scan"
      ? scan?.fileName ?? null
      : lookup?.artist
        ? lookup.artist
        : null;

  useEffect(() => {
    const id = window.setInterval(() => {
      setLineIndex((value) => value + 1);
    }, 3200);
    return () => window.clearInterval(id);
  }, []);

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
    }, 18);
    return () => window.clearInterval(id);
  }, [liveLabel]);

  const title = mode === "scan" ? "Analyse en cours" : "Affinage en cours";
  const subtitle =
    mode === "scan"
      ? "Rien n’est écrit sur le disque — on lit seulement les métadonnées."
      : "On complète les genres manquants sans déplacer tes titres.";

  return (
    <div className={`analysis-feed is-${mode}`} role="status" aria-live="polite">
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
        <p className="eyebrow">{mode === "scan" ? "Scan disque" : "Lookup réseau"}</p>
        <h3>{title}</h3>
        <p className="analysis-sub">{subtitle}</p>

        <div className="analysis-term">
          <div className="analysis-term-bar" aria-hidden>
            <i />
            <i />
            <i />
            <span>{mode === "scan" ? "scan.sh" : "lookup.sh"}</span>
          </div>
          <div className="analysis-term-body">
            <p className="analysis-term-line">
              <span className="analysis-term-prompt">&gt;</span>
              <span
                className="analysis-term-type is-with-runway"
                style={{ ["--ch" as string]: `${Math.max(typed.length, 8)}ch` }}
              >
                {typed}
              </span>
              <TermMorphCaret percent={percent} />
            </p>
            {detail && (
              <p className="analysis-term-detail" title={detail}>
                {detail}
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
          aria-label={title}
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
            {mode === "scan" && scan && scan.total > 0
              ? `${scan.done} / ${scan.total} titres`
              : mode === "lookup" && lookup && lookup.total > 0
                ? `${lookup.done} / ${lookup.total} artistes`
                : "Préparation…"}
          </span>
        </div>

        <ul className="analysis-ticker" aria-hidden>
          {lines.map((line, index) => (
            <li
              key={line}
              className={index === lineIndex % lines.length ? "is-active" : undefined}
            >
              {line}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
