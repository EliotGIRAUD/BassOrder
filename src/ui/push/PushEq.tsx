import {
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { usePrefs } from "../prefs";
import { playPluck, unlockAudio } from "../sounds";
import { clamp, prefersReducedMotion } from "./spring";

const SPRING = 42;
const DAMP = 8.8;
const COUPLE = 0.26;
const IDLE_AMP = 0.2;
const MIN_H = 0.08;
const MAX_H = 1;

type Bar = {
  h: number;
  v: number;
  idle: number;
  el: HTMLSpanElement | null;
};

function makeBars(count: number): Bar[] {
  return Array.from({ length: count }, (_, i) => ({
    h: 0.35 + Math.sin(i * 0.55) * 0.12,
    v: 0,
    idle: 0.28 + (i % 7) * 0.04,
    el: null,
  }));
}

/** EQ jouable (accueil, rail, empty states, triage). */
export function PushEq({
  className = "",
  bars = 40,
  hint = true,
  active = true,
  label = "Égaliseur interactif : glisse et écrase les barres",
}: {
  className?: string;
  bars?: number;
  hint?: boolean;
  /** Coupe le rAF idle quand false (ex. panneau hors écran). */
  active?: boolean;
  label?: string;
}) {
  const count = Math.max(3, Math.min(64, bars));
  const { prefs } = usePrefs();
  const prefsRef = useRef(prefs);
  prefsRef.current = prefs;
  const interactive = active;
  const idleAnim = prefs.playful && interactive;

  const rootRef = useRef<HTMLDivElement>(null);
  const barsRef = useRef<Bar[]>(makeBars(count));
  const countRef = useRef(count);
  const pressingRef = useRef(false);
  const pointerRef = useRef({ x: 0, y: 0 });
  const lastSoundRef = useRef<number[]>(Array(count).fill(0));
  const reduceRef = useRef(false);
  const idleAnimRef = useRef(idleAnim);
  idleAnimRef.current = idleAnim;
  const interactiveRef = useRef(interactive);
  interactiveRef.current = interactive;
  const rafRef = useRef(0);
  const [showHint, setShowHint] = useState(hint);
  const [pushing, setPushing] = useState(false);

  if (countRef.current !== count) {
    countRef.current = count;
    barsRef.current = makeBars(count);
    lastSoundRef.current = Array(count).fill(0);
  }

  useEffect(() => {
    setShowHint(hint);
  }, [hint]);

  useEffect(() => {
    reduceRef.current = prefersReducedMotion();

    const stop = () => {
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = 0;
      }
    };

    const shouldRun = () =>
      interactiveRef.current &&
      (idleAnimRef.current || pressingRef.current);

    if (!shouldRun()) {
      stop();
      return stop;
    }

    let last = performance.now();

    const tick = (now: number) => {
      if (!shouldRun()) {
        rafRef.current = 0;
        return;
      }
      const dt = Math.min(0.032, (now - last) / 1000);
      last = now;
      const root = rootRef.current;
      const n = countRef.current;
      const list = barsRef.current;
      if (!root) {
        rafRef.current = requestAnimationFrame(tick);
        return;
      }

      const rect = root.getBoundingClientRect();
      const pressing = pressingRef.current;
      const px = pointerRef.current.x - rect.left;
      const py = pointerRef.current.y - rect.top;
      const t = now / 1000;
      const { intensity, sounds, volume } = prefsRef.current;
      const targets = new Float32Array(n);
      const spread = Math.max(0.06, 0.14 - n * 0.0015);
      const anim = idleAnimRef.current;

      for (let i = 0; i < n; i += 1) {
        const bar = list[i];
        const wave = anim
          ? 0.5 +
            Math.sin(t * 2.1 + i * 0.38) * IDLE_AMP * intensity +
            Math.sin(t * 3.4 + i * 0.17) * 0.06 * intensity
          : 0.45;
        let target = clamp(wave * 0.55 + bar.idle * 0.35, MIN_H, MAX_H);

        if (pressing && rect.width > 0) {
          const cx = ((i + 0.5) / n) * rect.width;
          const dx = (px - cx) / (rect.width * spread);
          const falloff = Math.exp(-dx * dx);
          const push = 1 - clamp(py / rect.height, 0, 1);
          const smash = MIN_H + push * push * 0.95;
          target = target * (1 - falloff) + smash * falloff;
        }

        targets[i] = target;
      }

      for (let i = 0; i < n; i += 1) {
        const left = targets[i - 1] ?? targets[i];
        const right = targets[i + 1] ?? targets[i];
        targets[i] =
          targets[i] * (1 - COUPLE) + ((left + right) * 0.5) * COUPLE;
      }

      for (let i = 0; i < n; i += 1) {
        const bar = list[i];
        if (reduceRef.current || (!anim && !pressing)) {
          bar.h = targets[i];
          bar.v = 0;
        } else {
          const force = (targets[i] - bar.h) * SPRING - bar.v * DAMP;
          bar.v += force * dt;
          bar.h = clamp(bar.h + bar.v * dt, MIN_H * 0.45, MAX_H * 1.2);
        }

        const el = bar.el;
        if (!el) {
          continue;
        }
        const h = clamp(bar.h, MIN_H, MAX_H);
        const squash = 1 + (1 - h) * 0.7;
        const glow = Math.min(1, Math.abs(bar.v) * 0.09 + (1 - h) * 0.55);
        el.style.height = `${h * 100}%`;
        el.style.transform = `scaleX(${squash})`;
        el.style.setProperty("--eq-glow", String(glow));
        el.dataset.hot = pressing && Math.abs(bar.v) > 1.1 ? "1" : "0";

        if (pressing && sounds) {
          const crossed =
            Math.abs(bar.v) > 4 && now - (lastSoundRef.current[i] ?? 0) > 65;
          if (crossed) {
            lastSoundRef.current[i] = now;
            playPluck(180 + (i / n) * 980, volume * 0.55, Math.abs(bar.v) / 12);
          }
        }
      }

      rafRef.current = requestAnimationFrame(tick);
    };

    rafRef.current = requestAnimationFrame(tick);
    return stop;
  }, [idleAnim, interactive, pushing]);

  function bindBar(index: number, el: HTMLSpanElement | null) {
    const bar = barsRef.current[index];
    if (bar) {
      bar.el = el;
    }
  }

  function onPointerDown(e: ReactPointerEvent<HTMLDivElement>) {
    if (!interactiveRef.current) {
      return;
    }
    e.stopPropagation();
    e.preventDefault();
    unlockAudio();
    pressingRef.current = true;
    pointerRef.current = { x: e.clientX, y: e.clientY };
    e.currentTarget.setPointerCapture(e.pointerId);
    setShowHint(false);
    setPushing(true);
    rootRef.current?.classList.add("is-pushing");
  }

  function onPointerMove(e: ReactPointerEvent<HTMLDivElement>) {
    if (!pressingRef.current) {
      return;
    }
    pointerRef.current = { x: e.clientX, y: e.clientY };
  }

  function onPointerUp(e: ReactPointerEvent<HTMLDivElement>) {
    pressingRef.current = false;
    setPushing(false);
    rootRef.current?.classList.remove("is-pushing");
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      /* already released */
    }
  }

  return (
    <div
      ref={rootRef}
      className={`push-eq ${className}${interactive ? " is-live" : " is-inert"}`.trim()}
      role="img"
      aria-label={label}
      data-push-live={interactive ? "true" : "false"}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    >
      {Array.from({ length: count }, (_, i) => (
        <span key={i} ref={(el) => bindBar(i, el)} className="push-eq-bar" />
      ))}
      {showHint && interactive && (
        <span className="push-eq-hint" aria-hidden>
          écrase-moi
        </span>
      )}
    </div>
  );
}
