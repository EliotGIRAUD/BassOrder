import {
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
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

/** Fill horizontale jouable (folders, analysis, triage, jobs…). */
export function PushFill({
  value,
  className = "",
  indeterminate = false,
  active = true,
}: {
  value: number;
  className?: string;
  indeterminate?: boolean;
  /** Coupe le rAF idle (panneau caché). */
  active?: boolean;
}) {
  const real = clamp(value, 0, 100);
  const { prefs } = usePrefs();
  const prefsRef = useRef(prefs);
  prefsRef.current = prefs;
  /** Drag toujours dispo ; `playful` ne coupe que les springs idle. */
  const interactive = active && !indeterminate;
  const springs = prefs.playful && interactive;

  const trackRef = useRef<HTMLDivElement>(null);
  const fillRef = useRef<HTMLSpanElement>(null);
  const displayRef = useRef(real);
  const velocityRef = useRef(0);
  const targetRef = useRef(real);
  const realRef = useRef(real);
  const pressingRef = useRef(false);
  const snappingRef = useRef(false);
  const lastSoundAt = useRef(0);
  const lastSoundPct = useRef(real);
  const reduceRef = useRef(prefersReducedMotion());
  const rafRef = useRef(0);
  const springsRef = useRef(springs);
  springsRef.current = springs;
  const interactiveRef = useRef(interactive);
  interactiveRef.current = interactive;
  const [mode, setMode] = useState<"idle" | "pushing" | "snapping">("idle");

  realRef.current = real;

  function paint(pct: number) {
    if (fillRef.current) {
      fillRef.current.style.width = `${pct}%`;
    }
  }

  function stopRaf() {
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = 0;
    }
  }

  function kickRaf() {
    if (rafRef.current) {
      return;
    }
    let last = performance.now();
    const tick = (now: number) => {
      const pressing = pressingRef.current;
      const snapping = snappingRef.current;
      const useSpring = springsRef.current || pressing || snapping;

      if (!useSpring) {
        displayRef.current = realRef.current;
        velocityRef.current = 0;
        paint(realRef.current);
        rafRef.current = 0;
        return;
      }

      const dt = Math.min(0.033, (now - last) / 1000);
      last = now;
      const target = pressing ? targetRef.current : realRef.current;
      const instant = !springsRef.current || reduceRef.current;
      const next = stepSpring(
        displayRef.current,
        velocityRef.current,
        target,
        dt,
        snapping,
        instant,
      );
      displayRef.current = next.display;
      velocityRef.current = next.velocity;
      const visual = clamp(displayRef.current, 0, 100);
      paint(visual);

      if (
        snapping &&
        isSettled(displayRef.current, velocityRef.current, realRef.current)
      ) {
        snappingRef.current = false;
        displayRef.current = realRef.current;
        velocityRef.current = 0;
        paint(realRef.current);
        setMode("idle");
        rafRef.current = 0;
        return;
      }

      const settled =
        !pressing &&
        !snapping &&
        isSettled(displayRef.current, velocityRef.current, realRef.current);
      if (settled) {
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
    if (!pressingRef.current) {
      targetRef.current = real;
    }
    if (!interactive) {
      stopRaf();
      displayRef.current = real;
      velocityRef.current = 0;
      paint(real);
      return;
    }
    if (springs) {
      kickRaf();
    } else {
      stopRaf();
      displayRef.current = real;
      velocityRef.current = 0;
      paint(real);
    }
  }, [real, interactive, springs]);

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
      now - lastSoundAt.current < 60 ||
      Math.abs(pct - lastSoundPct.current) < 3
    ) {
      return;
    }
    lastSoundAt.current = now;
    lastSoundPct.current = pct;
    playPluck(200 + (pct / 100) * 700, volume * 0.4, 0.7);
  }

  function onPointerDown(e: ReactPointerEvent<HTMLDivElement>) {
    if (!interactiveRef.current) {
      return;
    }
    e.stopPropagation();
    e.preventDefault();
    unlockAudio();
    reduceRef.current = prefersReducedMotion();
    pressingRef.current = true;
    snappingRef.current = false;
    const pct = percentFromPointer(e.clientX);
    targetRef.current = pct;
    displayRef.current = pct;
    velocityRef.current = 0;
    paint(pct);
    setMode("pushing");
    e.currentTarget.setPointerCapture(e.pointerId);
    maybePluck(pct);
    kickRaf();
  }

  function onPointerMove(e: ReactPointerEvent<HTMLDivElement>) {
    if (!pressingRef.current) {
      return;
    }
    e.stopPropagation();
    const pct = percentFromPointer(e.clientX);
    targetRef.current = pct;
    // Scrub 1:1 pendant le drag (le spring ne sert qu’au snap).
    displayRef.current = pct;
    velocityRef.current = 0;
    paint(pct);
    maybePluck(pct);
  }

  function onPointerUp(e: ReactPointerEvent<HTMLDivElement>) {
    if (!pressingRef.current) {
      return;
    }
    e.stopPropagation();
    pressingRef.current = false;
    snappingRef.current = true;
    targetRef.current = realRef.current;
    if (!springsRef.current || reduceRef.current) {
      displayRef.current = realRef.current;
      velocityRef.current = 0;
      paint(realRef.current);
      snappingRef.current = false;
      setMode("idle");
    } else {
      velocityRef.current += snapImpulse(realRef.current, displayRef.current);
      setMode("snapping");
      kickRaf();
    }
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      /* already released */
    }
  }

  return (
    <div
      ref={trackRef}
      className={`push-fill ${className}${mode !== "idle" ? ` is-${mode}` : ""}${indeterminate ? " is-indeterminate" : ""}${interactive ? " is-live" : " is-inert"}`.trim()}
      data-push-live={interactive ? "true" : "false"}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    >
      <span
        ref={fillRef}
        className={indeterminate ? "is-indeterminate" : undefined}
        style={indeterminate ? undefined : { width: `${real}%` }}
      />
    </div>
  );
}
