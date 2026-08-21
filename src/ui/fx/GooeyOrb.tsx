import {
  useEffect,
  useId,
  useRef,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { unlockAudio } from "../sounds";
import { prefersReducedMotion } from "../push/spring";

/**
 * Gooey metaball (SVG feGaussianBlur + feColorMatrix) — satellites en orbite
 * qui fusionnent avec le cœur. Remplace l’ancien jelly skew cassé.
 */
export function GooeyOrb({
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
  const uid = useId().replace(/:/g, "");
  const filterId = `gooey-${uid}`;
  const rootRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const mainRef = useRef<SVGCircleElement>(null);
  const aRef = useRef<SVGCircleElement>(null);
  const bRef = useRef<SVGCircleElement>(null);
  const pressRef = useRef({ on: false, x: 0.5, y: 0.5 });
  const reduceRef = useRef(false);

  useEffect(() => {
    reduceRef.current = prefersReducedMotion();
    let raf = 0;
    let t0 = performance.now();

    const tick = (now: number) => {
      const t = (now - t0) / 1000;
      const press = pressRef.current;
      const main = mainRef.current;
      const a = aRef.current;
      const b = bRef.current;
      if (!main || !a || !b) {
        raf = requestAnimationFrame(tick);
        return;
      }

      const cx = 50;
      const cy = 50;
      let mainR = 22;
      if (press.on && !reduceRef.current) {
        const dx = (press.x - 0.5) * 14;
        const dy = (press.y - 0.5) * 14;
        main.setAttribute("cx", String(cx + dx * 0.35));
        main.setAttribute("cy", String(cy + dy * 0.35));
        mainR = 22 + Math.hypot(dx, dy) * 0.12;
      } else {
        main.setAttribute("cx", String(cx));
        main.setAttribute("cy", String(cy));
      }
      main.setAttribute("r", String(mainR));

      if (!reduceRef.current) {
        const speed = press.on ? 2.8 : 1.15;
        const orbit = press.on ? 18 : 26;
        const ax = cx + Math.cos(t * speed) * orbit;
        const ay = cy + Math.sin(t * speed) * orbit * 0.85;
        const bx = cx + Math.cos(t * speed * -0.85 + 2.1) * (orbit * 0.78);
        const by = cy + Math.sin(t * speed * -0.85 + 2.1) * (orbit * 0.7);
        a.setAttribute("cx", String(ax));
        a.setAttribute("cy", String(ay));
        a.setAttribute("r", press.on ? "11" : "9");
        b.setAttribute("cx", String(bx));
        b.setAttribute("cy", String(by));
        b.setAttribute("r", press.on ? "8" : "7");
      }

      raf = requestAnimationFrame(tick);
    };

    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  function local(e: ReactPointerEvent<HTMLDivElement>) {
    const r = e.currentTarget.getBoundingClientRect();
    return {
      x: (e.clientX - r.left) / r.width,
      y: (e.clientY - r.top) / r.height,
    };
  }

  function onDown(e: ReactPointerEvent<HTMLDivElement>) {
    unlockAudio();
    const p = local(e);
    pressRef.current = { on: true, x: p.x, y: p.y };
    e.currentTarget.setPointerCapture(e.pointerId);
    rootRef.current?.classList.add("is-pressing");
  }

  function onMove(e: ReactPointerEvent<HTMLDivElement>) {
    if (!pressRef.current.on) {
      return;
    }
    const p = local(e);
    pressRef.current.x = p.x;
    pressRef.current.y = p.y;
  }

  function onUp(e: ReactPointerEvent<HTMLDivElement>) {
    pressRef.current.on = false;
    rootRef.current?.classList.remove("is-pressing");
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
  }

  return (
    <div
      ref={rootRef}
      className={`gooey-orb ${className}`.trim()}
      style={{
        width: size,
        height: size,
        ["--gooey-color" as string]: color,
      }}
      role="img"
      aria-label={label ? `Blob ${label}` : "Blob liquide interactif"}
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onPointerCancel={onUp}
    >
      <svg
        ref={svgRef}
        className="gooey-orb-svg"
        viewBox="0 0 100 100"
        aria-hidden
      >
        <defs>
          <filter
            id={filterId}
            x="-40%"
            y="-40%"
            width="180%"
            height="180%"
            colorInterpolationFilters="sRGB"
          >
            <feGaussianBlur in="SourceGraphic" stdDeviation="4.5" result="blur" />
            <feColorMatrix
              in="blur"
              mode="matrix"
              values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 18 -7"
              result="goo"
            />
            <feComposite in="SourceGraphic" in2="goo" operator="atop" />
          </filter>
          <radialGradient id={`${filterId}-grad`} cx="35%" cy="30%" r="70%">
            <stop offset="0%" stopColor="#fff" stopOpacity="0.55" />
            <stop offset="45%" stopColor={color} stopOpacity="1" />
            <stop offset="100%" stopColor={color} stopOpacity="0.85" />
          </radialGradient>
        </defs>
        <g filter={`url(#${filterId})`}>
          <circle ref={mainRef} cx="50" cy="50" r="22" fill={`url(#${filterId}-grad)`} />
          <circle ref={aRef} cx="72" cy="42" r="9" fill={color} />
          <circle ref={bRef} cx="34" cy="68" r="7" fill={color} opacity="0.92" />
        </g>
      </svg>
      {label && <span className="gooey-orb-label">{label}</span>}
    </div>
  );
}
