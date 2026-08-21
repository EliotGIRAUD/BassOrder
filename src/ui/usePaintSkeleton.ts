import { useEffect, useState } from "react";

/**
 * Affiche un skeleton le temps d’un paint / délai court
 * (pages sync pour éviter le flash vide au changement de vue).
 */
export function usePaintSkeleton(ms = 220): boolean {
  const [show, setShow] = useState(ms > 0);
  useEffect(() => {
    if (ms <= 0) {
      setShow(false);
      return;
    }
    setShow(true);
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce) {
      setShow(false);
      return;
    }
    const t = window.setTimeout(() => setShow(false), ms);
    return () => window.clearTimeout(t);
  }, [ms]);
  return show;
}
