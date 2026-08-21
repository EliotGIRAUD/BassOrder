import { useState } from "react";

/** Mémorise l’état ouvert/fermé d’un panneau secondaire (localStorage). */
export function useCollapsedPanel(
  storageKey: string,
  defaultCollapsed = true,
): [boolean, () => void] {
  const [collapsed, setCollapsed] = useState(() => {
    try {
      const raw = localStorage.getItem(storageKey);
      if (raw === "0") return false;
      if (raw === "1") return true;
    } catch {
      /* ignore */
    }
    return defaultCollapsed;
  });

  function toggle() {
    setCollapsed((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(storageKey, next ? "1" : "0");
      } catch {
        /* ignore */
      }
      return next;
    });
  }

  return [collapsed, toggle];
}
