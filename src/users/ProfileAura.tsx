import {
  useEffect,
  useRef,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { prefersReducedMotion } from "../ui/push/spring";

type Particle = {
  a: number;
  r: number;
  s: number;
  size: number;
  phase: number;
  trail: number;
};

type Props = {
  name: string;
  color: string;
  size?: number;
  /** Photo (profil Spotify, etc.) — sinon monogramme / nom. */
  imageUrl?: string | null;
  /** Mode compact (rail / gate) : moins de particules, pas de hint. */
  compact?: boolean;
  className?: string;
  interactive?: boolean;
  /** Coupe le rAF (ex. avatar hors écran dans le fan fermé). */
  paused?: boolean;
};

/**
 * Orbe signature BassOrder — anneaux contra-rotatifs, particules aimantées,
 * glare curseur, photo optionnelle. Même look partout.
 */
export function ProfileAura({
  name,
  color,
  size = 220,
  imageUrl = null,
  compact = false,
  className = "",
  interactive = true,
  paused = false,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const pointer = useRef({ x: 0.5, y: 0.5, inside: false, down: false });
  const reduceRef = useRef(false);
  const pausedRef = useRef(paused);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const imgReady = useRef(false);

  pausedRef.current = paused;

  const label = (() => {
    const raw = name.trim() || "?";
    if (!compact) {
      return raw.length > 10 ? `${raw.slice(0, 9)}…` : raw;
    }
    if (raw.length <= 2) {
      return raw.toUpperCase();
    }
    const parts = raw.split(/\s+/).filter(Boolean);
    if (parts.length >= 2) {
      return `${parts[0][0] ?? ""}${parts[1][0] ?? ""}`.toUpperCase();
    }
    return raw.slice(0, 2).toUpperCase();
  })();

  useEffect(() => {
    imgReady.current = false;
    imgRef.current = null;
    if (!imageUrl) {
      return;
    }
    const img = new Image();
    img.decoding = "async";
    img.onload = () => {
      imgRef.current = img;
      imgReady.current = true;
    };
    img.onerror = () => {
      imgRef.current = null;
      imgReady.current = false;
    };
    img.src = imageUrl;
  }, [imageUrl]);

  useEffect(() => {
    reduceRef.current = prefersReducedMotion();
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      return;
    }

    let raf = 0;
    let dpr = 1;
    let w = size;
    let h = size;
    let t0 = performance.now();
    const micro = size < 48;
    const count = micro ? 10 : compact ? 22 : 56;
    const scale = size / 220;

    const particles: Particle[] = Array.from({ length: count }, (_, i) => ({
      a: (i / count) * Math.PI * 2 + (i % 3) * 0.12,
      r: 0.36 + (i % 6) * 0.028,
      s: 0.28 + (i % 9) * 0.07,
      size: (micro ? 0.45 : compact ? 0.75 : 1.25) + (i % 4) * 0.4,
      phase: Math.random() * Math.PI * 2,
      trail: 0.012 + (i % 5) * 0.004,
    }));

    function resize() {
      dpr = Math.min(2, window.devicePixelRatio || 1);
      w = size;
      h = size;
      canvas!.width = Math.floor(w * dpr);
      canvas!.height = Math.floor(h * dpr);
      canvas!.style.width = `${w}px`;
      canvas!.style.height = `${h}px`;
      ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    resize();

    function hexToRgb(hex: string): [number, number, number] {
      const raw = hex.replace("#", "");
      const full =
        raw.length === 3
          ? raw
              .split("")
              .map((c) => c + c)
              .join("")
          : raw;
      const n = Number.parseInt(full, 16);
      if (Number.isNaN(n)) {
        return [94, 196, 176];
      }
      return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
    }

    const [cr, cg, cb] = hexToRgb(color.startsWith("#") ? color : "#5EC4B0");

    const tick = (now: number) => {
      if (document.hidden || pausedRef.current) {
        raf = requestAnimationFrame(tick);
        return;
      }

      const t = (now - t0) / 1000;
      const cx = w / 2;
      const cy = h / 2;
      const R = Math.min(w, h) * (micro ? 0.36 : compact ? 0.37 : 0.31);
      const ringPad = Math.max(1.5, 5.5 * scale);
      const px = pointer.current.x * w;
      const py = pointer.current.y * h;
      const hot =
        interactive && pointer.current.inside && !reduceRef.current ? 1 : 0;
      const press = pointer.current.down ? 1 : 0;
      const breath = reduceRef.current
        ? 1
        : 1 + Math.sin(t * 1.6) * 0.018 + hot * 0.03;

      ctx!.clearRect(0, 0, w, h);

      /* Bloom externe */
      const bloomR = R * (2.05 + hot * 0.25);
      const bloom = ctx!.createRadialGradient(cx, cy, R * 0.15, cx, cy, bloomR);
      bloom.addColorStop(0, `rgba(${cr},${cg},${cb},${0.32 + hot * 0.2})`);
      bloom.addColorStop(0.45, `rgba(${cr},${cg},${cb},${0.1 + hot * 0.08})`);
      bloom.addColorStop(1, "rgba(0,0,0,0)");
      ctx!.fillStyle = bloom;
      ctx!.fillRect(0, 0, w, h);

      /* Halo soft sous le disque */
      ctx!.beginPath();
      ctx!.arc(cx, cy + R * 0.08, R * 0.92, 0, Math.PI * 2);
      ctx!.fillStyle = `rgba(0,0,0,${0.22 + press * 0.08})`;
      ctx!.fill();

      const coreR = R * breath * (1 - press * 0.04);

      /* Photo ou disque couleur */
      ctx!.save();
      ctx!.beginPath();
      ctx!.arc(cx, cy, coreR, 0, Math.PI * 2);
      ctx!.clip();

      if (imgReady.current && imgRef.current) {
        const img = imgRef.current;
        const iw = img.naturalWidth || img.width;
        const ih = img.naturalHeight || img.height;
        const side = Math.max(iw, ih);
        const sx = (iw - side) / 2;
        const sy = (ih - side) / 2;
        ctx!.drawImage(img, sx, sy, side, side, cx - coreR, cy - coreR, coreR * 2, coreR * 2);
        /* Voile pour lire les anneaux */
        const veil = ctx!.createRadialGradient(cx, cy, coreR * 0.35, cx, cy, coreR);
        veil.addColorStop(0, "rgba(0,0,0,0)");
        veil.addColorStop(0.7, "rgba(0,0,0,0.05)");
        veil.addColorStop(1, `rgba(${cr},${cg},${cb},0.22)`);
        ctx!.fillStyle = veil;
        ctx!.fillRect(cx - coreR, cy - coreR, coreR * 2, coreR * 2);
      } else {
        const core = ctx!.createRadialGradient(
          cx - coreR * 0.3 + hot * (px - cx) * 0.08,
          cy - coreR * 0.34 + hot * (py - cy) * 0.08,
          coreR * 0.06,
          cx,
          cy,
          coreR,
        );
        core.addColorStop(0, "#ffffff");
        core.addColorStop(
          0.16,
          `rgb(${Math.min(255, cr + 42)},${Math.min(255, cg + 42)},${Math.min(255, cb + 42)})`,
        );
        core.addColorStop(0.52, `rgb(${cr},${cg},${cb})`);
        core.addColorStop(
          1,
          `rgb(${Math.max(0, cr - 48)},${Math.max(0, cg - 48)},${Math.max(0, cb - 48)})`,
        );
        ctx!.fillStyle = core;
        ctx!.fillRect(cx - coreR, cy - coreR, coreR * 2, coreR * 2);

        /* Specular suivant le curseur */
        const gx = hot ? px : cx - coreR * 0.22;
        const gy = hot ? py : cy - coreR * 0.28;
        const glare = ctx!.createRadialGradient(gx, gy, 0, gx, gy, coreR * 0.7);
        glare.addColorStop(0, `rgba(255,255,255,${0.45 + hot * 0.25})`);
        glare.addColorStop(0.35, "rgba(255,255,255,0.12)");
        glare.addColorStop(1, "rgba(255,255,255,0)");
        ctx!.fillStyle = glare;
        ctx!.fillRect(cx - coreR, cy - coreR, coreR * 2, coreR * 2);
      }
      ctx!.restore();

      /* Anneau base */
      ctx!.beginPath();
      ctx!.arc(cx, cy, coreR + ringPad * 0.35, 0, Math.PI * 2);
      ctx!.strokeStyle = `rgba(${cr},${cg},${cb},${0.45 + hot * 0.25})`;
      ctx!.lineWidth = Math.max(1, 1.6 * scale);
      ctx!.stroke();

      /* Double arcs contra-rotatifs */
      const spinA = t * (1.55 + hot * 1.2);
      const spinB = -t * (1.1 + hot * 0.8);
      drawArc(
        ctx!,
        cx,
        cy,
        coreR + ringPad,
        spinA,
        1.25,
        `rgba(255,255,255,${0.75 + hot * 0.2})`,
        Math.max(1.3, 2.2 * scale),
      );
      drawArc(
        ctx!,
        cx,
        cy,
        coreR + ringPad * 1.55,
        spinB,
        0.85,
        `rgba(${cr},${cg},${cb},${0.7 + hot * 0.25})`,
        Math.max(1, 1.6 * scale),
      );

      /* Troisième trait pointillé (luxe) */
      if (!micro) {
        ctx!.save();
        ctx!.setLineDash([2.2 * scale, 3.8 * scale]);
        ctx!.beginPath();
        ctx!.arc(cx, cy, coreR + ringPad * 2.15, spinA * 0.4, spinA * 0.4 + Math.PI * 1.4);
        ctx!.strokeStyle = `rgba(${cr},${cg},${cb},${0.35 + hot * 0.2})`;
        ctx!.lineWidth = Math.max(0.8, 1.1 * scale);
        ctx!.stroke();
        ctx!.restore();
      }

      /* Particules aimantées */
      for (const p of particles) {
        const wobble = reduceRef.current
          ? 0
          : Math.sin(t * 2.4 + p.phase) * 0.02;
        let ang = p.a + t * p.s * (1 + hot * 0.55);
        let rad = (p.r + wobble) * Math.min(w, h) * (0.92 + hot * 0.06);

        if (hot) {
          const x = cx + Math.cos(ang) * rad;
          const y = cy + Math.sin(ang) * rad;
          const dx = px - x;
          const dy = py - y;
          const dist = Math.hypot(dx, dy) || 1;
          const reach = 36 + 70 * scale;
          if (dist < reach) {
            const f = (1 - dist / reach) * (14 + 12 * scale);
            rad += (dx / dist) * f * 0.18;
            ang += (dy / dist) * f * 0.0025;
          }
        }

        const x = cx + Math.cos(ang) * rad;
        const y = cy + Math.sin(ang) * rad;

        /* Mini trail */
        if (!reduceRef.current && !micro) {
          const tx = cx + Math.cos(ang - p.trail) * rad;
          const ty = cy + Math.sin(ang - p.trail) * rad;
          const grad = ctx!.createLinearGradient(tx, ty, x, y);
          grad.addColorStop(0, `rgba(${cr},${cg},${cb},0)`);
          grad.addColorStop(1, `rgba(${cr},${cg},${cb},0.55)`);
          ctx!.strokeStyle = grad;
          ctx!.lineWidth = Math.max(0.6, p.size * 0.35);
          ctx!.beginPath();
          ctx!.moveTo(tx, ty);
          ctx!.lineTo(x, y);
          ctx!.stroke();
        }

        const g = ctx!.createRadialGradient(x, y, 0, x, y, p.size * 3.2);
        g.addColorStop(0, "rgba(255,255,255,0.95)");
        g.addColorStop(0.3, `rgba(${cr},${cg},${cb},0.9)`);
        g.addColorStop(1, `rgba(${cr},${cg},${cb},0)`);
        ctx!.fillStyle = g;
        ctx!.beginPath();
        ctx!.arc(x, y, p.size * (2 + hot * 0.5), 0, Math.PI * 2);
        ctx!.fill();
      }

      /* Hotspot curseur */
      if (hot) {
        const spot = ctx!.createRadialGradient(px, py, 0, px, py, 18 + 28 * scale);
        spot.addColorStop(0, "rgba(255,255,255,0.35)");
        spot.addColorStop(0.4, `rgba(${cr},${cg},${cb},0.18)`);
        spot.addColorStop(1, "rgba(0,0,0,0)");
        ctx!.fillStyle = spot;
        ctx!.fillRect(0, 0, w, h);
      }

      raf = requestAnimationFrame(tick);
    };

    raf = requestAnimationFrame(tick);

    function onVis() {
      reduceRef.current = prefersReducedMotion();
    }
    document.addEventListener("visibilitychange", onVis);

    return () => {
      cancelAnimationFrame(raf);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [color, compact, interactive, size]);

  function onMove(e: ReactPointerEvent<HTMLDivElement>) {
    if (!interactive) {
      return;
    }
    const r = e.currentTarget.getBoundingClientRect();
    pointer.current = {
      ...pointer.current,
      x: (e.clientX - r.left) / r.width,
      y: (e.clientY - r.top) / r.height,
      inside: true,
    };
  }

  function onLeave() {
    pointer.current.inside = false;
    pointer.current.down = false;
  }

  const showGlyph = !imageUrl;

  return (
    <div
      className={`profile-aura${compact ? " is-compact" : ""}${imageUrl ? " has-photo" : ""}${interactive ? " is-live" : ""} ${className}`.trim()}
      style={
        {
          width: size,
          height: size,
          ["--aura-color" as string]: color,
        } as CSSProperties
      }
      onPointerMove={onMove}
      onPointerLeave={onLeave}
      onPointerDown={() => {
        if (interactive) {
          pointer.current.down = true;
        }
      }}
      onPointerUp={() => {
        pointer.current.down = false;
      }}
      role="img"
      aria-label={`Avatar de ${name}`}
    >
      <span className="profile-aura-shell" aria-hidden />
      <canvas ref={canvasRef} />
      {showGlyph && <span className="profile-aura-name">{label}</span>}
      {!compact && (
        <span className="profile-aura-hint" aria-hidden>
          bouge le curseur
        </span>
      )}
    </div>
  );
}

function drawArc(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  radius: number,
  start: number,
  length: number,
  stroke: string,
  lineWidth: number,
) {
  ctx.beginPath();
  ctx.arc(cx, cy, radius, start, start + length);
  ctx.strokeStyle = stroke;
  ctx.lineWidth = lineWidth;
  ctx.lineCap = "round";
  ctx.stroke();
}

/** Teinte stable à partir d’un nom (profils Spotify sans couleur user). */
export function auraColorFromName(name: string, fallback = "#1ED760"): string {
  const palette = [
    "#1ED760",
    "#5EC4B0",
    "#7B93D4",
    "#C9A35A",
    "#D4897A",
    "#9B8EC4",
    "#6FA88A",
    "#6A9BB8",
  ];
  let h = 2166136261;
  for (let i = 0; i < name.length; i++) {
    h ^= name.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return palette[Math.abs(h) % palette.length] ?? fallback;
}
