import {
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import { usePrefs } from "../prefs";
import { playPluck, unlockAudio } from "../sounds";
import {
  clamp,
  isSettled,
  prefersReducedMotion,
  snapImpulse,
  stepSpring,
} from "./spring";

type Tone = "high" | "mid" | "low";

function toneFor(percent: number, high: number, mid: number): Tone {
  if (percent >= high) {
    return "high";
  }
  if (percent >= mid) {
    return "mid";
  }
  return "low";
}

/** Cyber-bar historique : scrub le flux (score + couleur live), puis snap au vrai %. */
export function PushBar({
  value,
  label,
  goal,
  ariaLabel,
  showGoalMark = false,
  highAt = 70,
  midAt = 35,
}: {
  value: number;
  label: string;
  goal: ReactNode;
  ariaLabel: string;
  showGoalMark?: boolean;
  highAt?: number;
  midAt?: number;
}) {
  const real = clamp(Math.round(value), 0, 100);
  const { prefs } = usePrefs();
  const prefsRef = useRef(prefs);
  prefsRef.current = prefs;
  const springs = prefs.playful;

  const rootRef = useRef<HTMLDivElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const fillRef = useRef<HTMLDivElement>(null);
  const knobRef = useRef<HTMLSpanElement>(null);
  const valueRef = useRef<HTMLElement>(null);

  const displayRef = useRef(real);
  const velocityRef = useRef(0);
  const targetRef = useRef(real);
  const realRef = useRef(real);
  const pressingRef = useRef(false);
  const snappingRef = useRef(false);
  const lastSoundAt = useRef(0);
  const lastSoundPct = useRef(real);
  const reduceRef = useRef(false);
  const rafRef = useRef(0);
  const springsRef = useRef(springs);
  springsRef.current = springs;
  const highRef = useRef(highAt);
  const midRef = useRef(midAt);
  highRef.current = highAt;
  midRef.current = midAt;

  const [shown, setShown] = useState(real);
  const [tone, setTone] = useState<Tone>(() => toneFor(real, highAt, midAt));
  const [mode, setMode] = useState<"idle" | "pushing" | "snapping">("idle");

  realRef.current = real;

  function paint(visual: number) {
    const fill = fillRef.current;
    if (fill) {
      fill.style.width = `${visual}%`;
      const glow = Math.min(
        1,
        Math.abs(velocityRef.current) * 0.012 + (pressingRef.current ? 0.45 : 0),
      );
      fill.style.setProperty("--bar-glow", String(glow));
    }
    if (knobRef.current) {
      knobRef.current.style.left = `${visual}%`;
    }
    if (rootRef.current) {
      rootRef.current.style.setProperty("--p", `${visual}%`);
    }
  }

  function applyUi(visual: number) {
    const rounded = Math.round(visual);
    setShown(rounded);
    setTone(toneFor(rounded, highRef.current, midRef.current));
    if (valueRef.current) {
      valueRef.current.textContent = `${rounded}%`;
    }
  }

  /** Scrub direct : fill + % + couleur collés au pointeur. */
  function scrubTo(pct: number) {
    displayRef.current = pct;
    targetRef.current = pct;
    velocityRef.current = 0;
    paint(pct);
    applyUi(pct);
  }

  function stopRaf() {
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = 0;
    }
  }

  /** RAF uniquement pour le snap de relâchement (et idle springs). */
  function kickSnapRaf() {
    if (rafRef.current) {
      return;
    }
    let last = performance.now();
    let lastUi = 0;
    const tick = (now: number) => {
      if (pressingRef.current) {
        rafRef.current = 0;
        return;
      }

      const snapping = snappingRef.current;
      const useSpring = springsRef.current || snapping;
      if (!useSpring) {
        displayRef.current = realRef.current;
        velocityRef.current = 0;
        paint(realRef.current);
        applyUi(realRef.current);
        rafRef.current = 0;
        return;
      }

      const dt = Math.min(0.033, (now - last) / 1000);
      last = now;
      const instant = !springsRef.current || reduceRef.current;
      const next = stepSpring(
        displayRef.current,
        velocityRef.current,
        realRef.current,
        dt,
        snapping,
        instant,
      );
      displayRef.current = next.display;
      velocityRef.current = next.velocity;
      const visual = clamp(displayRef.current, 0, 100);
      paint(visual);

      if (now - lastUi > 32) {
        lastUi = now;
        applyUi(visual);
      }

      if (
        snapping &&
        isSettled(displayRef.current, velocityRef.current, realRef.current)
      ) {
        snappingRef.current = false;
        displayRef.current = realRef.current;
        velocityRef.current = 0;
        paint(realRef.current);
        applyUi(realRef.current);
        setMode("idle");
        rootRef.current?.classList.remove("is-snapping");
        rafRef.current = 0;
        return;
      }

      if (
        !snapping &&
        isSettled(displayRef.current, velocityRef.current, realRef.current)
      ) {
        displayRef.current = realRef.current;
        velocityRef.current = 0;
        paint(realRef.current);
        rafRef.current = 0;
        return;
      }

      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
  }

  useEffect(() => {
    if (pressingRef.current) {
      return;
    }
    targetRef.current = real;
    reduceRef.current = prefersReducedMotion();
    if (springs && !reduceRef.current) {
      kickSnapRaf();
    } else {
      stopRaf();
      displayRef.current = real;
      velocityRef.current = 0;
      paint(real);
      applyUi(real);
    }
  }, [real, springs, highAt, midAt]);

  useEffect(() => () => stopRaf(), []);

  function percentFromPointer(clientX: number): number {
    const track = trackRef.current;
    if (!track) {
      return realRef.current;
    }
    const rect = track.getBoundingClientRect();
    if (rect.width <= 0) {
      return realRef.current;
    }
    return clamp(((clientX - rect.left) / rect.width) * 100, 0, 100);
  }

  function maybePluck(pct: number) {
    const { sounds, volume } = prefsRef.current;
    if (!sounds) {
      return;
    }
    const now = performance.now();
    if (
      now - lastSoundAt.current < 55 ||
      Math.abs(pct - lastSoundPct.current) < 2.5
    ) {
      return;
    }
    lastSoundAt.current = now;
    lastSoundPct.current = pct;
    playPluck(220 + (pct / 100) * 880, volume * 0.5, 0.8);
  }

  function onPointerDown(e: ReactPointerEvent<HTMLDivElement>) {
    e.stopPropagation();
    e.preventDefault();
    unlockAudio();
    reduceRef.current = prefersReducedMotion();
    stopRaf();
    pressingRef.current = true;
    snappingRef.current = false;
    const pct = percentFromPointer(e.clientX);
    scrubTo(pct);
    setMode("pushing");
    rootRef.current?.classList.add("is-pushing");
    rootRef.current?.classList.remove("is-snapping");
    e.currentTarget.setPointerCapture(e.pointerId);
    maybePluck(pct);
  }

  function onPointerMove(e: ReactPointerEvent<HTMLDivElement>) {
    if (!pressingRef.current) {
      return;
    }
    e.stopPropagation();
    const pct = percentFromPointer(e.clientX);
    scrubTo(pct);
    maybePluck(pct);
  }

  function onPointerUp(e: ReactPointerEvent<HTMLDivElement>) {
    if (!pressingRef.current) {
      return;
    }
    e.stopPropagation();
    pressingRef.current = false;
    targetRef.current = realRef.current;
    rootRef.current?.classList.remove("is-pushing");

    if (!springsRef.current || reduceRef.current) {
      snappingRef.current = false;
      scrubTo(realRef.current);
      setMode("idle");
      rootRef.current?.classList.remove("is-snapping");
    } else {
      snappingRef.current = true;
      velocityRef.current += snapImpulse(realRef.current, displayRef.current);
      setMode("snapping");
      rootRef.current?.classList.add("is-snapping");
      kickSnapRaf();
    }
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      /* already released */
    }
  }

  return (
    <div
      ref={rootRef}
      className={`cyber-bar push-bar is-${tone}${mode !== "idle" ? ` is-${mode}` : ""}`}
      style={{ ["--p" as string]: `${shown}%` }}
      role="progressbar"
      aria-valuenow={real}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={ariaLabel}
      onClick={(e) => e.stopPropagation()}
    >
      <div className="cyber-bar-copy">
        <span>{label}</span>
        <span className="cyber-bar-goal">{goal}</span>
      </div>
      <div className="cyber-bar-row">
        <div
          ref={trackRef}
          className="cyber-bar-track push-bar-track is-live"
          data-push-live="true"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
        >
          {showGoalMark && <span className="cyber-bar-goal-mark" aria-hidden />}
          <div ref={fillRef} className="cyber-bar-fill push-bar-fill">
            <span className="cyber-bar-stripes" />
            <span className="cyber-bar-sheen" />
          </div>
          <span className="cyber-bar-ticks" aria-hidden />
          <span ref={knobRef} className="push-bar-knob" aria-hidden />
        </div>
        <b ref={valueRef} className="cyber-bar-value">
          {shown}%
        </b>
      </div>
    </div>
  );
}
