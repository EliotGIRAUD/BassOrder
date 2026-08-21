import { useEffect, useRef, useState } from "react";
import { loadTrackCover } from "./api";
import { getPreviewAudio, startPreview } from "./player";
import type { Track } from "./types";
import { useExperience } from "../ui/Experience";
import { usePrefs } from "../ui/prefs";
import { CoverSkeleton } from "../ui/skeleton";

type Props = {
  track: Track;
  queue: Track[];
  onClose: () => void;
  onChange: (track: Track) => void;
};

export function TrackPreview({ track, queue, onClose, onChange }: Props) {
  const fx = useExperience();
  const { prefs, patch } = usePrefs();
  const audioRef = useRef<HTMLAudioElement>(getPreviewAudio());
  const trackRef = useRef(track);
  const queueRef = useRef(queue);
  const onChangeRef = useRef(onChange);
  const lastVolumeRef = useRef(prefs.musicVolume > 0 ? prefs.musicVolume : 0.8);
  const skipRef = useRef<(dir: number) => void>(() => {});
  const [playing, setPlaying] = useState(() => !getPreviewAudio().paused);
  const [current, setCurrent] = useState(() => getPreviewAudio().currentTime || 0);
  const [duration, setDuration] = useState(track.durationSecs ?? 0);
  const [cover, setCover] = useState<string | null>(null);
  const [coverBusy, setCoverBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);

  trackRef.current = track;
  queueRef.current = queue;
  onChangeRef.current = onChange;
  if (prefs.musicVolume > 0) {
    lastVolumeRef.current = prefs.musicVolume;
  }

  skipRef.current = (dir: number) => {
    const q = queueRef.current;
    const t = trackRef.current;
    const i = q.findIndex((item) => item.path === t.path);
    if (i < 0 || q.length === 0) {
      return;
    }
    const next = q[(i + dir + q.length) % q.length];
    fx.toast({
      kind: "go",
      title: next.title || next.fileName,
      body: next.artist || "Lecture",
    });
    startPreview(next.path);
    onChangeRef.current(next);
  };

  useEffect(() => {
    let cancelled = false;
    setCover(null);
    setCoverBusy(true);
    void loadTrackCover(track.path)
      .then((url) => {
        if (!cancelled) {
          setCover(url);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setCoverBusy(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [track.path]);

  useEffect(() => {
    const audio = getPreviewAudio();
    audioRef.current = audio;

    const onTime = () => setCurrent(audio.currentTime);
    const onDur = () => {
      if (Number.isFinite(audio.duration) && audio.duration > 0) {
        setDuration(audio.duration);
      }
    };
    const onPlay = () => {
      setPlaying(true);
      setError(null);
    };
    const onPause = () => setPlaying(false);
    const onEnded = () => skipRef.current(1);
    const onErr = () => setError("Impossible de lire ce titre.");

    audio.addEventListener("timeupdate", onTime);
    audio.addEventListener("durationchange", onDur);
    audio.addEventListener("play", onPlay);
    audio.addEventListener("pause", onPause);
    audio.addEventListener("ended", onEnded);
    audio.addEventListener("error", onErr);

    setPlaying(!audio.paused);
    setCurrent(audio.currentTime || 0);
    if (Number.isFinite(audio.duration) && audio.duration > 0) {
      setDuration(audio.duration);
    }

    return () => {
      audio.removeEventListener("timeupdate", onTime);
      audio.removeEventListener("durationchange", onDur);
      audio.removeEventListener("play", onPlay);
      audio.removeEventListener("pause", onPause);
      audio.removeEventListener("ended", onEnded);
      audio.removeEventListener("error", onErr);
    };
  }, []);

  useEffect(() => {
    const audio = getPreviewAudio();
    if (audio.dataset.path !== track.path) {
      startPreview(track.path);
    }
    setPlaying(!audio.paused);
    setError(null);
  }, [track.path]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") {
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
      if (e.key === " ") {
        e.preventDefault();
        toggle();
      }
      if (e.key === "ArrowRight" && e.shiftKey) {
        e.preventDefault();
        skipRef.current(1);
      }
      if (e.key === "ArrowLeft" && e.shiftKey) {
        e.preventDefault();
        skipRef.current(-1);
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        nudgeVolume(0.05);
      }
      if (e.key === "ArrowDown") {
        e.preventDefault();
        nudgeVolume(-0.05);
      }
      if (e.key === "m" || e.key === "M") {
        e.preventDefault();
        toggleMute();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, prefs.musicVolume]);

  function toggle() {
    const audio = audioRef.current;
    if (!audio) {
      return;
    }
    if (audio.paused) {
      void audio
        .play()
        .then(() => setPlaying(true))
        .catch(() => setError("Impossible de lire ce titre."));
    } else {
      audio.pause();
      setPlaying(false);
    }
  }

  function seek(value: number) {
    const audio = audioRef.current;
    if (!audio) {
      return;
    }
    audio.currentTime = value;
    setCurrent(value);
  }

  function setVolume(value: number) {
    const next = Math.min(1, Math.max(0, Math.round(value * 100) / 100));
    if (next > 0) {
      lastVolumeRef.current = next;
    }
    patch({ musicVolume: next });
  }

  function nudgeVolume(delta: number) {
    setVolume(prefs.musicVolume + delta);
  }

  function toggleMute() {
    if (prefs.musicVolume > 0) {
      lastVolumeRef.current = prefs.musicVolume;
      patch({ musicVolume: 0 });
      return;
    }
    patch({ musicVolume: lastVolumeRef.current || 0.8 });
  }

  const progress = duration > 0 ? (current / duration) * 100 : 0;

  return (
    <div className="player-overlay" role="dialog" aria-modal="true" aria-label="Preview piste">
      <button type="button" className="player-backdrop" onClick={onClose} aria-label="Fermer" />
      <div className="player-sheet">
        <span className="spin-border" aria-hidden />

        <header className="player-top">
          <p className="eyebrow">Preview live</p>
          <button type="button" className="btn-ghost" onClick={onClose}>
            Fermer
          </button>
        </header>

        <div className="player-main">
          <div className={`player-cover${cover ? "" : " is-empty"}`}>
            {cover ? (
              <img src={cover} alt="" />
            ) : coverBusy ? (
              <CoverSkeleton size={168} />
            ) : (
              <div className="player-eq" aria-hidden>
                {Array.from({ length: 12 }, (_, i) => (
                  <span
                    key={i}
                    className={playing ? "is-on" : ""}
                    style={{ animationDelay: `${i * 0.07}s` }}
                  />
                ))}
              </div>
            )}
          </div>

          <div className="player-info">
            <p className="player-kicker">{track.folder}</p>
            <h3>{track.title || track.fileName}</h3>
            <p className="player-artist">{track.artist || "Artiste inconnu"}</p>
            {error && <p className="local-error">{error}</p>}

            <dl className="player-meta">
              <div>
                <dt>Album</dt>
                <dd>{track.album || "—"}</dd>
              </div>
              <div>
                <dt>Année</dt>
                <dd>{track.year || "—"}</dd>
              </div>
              <div>
                <dt>Genre</dt>
                <dd>{track.genre}</dd>
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
                <dt>Bitrate</dt>
                <dd>{track.bitrateKbps ? `${track.bitrateKbps} kb/s` : "—"}</dd>
              </div>
              <div>
                <dt>Durée</dt>
                <dd>{formatClock(duration || track.durationSecs || 0)}</dd>
              </div>
              <div className="player-meta-wide">
                <dt>Piste</dt>
                <dd title={track.path}>{track.fileName}</dd>
              </div>
              <div className="player-meta-wide">
                <dt>Chemin</dt>
                <dd title={track.path}>{track.path}</dd>
              </div>
            </dl>
          </div>
        </div>

        <div className="player-transport">
          <input
            type="range"
            className="player-seek"
            min={0}
            max={Math.max(1, duration)}
            step={0.1}
            value={Math.min(current, duration || 0)}
            onChange={(e) => seek(Number(e.target.value))}
            aria-label="Position"
            style={{ ["--p" as string]: `${progress}%` }}
          />
          <div className="player-times">
            <span>{formatClock(current)}</span>
            <span>{formatClock(duration)}</span>
          </div>
          <div className="player-volume">
            <button
              type="button"
              className="btn-ghost player-mute"
              onClick={toggleMute}
              aria-label={prefs.musicVolume > 0 ? "Couper le son" : "Activer le son"}
            >
              {prefs.musicVolume > 0 ? "Son" : "Muet"}
            </button>
            <input
              type="range"
              className="player-vol"
              min={0}
              max={1}
              step={0.01}
              value={prefs.musicVolume}
              onChange={(e) => setVolume(Number(e.target.value))}
              aria-label="Volume"
              style={{ ["--p" as string]: `${prefs.musicVolume * 100}%` }}
            />
            <span className="player-vol-pct">{Math.round(prefs.musicVolume * 100)}%</span>
          </div>
          <div className="player-controls">
            <button type="button" className="btn-ghost" onClick={() => skipRef.current(-1)} disabled={queue.length < 2}>
              ← Préc.
            </button>
            <button type="button" className="btn-accent player-play" onClick={toggle}>
              {playing ? "Pause" : "Play"}
            </button>
            <button type="button" className="btn-ghost" onClick={() => skipRef.current(1)} disabled={queue.length < 2}>
              Suiv. →
            </button>
          </div>
          <p className="player-hint">Espace : play/pause · ↑ ↓ : volume · M : muet · Shift + ← → : pistes · Esc : fermer</p>
        </div>
      </div>
    </div>
  );
}

function formatClock(secs: number): string {
  if (!Number.isFinite(secs) || secs < 0) {
    return "0:00";
  }
  const minutes = Math.floor(secs / 60);
  const s = Math.floor(secs % 60);
  return `${minutes}:${String(s).padStart(2, "0")}`;
}
