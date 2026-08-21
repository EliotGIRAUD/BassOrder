import { useEffect, useMemo, useRef, useState } from "react";
import type { GenreGroup, Track } from "./types";
import { suggestFolder } from "./suggest";
import { DUPLICATE_GENRE } from "./duplicateFlags";
import { useExperience } from "../ui/Experience";
import { PushEq, PushFill } from "../ui/push";
import { TipPanel } from "../ui/AppTip";

type Props = {
  unknown: Track[];
  folders: GenreGroup[];
  onAssign: (trackPath: string, folder: string, genre: string) => void;
  onClose: () => void;
  onPreview: (track: Track) => void;
};

type Pending = { folder: string; genre: string };

export function ManualTriage({ unknown, folders, onAssign, onClose, onPreview }: Props) {
  const fx = useExperience();
  const [index, setIndex] = useState(0);
  const [custom, setCustom] = useState("");
  const [filter, setFilter] = useState("");
  const [flash, setFlash] = useState(false);
  const [pending, setPending] = useState<Pending | null>(null);
  const startedWith = useRef(unknown.length);

  const track = unknown[Math.min(index, Math.max(0, unknown.length - 1))] ?? null;
  const positionRatio =
    unknown.length === 0 ? 1 : (index + 1) / unknown.length;

  const suggestion = useMemo(
    () => (track ? suggestFolder(track, folders) : null),
    [track, folders],
  );

  const folderChoices = useMemo(() => {
    const q = filter.trim().toLowerCase();
    const list = folders.filter(
      (g) =>
        g.genre !== "Sans genre" &&
        g.genre !== "Illisible" &&
        g.genre !== DUPLICATE_GENRE,
    );
    const filtered = q
      ? list.filter(
          (g) =>
            g.folder.toLowerCase().includes(q) ||
            g.genre.toLowerCase().includes(q),
        )
      : list;
    return filtered.slice(0, 24);
  }, [folders, filter]);

  useEffect(() => {
    setPending(null);
  }, [track?.path]);

  useEffect(() => {
    if (unknown.length === 0 && startedWith.current > 0) {
      fx.toast({
        kind: "ok",
        title: "Classement terminé",
        body: "Tous les titres ont un dossier. Tu peux maintenant créer l’arborescence (copier ou déplacer).",
      });
    }
  }, [unknown.length, fx]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        if (pending) {
          setPending(null);
          return;
        }
        onClose();
        return;
      }
      if (!track) {
        return;
      }
      if (e.key === "Enter" && pending) {
        e.preventDefault();
        commit(pending.folder, pending.genre);
        return;
      }
      if (e.key === "ArrowRight" || e.key === "j") {
        e.preventDefault();
        setIndex((i) => Math.min(i + 1, unknown.length - 1));
      }
      if (e.key === "ArrowLeft" || e.key === "k") {
        e.preventDefault();
        setIndex((i) => Math.max(i - 1, 0));
      }
      const num = Number(e.key);
      if (num >= 1 && num <= 9 && folderChoices[num - 1]) {
        e.preventDefault();
        // Raccourci = validation rapide directe
        commit(folderChoices[num - 1].folder, folderChoices[num - 1].genre);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [track, folderChoices, unknown.length, onClose, pending]);

  function commit(folder: string, genre: string) {
    if (!track) {
      return;
    }
    setFlash(true);
    window.setTimeout(() => setFlash(false), 380);
    setPending(null);
    onAssign(track.path, folder, genre);
  }

  function pickFolder(folder: string, genre: string) {
    if (pending && pending.folder === folder) {
      commit(folder, genre);
      return;
    }
    setPending({ folder, genre });
  }

  function assignCustom() {
    const raw = custom.trim().replace(/\//g, "\\");
    if (!raw || !track) {
      return;
    }
    const label = raw.includes("\\")
      ? raw.split("\\").filter(Boolean).join(" · ")
      : raw;
    commit(raw, label);
    setCustom("");
  }

  return (
    <div className="triage-overlay" role="dialog" aria-modal="true" aria-label="Classement manuel">
      <button type="button" className="triage-backdrop" onClick={onClose} aria-label="Fermer" />
      <div className="triage-drawer">
        <header className="triage-header">
          <div className="triage-header-copy">
            <p className="eyebrow">Un titre à la fois</p>
            <h3>Classement manuel</h3>
            <p className="local-note">
              {unknown.length === 0
                ? "Terminé — tous les titres ont un dossier."
                : `Titre ${index + 1} sur ${unknown.length} restants. Clique un dossier → confirme. Raccourcis 1–9 = validation directe. Esc ferme.`}
            </p>
          </div>
          <button type="button" className="btn-ghost triage-close" onClick={onClose}>
            Fermer
            <TipPanel side="bottom">
              Ferme le classement (tes choix déjà faits sont conservés)
            </TipPanel>
          </button>
        </header>

        <PushFill
          value={Math.round(positionRatio * 100)}
          className="triage-progress"
        />

        {unknown.length === 0 || !track ? (
          <div className="triage-done">
            <span className="triage-done-ring" />
            <p>Plus aucun titre « Sans genre ». Beau travail.</p>
          </div>
        ) : (
          <>
            <div className={`triage-card${flash ? " is-flash" : ""}`} key={track.path}>
              <div className="triage-nowplaying">
                <PushEq
                  bars={8}
                  hint={false}
                  className="push-eq--triage"
                  label="Égaliseur triage"
                />
                <div>
                  <p className="triage-kicker">En cours de classement</p>
                  <h4>{track.title || track.fileName}</h4>
                  <p className="triage-artist">{track.artist || "Artiste inconnu"}</p>
                </div>
              </div>

              <dl className="triage-meta">
                <div>
                  <dt>Album</dt>
                  <dd>{track.album || "—"}</dd>
                </div>
                <div>
                  <dt>Année</dt>
                  <dd>{track.year || "—"}</dd>
                </div>
                <div>
                  <dt>BPM</dt>
                  <dd>{track.bpm ?? "—"}</dd>
                </div>
                <div>
                  <dt>Clé</dt>
                  <dd>{track.musicalKey || "—"}</dd>
                </div>
                <div>
                  <dt>Durée</dt>
                  <dd>{formatDuration(track.durationSecs)}</dd>
                </div>
                <div>
                  <dt>Bitrate</dt>
                  <dd>{track.bitrateKbps ? `${track.bitrateKbps} kb/s` : "—"}</dd>
                </div>
                <div>
                  <dt>Piste</dt>
                  <dd title={track.fileName}>{track.fileName}</dd>
                </div>
              </dl>

              {suggestion && (
                <div className="reco-card">
                  <div>
                    <p className="reco-kicker">Recommandé · {suggestion.reason}</p>
                    <p className="reco-folder">{suggestion.folder}</p>
                  </div>
                  <button
                    type="button"
                    className="btn-accent"
                    onClick={() => commit(suggestion.folder, suggestion.genre)}
                  >
                    Mettre dans ce dossier
                    <TipPanel side="bottom">
                      Validation directe de la suggestion ({suggestion.reason})
                    </TipPanel>
                  </button>
                </div>
              )}

              <div className="triage-nav">
                <button
                  type="button"
                  className="btn-ghost"
                  disabled={index === 0}
                  onClick={() => setIndex((i) => i - 1)}
                >
                  ← Précédent
                </button>
                <button
                  type="button"
                  className="btn-accent"
                  onClick={() => onPreview(track)}
                >
                  Écouter
                </button>
                <button
                  type="button"
                  className="btn-ghost"
                  disabled={index >= unknown.length - 1}
                  onClick={() => setIndex((i) => i + 1)}
                >
                  Suivant →
                </button>
              </div>
            </div>

            {pending && (
              <div className="triage-confirm" role="status">
                <div className="triage-confirm-copy">
                  <p className="eyebrow">Validation</p>
                  <strong>{pending.folder}</strong>
                  <em>Clique encore le dossier, ou Entrée pour valider · Esc annule</em>
                </div>
                <button
                  type="button"
                  className="btn-accent"
                  onClick={() => commit(pending.folder, pending.genre)}
                >
                  Confirmer
                </button>
                <button type="button" className="btn-ghost" onClick={() => setPending(null)}>
                  Annuler
                </button>
              </div>
            )}

            <div className="triage-assign">
              <div className="triage-assign-tools">
                <input
                  type="search"
                  className="plan-search"
                  placeholder="Filtrer un dossier…"
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                />
                <div className="triage-create">
                  <input
                    type="text"
                    className="plan-search"
                    placeholder="Nouveau : Électronique\Acid"
                    value={custom}
                    onChange={(e) => setCustom(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        assignCustom();
                      }
                    }}
                  />
                  <button
                    type="button"
                    className="btn-accent"
                    onClick={assignCustom}
                    disabled={!custom.trim()}
                  >
                    Créer & assigner
                  </button>
                </div>
              </div>

              <p className="triage-assign-hint">
                1<sup>er</sup> clic = sélection · 2<sup>e</sup> clic ou Entrée = valider · touches 1–9 = direct
              </p>

              <div className="triage-folder-grid">
                {folderChoices.map((g, i) => (
                  <button
                    key={g.folder}
                    type="button"
                    className={`triage-folder-btn${suggestion?.folder === g.folder ? " is-suggested" : ""}${pending?.folder === g.folder ? " is-pending" : ""}`}
                    style={{ animationDelay: `${Math.min(i, 12) * 0.035}s` }}
                    onClick={() => pickFolder(g.folder, g.genre)}
                    title={g.folder}
                  >
                    {i < 9 && <span className="triage-hotkey">{i + 1}</span>}
                    <span className="triage-folder-name">{g.folder}</span>
                    <span className="triage-folder-count">{g.tracks.length}</span>
                  </button>
                ))}
                {folderChoices.length === 0 && (
                  <p className="local-note">
                    Aucun dossier encore — crée-en un ci-dessus (ex. Hip-Hop\Rap FR).
                  </p>
                )}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function formatDuration(secs: number | null): string {
  if (secs == null || secs <= 0) {
    return "—";
  }
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}
