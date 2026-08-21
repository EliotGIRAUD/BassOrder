import { useEffect, useRef, type ReactNode } from "react";
import { prefersReducedMotion } from "../push/spring";

type MagNode = {
  el: HTMLElement;
  ox: number;
  oy: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
};

/**
 * Champ magnétique 2026 : les enfants `.mag-node` sont attirés par le curseur
 * puis ressortent à leur place (interruptible).
 */
export function MagneticField({
  children,
  className = "",
  strength = 28,
  radius = 140,
}: {
  children: ReactNode;
  className?: string;
  strength?: number;
  radius?: number;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const nodesRef = useRef<MagNode[]>([]);
  const pointerRef = useRef({ x: 0, y: 0, inside: false });
  const reduceRef = useRef(false);

  useEffect(() => {
    reduceRef.current = prefersReducedMotion();
    const root = rootRef.current;
    if (!root) {
      return;
    }

    function syncNodes() {
      const els = Array.from(root!.querySelectorAll<HTMLElement>(".mag-node"));
      const rect = root!.getBoundingClientRect();
      nodesRef.current = els.map((el) => {
        const r = el.getBoundingClientRect();
        const ox = r.left - rect.left + r.width / 2;
        const oy = r.top - rect.top + r.height / 2;
        return { el, ox, oy, x: 0, y: 0, vx: 0, vy: 0 };
      });
    }

    syncNodes();
    const ro = new ResizeObserver(syncNodes);
    ro.observe(root);

    let raf = 0;
    let last = performance.now();

    const tick = (now: number) => {
      const dt = Math.min(0.033, (now - last) / 1000);
      last = now;
      const { x: px, y: py, inside } = pointerRef.current;

      for (const node of nodesRef.current) {
        let tx = 0;
        let ty = 0;
        if (inside && !reduceRef.current) {
          const dx = px - node.ox;
          const dy = py - node.oy;
          const dist = Math.hypot(dx, dy) || 1;
          if (dist < radius) {
            const t = 1 - dist / radius;
            const pull = strength * t * t;
            tx = (dx / dist) * pull;
            ty = (dy / dist) * pull;
          }
        }
        const ax = (tx - node.x) * 38 - node.vx * 10;
        const ay = (ty - node.y) * 38 - node.vy * 10;
        node.vx += ax * dt;
        node.vy += ay * dt;
        node.x += node.vx * dt;
        node.y += node.vy * dt;
        node.el.style.transform = `translate3d(${node.x.toFixed(2)}px, ${node.y.toFixed(2)}px, 0)`;
      }

      raf = requestAnimationFrame(tick);
    };

    raf = requestAnimationFrame(tick);

    function onMove(e: PointerEvent) {
      const r = root!.getBoundingClientRect();
      pointerRef.current = {
        x: e.clientX - r.left,
        y: e.clientY - r.top,
        inside: true,
      };
    }
    function onLeave() {
      pointerRef.current.inside = false;
    }

    root.addEventListener("pointermove", onMove);
    root.addEventListener("pointerleave", onLeave);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      root.removeEventListener("pointermove", onMove);
      root.removeEventListener("pointerleave", onLeave);
    };
  }, [radius, strength]);

  return (
    <div ref={rootRef} className={`magnetic-field ${className}`.trim()}>
      {children}
    </div>
  );
}
