import {
  useEffect,
  useRef,
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

/** Anneau de couverture jouable (KPI local / Spotify) — vert = classé, rouge = perte. */
export function PushRing({
  percent,
  lossPercent = 0,
  className = "",
  active = true,
}: {
  percent: number;
  /** Arc rouge depuis l’autre sens (doublons / poubelle / parasites). */
  lossPercent?: number;
  className?: string;
  active?: boolean;
}) {
  const real = clamp(percent, 0, 100);
  const lossReal = clamp(lossPercent, 0, Math.max(0, 100 - real));
  const { prefs } = usePrefs();
  const prefsRef = useRef(prefs);
  prefsRef.current = prefs;
  /** Drag si le panneau est actif ; springs seulement si playful. */
  const interactive = active;
  const springs = prefs.playful && interactive;

  const r = 30;
  const c = 2 * Math.PI * r;
  const rootRef = useRef<SVGSVGElement>(null);
  const fgRef = useRef<SVGCircleElement>(null);
  const lossElRef = useRef<SVGCircleElement>(null);
  const displayRef = useRef(real);
  const velocityRef = useRef(0);
  const targetRef = useRef(real);
  const realRef = useRef(real);
  const lossRefValue = useRef(lossReal);
  const pressingRef = useRef(false);
  const snappingRef = useRef(false);
  const lastSoundAt = useRef(0);
  const lastSoundPct = useRef(real);
  const reduceRef = useRef(false);
  const rafRef = useRef(0);
  const springsRef = useRef(springs);
  springsRef.current = springs;
  const interactiveRef = useRef(interactive);
  interactiveRef.current = interactive;

  realRef.current = real;
  lossRefValue.current = lossReal;

  function paint(visual: number, lossVisual = lossRefValue.current) {
    const fg = fgRef.current;
    if (fg) {
      fg.style.strokeDashoffset = String(c - (visual / 100) * c);
      const glow = Math.min(
        1,
        Math.abs(velocityRef.current) * 0.012 + (pressingRef.current ? 0.4 : 0),
      );
      fg.style.setProperty("--ring-glow", String(glow));
    }
    const loss = lossElRef.current;
    if (loss) {
      const capped = clamp(lossVisual, 0, Math.max(0, 100 - visual));
      loss.style.strokeDashoffset = String(c - (capped / 100) * c);
      loss.style.opacity = capped > 0.05 ? "1" : "0";
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
        -6,
        112,
      );
      displayRef.current = next.display;
      velocityRef.current = next.velocity;
      const visual = clamp(displayRef.current, 0, 100);
      paint(visual);

      if (
        snapping &&
        isSettled(
          displayRef.current,
          velocityRef.current,
          realRef.current,
          0.4,
          2.5,
        )
      ) {
        snappingRef.current = false;
        displayRef.current = realRef.current;
        velocityRef.current = 0;
        paint(realRef.current);
        rootRef.current?.classList.remove("is-snapping");
        rafRef.current = 0;
        return;
      }

      const settled =
        !pressing &&
        !snapping &&
        isSettled(
          displayRef.current,
          velocityRef.current,
          realRef.current,
          0.4,
          2.5,
        );
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
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = 0;
      }
      displayRef.current = real;
      velocityRef.current = 0;
      paint(real, lossReal);
      return;
    }
    reduceRef.current = prefersReducedMotion();
    if (springs) {
      paint(displayRef.current, lossReal);
      kickRaf();
    } else {
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = 0;
      }
      displayRef.current = real;
      velocityRef.current = 0;
      paint(real, lossReal);
    }
  }, [real, lossReal, interactive, springs, c]);

  useEffect(
    () => () => {
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
      }
    },
    [],
  );

  function percentFromPointer(clientX: number, clientY: number): number {
    const el = rootRef.current;
    if (!el) {
      return realRef.current;
    }
    const rect = el.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    let ang = Math.atan2(clientX - cx, cy - clientY);
    if (ang < 0) {
      ang += Math.PI * 2;
    }
    return clamp((ang / (Math.PI * 2)) * 100, 0, 100);
  }

  function maybePluck(pct: number) {
    const { sounds, volume } = prefsRef.current;
    if (!sounds) {
      return;
    }
    const now = performance.now();
    if (
      now - lastSoundAt.current < 55 ||
      Math.abs(pct - lastSoundPct.current) < 3
    ) {
      return;
    }
    lastSoundAt.current = now;
    lastSoundPct.current = pct;
    playPluck(240 + (pct / 100) * 720, volume * 0.45, 0.75);
  }

  function onPointerDown(e: ReactPointerEvent<SVGSVGElement>) {
    if (!interactiveRef.current) {
      return;
    }
    e.stopPropagation();
    e.preventDefault();
    unlockAudio();
    reduceRef.current = prefersReducedMotion();
    pressingRef.current = true;
    snappingRef.current = false;
    const pct = percentFromPointer(e.clientX, e.clientY);
    targetRef.current = pct;
    displayRef.current = pct;
    velocityRef.current = 0;
    paint(pct);
    rootRef.current?.classList.add("is-pushing");
    rootRef.current?.classList.remove("is-snapping");
    e.currentTarget.setPointerCapture(e.pointerId);
    maybePluck(pct);
    kickRaf();
  }

  function onPointerMove(e: ReactPointerEvent<SVGSVGElement>) {
    if (!pressingRef.current) {
      return;
    }
    const pct = percentFromPointer(e.clientX, e.clientY);
    targetRef.current = pct;
    // Scrub 1:1 pendant le drag.
    displayRef.current = pct;
    velocityRef.current = 0;
    paint(pct);
    maybePluck(pct);
  }

  function onPointerUp(e: ReactPointerEvent<SVGSVGElement>) {
    if (!pressingRef.current) {
      return;
    }
    pressingRef.current = false;
    targetRef.current = realRef.current;
    rootRef.current?.classList.remove("is-pushing");
    if (!springsRef.current || reduceRef.current) {
      snappingRef.current = false;
      displayRef.current = realRef.current;
      velocityRef.current = 0;
      paint(realRef.current);
      rootRef.current?.classList.remove("is-snapping");
    } else {
      snappingRef.current = true;
      velocityRef.current += snapImpulse(realRef.current, displayRef.current, 0.4);
      rootRef.current?.classList.add("is-snapping");
      kickRaf();
    }
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      /* already released */
    }
  }

  const hasLoss = lossReal > 0.05;

  return (
    <svg
      ref={rootRef}
      className={`coverage-ring push-ring ${className}${interactive ? " is-live" : " is-inert"}`.trim()}
      viewBox="0 0 72 72"
      aria-hidden
      data-push-live={interactive ? "true" : "false"}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    >
      <circle className="coverage-ring-bg" cx="36" cy="36" r={r} />
      <circle
        ref={lossElRef}
        className="coverage-ring-loss"
        cx="36"
        cy="36"
        r={r}
        transform="translate(72 0) scale(-1 1)"
        style={{
          strokeDasharray: c,
          strokeDashoffset: c - (lossReal / 100) * c,
          opacity: hasLoss ? 1 : 0,
        }}
      />
      <circle
        ref={fgRef}
        className="coverage-ring-fg"
        cx="36"
        cy="36"
        r={r}
        style={{
          strokeDasharray: c,
          strokeDashoffset: c - (real / 100) * c,
        }}
      />
    </svg>
  );
}
