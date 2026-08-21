import { useEffect, useMemo, useState } from "react";
import { pickOrganizeDestination } from "./api";
import type { OrganizeMode, RenameMode, ScanResult, Track } from "./types";
import { TipPanel } from "../ui/AppTip";
import type { ImportExcludeOptions } from "./libraryWaste";

type Props = {
  scan: ScanResult;
  trackCount: number;
  folderCount: number;
  truncatedCount: number;
  duplicateCount: number;
  parasiteCount: number;
  exclude: ImportExcludeOptions;
  onExcludeChange: (next: ImportExcludeOptions) => void;
  sampleTrack: Track | null;
  mode: OrganizeMode;
  onModeChange: (mode: OrganizeMode) => void;
  busy: boolean;
  onClose: () => void;
  onConfirm: (
    destination: string,
    renameMode: RenameMode,
    isolateTruncated: boolean,
  ) => void;
};

function folderBaseName(path: string): string {
  const parts = path.replace(/\//g, "\\").split("\\").filter(Boolean);
  return parts[parts.length - 1] || "Musique";
}

/** Évite « Trié — Trié — … » si on réimporte depuis une dest déjà triée. */
function defaultSortedFolderName(sourceRoot: string): string {
  const base = folderBaseName(sourceRoot);
  if (/^tri[eé]/i.test(base)) {
    return "Bibliothèque triée";
  }
  return sanitizeFolderName(`Trié — ${base}`) || "Bibliothèque triée";
}

function joinPath(parent: string, name: string): string {
  const trimmed = parent.replace(/[/\\]+$/, "");
  const sep = parent.includes("/") && !parent.includes("\\") ? "/" : "\\";
  return `${trimmed}${sep}${name}`;
}

function sanitizeFolderName(raw: string): string {
  return raw
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
}

function stripTrackPrefix(raw: string): string {
  return raw
    .replace(/^\s*[\[({]?\d{1,3}[\])}]?(?:\s*[.\-_–—:]\s*|\s+)/, "")
    .trim();
}

function previewFileName(track: Track | null, mode: RenameMode): string {
  if (!track) {
    return "Artiste - Titre.mp3";
  }
  if (mode === "keep") {
    return track.fileName;
  }
  const ext = track.fileName.includes(".")
    ? track.fileName.slice(track.fileName.lastIndexOf(".") + 1)
    : "mp3";
  const stem = track.fileName.replace(/\.[^.]+$/, "");
  let title = stripTrackPrefix((track.title || stem).trim()) || stem;
  title = title.replace(/^[.\s]+/, "").trim() || title;
  if (mode === "title") {
    return `${title}.${ext}`;
  }
  const artist = (track.artist || "").trim();
  return artist ? `${artist} - ${title}.${ext}` : `${title}.${ext}`;
}

export function OrganizeWizard({
  scan,
  trackCount,
  folderCount,
  truncatedCount,
  duplicateCount,
  parasiteCount,
  exclude,
  onExcludeChange,
  sampleTrack,
  mode,
  onModeChange,
  busy,
  onClose,
  onConfirm,
}: Props) {
  const defaultName = useMemo(
    () => defaultSortedFolderName(scan.root),
    [scan.root],
  );
  const [parent, setParent] = useState<string | null>(null);
  const [createSubfolder, setCreateSubfolder] = useState(true);
  const [folderName, setFolderName] = useState(defaultName);
  const [renameMode, setRenameMode] = useState<RenameMode>("artistTitle");
  const [isolateTruncated, setIsolateTruncated] = useState(
    truncatedCount > 0 && !exclude.truncated,
  );
  const [picking, setPicking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const junkTotal = duplicateCount + parasiteCount + truncatedCount;
  const showIsolate =
    truncatedCount > 0 && !exclude.truncated;

  const safeName = sanitizeFolderName(folderName);
  const destination = useMemo(() => {
    if (!parent) {
      return null;
    }
    if (createSubfolder && safeName) {
      return joinPath(parent, safeName);
    }
    return parent;
  }, [parent, createSubfolder, safeName]);

  const renamePreview = useMemo(
    () => previewFileName(sampleTrack, renameMode),
    [sampleTrack, renameMode],
  );

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !busy) {
        e.preventDefault();
        onClose();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, onClose]);

  async function chooseParent() {
    setError(null);
    setPicking(true);
    try {
      const chosen = await pickOrganizeDestination();
      if (chosen) {
        setParent(chosen);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setPicking(false);
    }
  }

  function submit() {
    if (!destination) {
      setError("Choisis d’abord où créer ta bibliothèque triée.");
      return;
    }
    if (createSubfolder && !safeName) {
      setError("Donne un nom au dossier, ou décoche « Créer un nouveau dossier ».");
      return;
    }
    onConfirm(destination, renameMode, showIsolate && isolateTruncated);
  }

  return (
    <div className="organize-overlay" role="dialog" aria-modal="true" aria-label="Importer le tri par genre">
      <button
        type="button"
        className="organize-backdrop"
        aria-label="Fermer"
        disabled={busy}
        onClick={() => {
          if (!busy) {
            onClose();
          }
        }}
      />
      <div className="organize-sheet fx-frame fx-frame--loud">
        <span className="spin-border" aria-hidden />
        <header className="organize-top">
          <div>
            <p className="eyebrow">Écriture sur le PC</p>
            <h3>Importer le tri par genre</h3>
          </div>
          <button
            type="button"
            className="btn-ghost"
            onClick={onClose}
            disabled={busy}
          >
            Fermer
          </button>
        </header>

        <ol className="organize-steps">
          <li>
            <strong>BassOrder crée des dossiers</strong> nommés comme ton plan
            (Hip-Hop, Électronique, Coupés à 3:00…).
          </li>
          <li>
            <strong>Chaque titre unique</strong> est copié ou déplacé dans le
            bon dossier — les doublons restent de côté.
          </li>
          <li>
            <strong>Tu choisis l’emplacement</strong> — idéalement un dossier
            vide, séparé de ton dump d’origine.
          </li>
        </ol>

        <section className="organize-block">
          <h4>1. Où écrire la bibliothèque ?</h4>
          <p className="local-note">
            Choisis un dossier parent sur ton PC. BassOrder peut y créer un
            sous-dossier dédié, puis y ranger tous les genres.
          </p>
          <div className="organize-dest-row">
            <button
              type="button"
              className="btn-primary"
              onClick={chooseParent}
              disabled={busy || picking}
            >
              {picking ? "Ouverture…" : parent ? "Changer d’emplacement" : "Choisir un dossier…"}
            </button>
            {parent && (
              <code className="organize-path" title={parent}>
                {parent}
              </code>
            )}
          </div>

          <label className="organize-check">
            <input
              type="checkbox"
              checked={createSubfolder}
              disabled={busy}
              onChange={(e) => setCreateSubfolder(e.target.checked)}
            />
            <span>Créer un nouveau dossier à l’intérieur</span>
          </label>

          {createSubfolder && (
            <label className="organize-field">
              <span>Nom du dossier</span>
              <input
                type="text"
                value={folderName}
                disabled={busy}
                onChange={(e) => setFolderName(e.target.value)}
                placeholder="Musique triée"
                maxLength={80}
              />
            </label>
          )}

          {destination && (
            <p className="organize-preview">
              Destination finale : <strong title={destination}>{destination}</strong>
            </p>
          )}
        </section>

        <section className="organize-block">
          <h4>2. Nom des fichiers</h4>
          <p className="local-note">
            Enlève les <strong>01</strong>, <strong>16.</strong>, etc. devant les
            titres, et utilise les tags artiste / titre quand ils existent.
          </p>
          <div
            className="organize-rename-options"
            role="radiogroup"
            aria-label="Format de nom de fichier"
          >
            {(
              [
                {
                  id: "artistTitle" as const,
                  label: "Artiste - Titre",
                  hint: "Recommandé",
                },
                {
                  id: "title" as const,
                  label: "Titre seul",
                  hint: "Sans artiste",
                },
                {
                  id: "keep" as const,
                  label: "Garder le nom actuel",
                  hint: "Aucun renommage",
                },
              ] as const
            ).map((opt) => (
              <label
                key={opt.id}
                className={`organize-rename-option${renameMode === opt.id ? " is-active" : ""}`}
              >
                <input
                  type="radio"
                  name="rename-mode"
                  checked={renameMode === opt.id}
                  disabled={busy}
                  onChange={() => setRenameMode(opt.id)}
                />
                <span>
                  <strong>{opt.label}</strong>
                  <em>{opt.hint}</em>
                </span>
              </label>
            ))}
          </div>
          {sampleTrack && (
            <p className="organize-rename-preview" title={`${sampleTrack.fileName} → ${renamePreview}`}>
              Ex. <code>{sampleTrack.fileName}</code>
              <span aria-hidden> → </span>
              <code>{renamePreview}</code>
            </p>
          )}
        </section>

        {junkTotal > 0 && (
          <section className="organize-block">
            <h4>3. Exclure parasites & poubelle</h4>
            <p className="local-note">
              Coché = pas copié / pas déplacé. Les originaux restent où ils sont
              sur le disque ; ils ne polluent juste plus ta bibliothèque triée.
            </p>
            <div className="organize-exclude-list">
              {duplicateCount > 0 && (
                <label className="organize-check">
                  <input
                    type="checkbox"
                    checked={exclude.duplicates}
                    disabled={busy}
                    onChange={(e) =>
                      onExcludeChange({
                        ...exclude,
                        duplicates: e.target.checked,
                      })
                    }
                  />
                  <span>
                    Doublons (<strong>{duplicateCount}</strong>) — garder seulement
                    le meilleur exemplaire
                  </span>
                </label>
              )}
              {parasiteCount > 0 && (
                <label className="organize-check">
                  <input
                    type="checkbox"
                    checked={exclude.parasites}
                    disabled={busy}
                    onChange={(e) =>
                      onExcludeChange({
                        ...exclude,
                        parasites: e.target.checked,
                      })
                    }
                  />
                  <span>
                    Parasites illisibles (<strong>{parasiteCount}</strong>) —
                    sidecars <code>._</code>, fichiers cassés…
                  </span>
                </label>
              )}
              {truncatedCount > 0 && (
                <label className="organize-check">
                  <input
                    type="checkbox"
                    checked={exclude.truncated}
                    disabled={busy}
                    onChange={(e) => {
                      const next = e.target.checked;
                      onExcludeChange({ ...exclude, truncated: next });
                      if (next) {
                        setIsolateTruncated(false);
                      }
                    }}
                  />
                  <span>
                    Coupés à 3:00 (<strong>{truncatedCount}</strong>) — rips incomplets
                    / dumps foireux
                  </span>
                </label>
              )}
            </div>
          </section>
        )}

        {showIsolate && (
          <section className="organize-block">
            <h4>{junkTotal > 0 ? "3b" : "3"}. Ranger les 3:00 (option)</h4>
            <label className="organize-check">
              <input
                type="checkbox"
                checked={isolateTruncated}
                disabled={busy}
                onChange={(e) => setIsolateTruncated(e.target.checked)}
              />
              <span>
                Mettre les <strong>{truncatedCount}</strong> titres pile 3:00 dans
                un dossier <strong>Coupés à 3:00</strong> (au lieu de les laisser
                dans Hip-Hop, Électro…)
              </span>
            </label>
            <p className="local-note">
              Ou coche « Coupés à 3:00 » plus haut pour ne pas les importer du
              tout.
            </p>
          </section>
        )}

        <section className="organize-block">
          <h4>
            {junkTotal > 0 || showIsolate ? "4" : "3"}. Copier ou déplacer ?
          </h4>
          <div
            className="mode-toggle organize-mode"
            role="group"
            aria-label="Mode d’écriture"
          >
            <span
              className="mode-toggle-pill"
              data-mode={mode}
              aria-hidden
            />
            <button
              type="button"
              className={mode === "copy" ? "is-active" : ""}
              disabled={busy}
              onClick={() => onModeChange("copy")}
            >
              Copier (recommandé)
              <TipPanel side="bottom">
                Les originaux restent en place. BassOrder crée des copies triées.
              </TipPanel>
            </button>
            <button
              type="button"
              className={mode === "move" ? "is-active" : ""}
              disabled={busy}
              onClick={() => onModeChange("move")}
            >
              Déplacer
              <TipPanel side="bottom">
                Les fichiers quittent leur emplacement actuel pour rejoindre les dossiers genre.
              </TipPanel>
            </button>
          </div>
          <p className="local-note">
            {mode === "copy"
              ? "Sûr : ton dossier d’origine ne change pas. Tu obtiens une copie organisée."
              : "Les titres quittent le dossier analysé. Une confirmation te sera demandée."}
          </p>
        </section>

        <section className="organize-summary">
          <div>
            <strong>{trackCount}</strong>
            <span>titre{trackCount > 1 ? "s" : ""}</span>
          </div>
          <div>
            <strong>{folderCount}</strong>
            <span>dossier{folderCount > 1 ? "s" : ""} genre</span>
          </div>
          <div>
            <strong>{mode === "copy" ? "Copie" : "Déplacer"}</strong>
            <span>mode</span>
          </div>
        </section>

        {error && <p className="organize-error">{error}</p>}

        <footer className="organize-footer">
          <button
            type="button"
            className="btn-ghost"
            onClick={onClose}
            disabled={busy}
          >
            Annuler
          </button>
          <button
            type="button"
            className="btn-accent btn-glow"
            onClick={submit}
            disabled={busy || !destination}
          >
            {busy
              ? "Écriture en cours…"
              : mode === "copy"
                ? "Créer les dossiers et copier"
                : "Créer les dossiers et déplacer"}
          </button>
        </footer>
      </div>
    </div>
  );
}
