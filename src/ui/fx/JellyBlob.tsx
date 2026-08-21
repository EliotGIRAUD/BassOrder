import {
  useEffect,
  useRef,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { unlockAudio } from "../sounds";
import { prefersReducedMotion } from "../push/spring";

/**
 * Blob jelly : déforme sous le doigt (soft-body light) puis rebondit.
 * Tendance 2026 — haptic-style squash sans canvas lourd.
 */
export function JellyBlob({
  color = "#7dffd4",
  label,
  className = "",
  size = 120,
}: {
  color?: string;
  label?: string;
  className?: string;
  size?: number;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const blobRef = useRef<HTMLDivElement>(null);
  const state = useRef({
    sx: 1,
    sy: 1,
    vx: 0,
    vy: 0,
    pressing: false,
    px: 0.5,
    py: 0.5,
  });
  const reduceRef = useRef(false);

  useEffect(() => {
    reduceRef.current = prefersReducedMotion();
    let raf = 0;
    let last = performance.now();

    const tick = (now: number) => {
      const dt = Math.min(0.033, (now - last) / 1000);
      last = now;
      const s = state.current;
      const blob = blobRef.current;

      let tx = 1;
      let ty = 1;
      if (s.pressing && !reduceRef.current) {
        // squash vers le point de pression
        const dx = (s.px - 0.5) * 2;
        const dy = (s.py - 0.5) * 2;
        tx = 1 + Math.abs(dy) * 0.35 - Math.abs(dx) * 0.18;
        ty = 1 + Math.abs(dx) * 0.35 - Math.abs(dy) * 0.18;
        tx = Math.max(0.72, Math.min(1.28, tx));
        ty = Math.max(0.72, Math.min(1.28, ty));
      }

      const ax = (tx - s.sx) * 54 - s.vx * 9;
      const ay = (ty - s.sy) * 54 - s.vy * 9;
      s.vx += ax * dt;
      s.vy += ay * dt;
      s.sx += s.vx * dt;
      s.sy += s.vy * dt;

      if (blob) {
        const skewX = s.pressing ? (s.px - 0.5) * 12 : 0;
        const skewY = s.pressing ? (s.py - 0.5) * 8 : 0;
        blob.style.transform = `scale(${s.sx.toFixed(3)}, ${s.sy.toFixed(3)}) skew(${skewX.toFixed(2)}deg, ${skewY.toFixed(2)}deg)`;
        blob.style.setProperty(
          "--jelly-glow",
          String(Math.min(1, Math.hypot(s.vx, s.vy) * 0.08 + (s.pressing ? 0.45 : 0))),
        );
      }

      raf = requestAnimationFrame(tick);
    };

    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  function localPoint(e: ReactPointerEvent<HTMLDivElement>) {
    const r = e.currentTarget.getBoundingClientRect();
    return {
      px: (e.clientX - r.left) / r.width,
      py: (e.clientY - r.top) / r.height,
    };
  }

  function onDown(e: ReactPointerEvent<HTMLDivElement>) {
    unlockAudio();
    const p = localPoint(e);
    state.current.pressing = true;
    state.current.px = p.px;
    state.current.py = p.py;
    e.currentTarget.setPointerCapture(e.pointerId);
    rootRef.current?.classList.add("is-pressing");
  }

  function onMove(e: ReactPointerEvent<HTMLDivElement>) {
    if (!state.current.pressing) {
      return;
    }
    const p = localPoint(e);
    state.current.px = p.px;
    state.current.py = p.py;
  }

  function onUp(e: ReactPointerEvent<HTMLDivElement>) {
    state.current.pressing = false;
    // impulsion jelly
    state.current.vx += (1 - state.current.sx) * 8;
    state.current.vy += (1 - state.current.sy) * 8;
    rootRef.current?.classList.remove("is-pressing");
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      /* already released */
    }
  }

  return (
    <div
      ref={rootRef}
      className={`jelly-blob ${className}`.trim()}
      style={{ width: size, height: size, ["--jelly-color" as string]: color }}
      role="img"
      aria-label={label ?? "Blob interactif"}
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onPointerCancel={onUp}
    >
      <div ref={blobRef} className="jelly-blob-core">
        {label && <span className="jelly-blob-label">{label}</span>}
      </div>
    </div>
  );
}
