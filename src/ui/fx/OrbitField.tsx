import { useEffect, useRef } from "react";
import { unlockAudio } from "../sounds";
import { playPluck } from "../sounds";
import { usePrefs } from "../prefs";
import { clamp, prefersReducedMotion } from "../push/spring";

type Body = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  hue: number;
  label: string;
};

/**
 * Constellation orbitale : fling les nœuds, gravité douce vers le centre,
 * collisions soft. Idéal empty states / playground profil.
 */
export function OrbitField({
  labels = ["SCAN", "GENRE", "TAG", "SYNC", "BASS", "ORDER"],
  className = "",
  height = 180,
}: {
  labels?: string[];
  className?: string;
  height?: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const bodiesRef = useRef<Body[]>([]);
  const dragRef = useRef<{ i: number; ox: number; oy: number } | null>(null);
  const { prefs } = usePrefs();
  const prefsRef = useRef(prefs);
  prefsRef.current = prefs;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      return;
    }

    const reduce = prefersReducedMotion();
    let raf = 0;
    let last = performance.now();
    let w = 0;
    let h = 0;
    let dpr = 1;

    function resize() {
      const parent = canvas!.parentElement;
      if (!parent) {
        return;
      }
      dpr = Math.min(2, window.devicePixelRatio || 1);
      w = parent.clientWidth;
      h = height;
      canvas!.width = Math.floor(w * dpr);
      canvas!.height = Math.floor(h * dpr);
      canvas!.style.width = `${w}px`;
      canvas!.style.height = `${h}px`;
      ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);

      if (bodiesRef.current.length === 0) {
        bodiesRef.current = labels.map((label, i) => {
          const ang = (i / labels.length) * Math.PI * 2;
          return {
            x: w / 2 + Math.cos(ang) * (w * 0.22),
            y: h / 2 + Math.sin(ang) * (h * 0.28),
            vx: 0,
            vy: 0,
            r: 16 + (i % 3) * 3,
            hue: (i * 47) % 360,
            label,
          };
        });
      }
    }

    resize();
    const ro = new ResizeObserver(resize);
    if (canvas.parentElement) {
      ro.observe(canvas.parentElement);
    }

    const tick = (now: number) => {
      const dt = Math.min(0.033, (now - last) / 1000);
      last = now;
      const bodies = bodiesRef.current;
      const cx = w / 2;
      const cy = h / 2;

      if (!reduce) {
        for (let i = 0; i < bodies.length; i += 1) {
          const b = bodies[i];
          if (dragRef.current?.i === i) {
            continue;
          }
          // gravité douce vers le centre
          b.vx += (cx - b.x) * 1.8 * dt;
          b.vy += (cy - b.y) * 1.8 * dt;
          b.vx *= 0.985;
          b.vy *= 0.985;
          b.x += b.vx * dt * 60;
          b.y += b.vy * dt * 60;

          // murs rubber-band
          if (b.x < b.r) {
            b.x = b.r;
            b.vx *= -0.55;
          }
          if (b.x > w - b.r) {
            b.x = w - b.r;
            b.vx *= -0.55;
          }
          if (b.y < b.r) {
            b.y = b.r;
            b.vy *= -0.55;
          }
          if (b.y > h - b.r) {
            b.y = h - b.r;
            b.vy *= -0.55;
          }
        }

        for (let i = 0; i < bodies.length; i += 1) {
          for (let j = i + 1; j < bodies.length; j += 1) {
            const a = bodies[i];
            const b = bodies[j];
            const dx = b.x - a.x;
            const dy = b.y - a.y;
            const dist = Math.hypot(dx, dy) || 1;
            const min = a.r + b.r + 4;
            if (dist < min) {
              const push = ((min - dist) / dist) * 0.5;
              const ox = dx * push;
              const oy = dy * push;
              a.x -= ox;
              a.y -= oy;
              b.x += ox;
              b.y += oy;
              a.vx -= ox * 0.4;
              a.vy -= oy * 0.4;
              b.vx += ox * 0.4;
              b.vy += oy * 0.4;
            }
          }
        }
      }

      ctx!.clearRect(0, 0, w, h);

      // liens
      ctx!.strokeStyle = "rgba(125, 255, 212, 0.12)";
      ctx!.lineWidth = 1;
      for (let i = 0; i < bodies.length; i += 1) {
        for (let j = i + 1; j < bodies.length; j += 1) {
          const a = bodies[i];
          const b = bodies[j];
          if (Math.hypot(a.x - b.x, a.y - b.y) < 110) {
            ctx!.beginPath();
            ctx!.moveTo(a.x, a.y);
            ctx!.lineTo(b.x, b.y);
            ctx!.stroke();
          }
        }
      }

      for (const b of bodies) {
        const g = ctx!.createRadialGradient(b.x, b.y, 0, b.x, b.y, b.r * 1.6);
        g.addColorStop(0, `hsla(${b.hue}, 80%, 70%, 0.95)`);
        g.addColorStop(1, `hsla(${b.hue}, 70%, 45%, 0.15)`);
        ctx!.fillStyle = g;
        ctx!.beginPath();
        ctx!.arc(b.x, b.y, b.r, 0, Math.PI * 2);
        ctx!.fill();
        ctx!.fillStyle = "rgba(10, 12, 16, 0.85)";
        ctx!.font = "600 8px IBM Plex Mono, monospace";
        ctx!.textAlign = "center";
        ctx!.textBaseline = "middle";
        ctx!.fillText(b.label.slice(0, 5), b.x, b.y);
      }

      raf = requestAnimationFrame(tick);
    };

    raf = requestAnimationFrame(tick);

    function hit(x: number, y: number): number {
      const bodies = bodiesRef.current;
      for (let i = bodies.length - 1; i >= 0; i -= 1) {
        const b = bodies[i];
        if (Math.hypot(b.x - x, b.y - y) <= b.r + 6) {
          return i;
        }
      }
      return -1;
    }

    function onDown(e: PointerEvent) {
      unlockAudio();
      const r = canvas!.getBoundingClientRect();
      const x = e.clientX - r.left;
      const y = e.clientY - r.top;
      const i = hit(x, y);
      if (i < 0) {
        return;
      }
      const b = bodiesRef.current[i];
      dragRef.current = { i, ox: x - b.x, oy: y - b.y };
      b.vx = 0;
      b.vy = 0;
      canvas!.setPointerCapture(e.pointerId);
      if (prefsRef.current.sounds) {
        playPluck(320 + i * 60, prefsRef.current.volume * 0.4, 0.6);
      }
    }

    function onMove(e: PointerEvent) {
      const drag = dragRef.current;
      if (!drag) {
        return;
      }
      const r = canvas!.getBoundingClientRect();
      const x = e.clientX - r.left;
      const y = e.clientY - r.top;
      const b = bodiesRef.current[drag.i];
      const nx = clamp(x - drag.ox, b.r, w - b.r);
      const ny = clamp(y - drag.oy, b.r, h - b.r);
      b.vx = (nx - b.x) * 0.35;
      b.vy = (ny - b.y) * 0.35;
      b.x = nx;
      b.y = ny;
    }

    function onUp(e: PointerEvent) {
      if (!dragRef.current) {
        return;
      }
      dragRef.current = null;
      try {
        canvas!.releasePointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
    }

    canvas.addEventListener("pointerdown", onDown);
    canvas.addEventListener("pointermove", onMove);
    canvas.addEventListener("pointerup", onUp);
    canvas.addEventListener("pointercancel", onUp);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      canvas.removeEventListener("pointerdown", onDown);
      canvas.removeEventListener("pointermove", onMove);
      canvas.removeEventListener("pointerup", onUp);
      canvas.removeEventListener("pointercancel", onUp);
    };
  }, [height, labels]);

  return (
    <div className={`orbit-field ${className}`.trim()} aria-hidden>
      <canvas ref={canvasRef} />
      <span className="orbit-field-hint">fling les nœuds</span>
    </div>
  );
}
