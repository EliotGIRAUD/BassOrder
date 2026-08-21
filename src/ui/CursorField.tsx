import { useEffect, useRef } from "react";

type Point = { x: number; y: number };

const HOT_SELECTOR =
  "button, a, input, .folder-row, .module-card, .triage-folder-btn, .rail-btn, .kpi, .push-fill.is-live, .push-bar-track.is-live, .push-ring.is-live, .push-eq";

const RING_BASE = 30;

let cursorGen = 0;

function hotTarget(el: EventTarget | null): Element | null {
  if (!(el instanceof Element)) {
    return null;
  }
  return el.closest(HOT_SELECTOR);
}

function purgeStray(keep: Element[]) {
  document.querySelectorAll(".fx-cursor-canvas").forEach((node) => node.remove());
  document.querySelectorAll(".fx-cursor-glow, .fx-cursor-ring, .fx-cursor-core").forEach((node) => {
    if (!keep.includes(node)) {
      node.remove();
    }
  });
}

export function CursorField() {
  const glowRef = useRef<HTMLDivElement>(null);
  const ringRef = useRef<HTMLDivElement>(null);
  const coreRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const glow = glowRef.current;
    const ring = ringRef.current;
    const core = coreRef.current;
    if (!glow || !ring || !core) {
      return;
    }
    const lampEl = glow;
    const ringEl = ring;
    const coreEl = core;

    const gen = ++cursorGen;
    purgeStray([glow, ring, core]);

    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      glow.style.display = "none";
      ring.style.display = "none";
      core.style.display = "none";
      return;
    }

    const mouse: Point = { x: window.innerWidth * 0.55, y: window.innerHeight * 0.4 };
    const magnet: Point = { ...mouse };
    const lamp: Point = { ...mouse };
    let hotEl: Element | null = null;
    let scale = 1;
    let raf = 0;

    function onMove(e: PointerEvent) {
      mouse.x = e.clientX;
      mouse.y = e.clientY;
      hotEl = hotTarget(e.target);
    }

    function onLeave() {
      hotEl = null;
    }

    function frame() {
      if (gen !== cursorGen) {
        return;
      }
      if (document.visibilityState !== "visible") {
        raf = 0;
        return;
      }

      const hot = Boolean(hotEl);
      let targetX = mouse.x;
      let targetY = mouse.y;
      let targetScale = 1;

      if (hotEl) {
        const r = hotEl.getBoundingClientRect();
        targetX = r.left + r.width / 2;
        targetY = r.top + r.height / 2;
        // Anneau calé sur la cible (ex. bouton Réglages) plutôt que sur la souris
        const fit = (Math.max(r.width, r.height) * 1.05) / RING_BASE;
        targetScale = Math.min(3.2, Math.max(1.45, fit));
      }

      const follow = hot ? 0.28 : 0.14;
      magnet.x += (targetX - magnet.x) * follow;
      magnet.y += (targetY - magnet.y) * follow;
      scale += (targetScale - scale) * (hot ? 0.22 : 0.16);

      lamp.x += (mouse.x - lamp.x) * (hot ? 0.11 : 0.07);
      lamp.y += (mouse.y - lamp.y) * (hot ? 0.11 : 0.07);

      lampEl.style.transform = `translate3d(${lamp.x}px, ${lamp.y}px, 0) scale(${hot ? 0.78 : 1})`;
      lampEl.classList.toggle("is-hot", hot);
      ringEl.style.transform = `translate3d(${magnet.x}px, ${magnet.y}px, 0) scale(${scale})`;
      ringEl.classList.toggle("is-hot", hot);
      coreEl.style.transform = `translate3d(${mouse.x}px, ${mouse.y}px, 0)`;
      coreEl.classList.toggle("is-hot", hot);
      raf = window.requestAnimationFrame(frame);
    }

    function ensureRaf() {
      if (!raf && gen === cursorGen && document.visibilityState === "visible") {
        raf = window.requestAnimationFrame(frame);
      }
    }

    function onVis() {
      if (document.visibilityState === "visible") {
        ensureRaf();
      } else if (raf) {
        window.cancelAnimationFrame(raf);
        raf = 0;
      }
    }

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerdown", onMove);
    document.addEventListener("pointerleave", onLeave);
    document.addEventListener("visibilitychange", onVis);
    raf = window.requestAnimationFrame(frame);

    return () => {
      cursorGen += 1;
      window.cancelAnimationFrame(raf);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerdown", onMove);
      document.removeEventListener("pointerleave", onLeave);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, []);

  return (
    <>
      <div className="fx-cursor-glow" ref={glowRef} aria-hidden />
      <div className="fx-cursor-ring" ref={ringRef} aria-hidden />
      <div className="fx-cursor-core" ref={coreRef} aria-hidden />
    </>
  );
}
