import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { dbGetPrefs, dbSetPrefs, isTauri } from "../db";
import { setPreviewVolume } from "../local/player";
import { getActiveUserId, readUserItem, writeUserItem } from "../users/storage";
import { useUserSession } from "../users/UserSession";

const PREFS_SUFFIX = "prefs.v1";
const OLED_SUFFIX = "oled-black.v2";

export type Prefs = {
  cursor: boolean;
  particles: boolean;
  frames: boolean;
  shine: boolean;
  background: boolean;
  rail: boolean;
  scramble: boolean;
  toasts: boolean;
  sounds: boolean;
  /** Springs / EQ / barres jouables (rAF). */
  playful: boolean;
  volume: number;
  musicVolume: number;
  toastMs: number;
  intensity: number;
};

export const DEFAULT_PREFS: Prefs = {
  cursor: true,
  particles: true,
  frames: true,
  shine: true,
  background: false,
  rail: true,
  scramble: true,
  toasts: true,
  sounds: true,
  playful: true,
  volume: 0.38,
  musicVolume: 0.8,
  toastMs: 12000,
  intensity: 1,
};

type PrefsApi = {
  prefs: Prefs;
  patch: (partial: Partial<Prefs>) => void;
  reset: () => void;
  replace: (next: Prefs) => void;
  muteFx: () => void;
  unmuteFx: () => void;
};

const PrefsContext = createContext<PrefsApi | null>(null);

/** Tous les FX « machine » sont coupés. */
export function isFxMuted(prefs: Prefs): boolean {
  return (
    !prefs.cursor &&
    !prefs.particles &&
    !prefs.frames &&
    !prefs.shine &&
    !prefs.background &&
    !prefs.rail &&
    !prefs.scramble &&
    !prefs.sounds &&
    !prefs.playful
  );
}

const FX_ON: Pick<
  Prefs,
  | "cursor"
  | "particles"
  | "frames"
  | "shine"
  | "background"
  | "rail"
  | "scramble"
  | "sounds"
  | "playful"
  | "intensity"
> = {
  cursor: true,
  particles: true,
  frames: true,
  shine: true,
  background: false,
  rail: true,
  scramble: true,
  sounds: true,
  playful: true,
  intensity: 1,
};

export function applyPrefs(prefs: Prefs): void {
  const root = document.documentElement;
  root.dataset.fxCursor = onOff(prefs.cursor);
  root.dataset.fxParticles = onOff(prefs.particles);
  root.dataset.fxFrames = onOff(prefs.frames);
  root.dataset.fxShine = onOff(prefs.shine);
  root.dataset.fxBg = onOff(prefs.background);
  root.dataset.fxRail = onOff(prefs.rail);
  root.dataset.fxScramble = onOff(prefs.scramble);
  root.dataset.fxToasts = onOff(prefs.toasts);
  root.dataset.fxSounds = onOff(prefs.sounds);
  root.dataset.fxPlayful = onOff(prefs.playful);
  root.dataset.fxPerf = isFxMuted(prefs) ? "on" : "off";
  root.style.setProperty("--fx-intensity", String(prefs.intensity));
  root.style.setProperty("--toast-ms", `${prefs.toastMs}ms`);
  setPreviewVolume(prefs.musicVolume);
}

function onOff(value: boolean): "on" | "off" {
  return value ? "on" : "off";
}

function readPrefs(): Prefs {
  try {
    const raw = readUserItem(PREFS_SUFFIX);
    if (!raw) {
      return DEFAULT_PREFS;
    }
    const parsed = JSON.parse(raw) as Partial<Prefs>;
    const oledMigrated = readUserItem(OLED_SUFFIX) === "1";
    const prefs: Prefs = {
      ...DEFAULT_PREFS,
      ...parsed,
      background: oledMigrated ? Boolean(parsed.background) : false,
      volume: clamp(Number(parsed.volume ?? DEFAULT_PREFS.volume), 0, 1),
      musicVolume: clamp(Number(parsed.musicVolume ?? DEFAULT_PREFS.musicVolume), 0, 1),
      intensity: clamp(Number(parsed.intensity ?? DEFAULT_PREFS.intensity), 0.35, 1.4),
      toastMs: [5000, 12000, 20000].includes(Number(parsed.toastMs))
        ? Number(parsed.toastMs)
        : DEFAULT_PREFS.toastMs,
    };
    if (!oledMigrated) {
      writeUserItem(OLED_SUFFIX, "1");
      writePrefs(prefs);
    }
    return prefs;
  } catch {
    return DEFAULT_PREFS;
  }
}

function writePrefs(prefs: Prefs): void {
  if (!isTauri()) {
    try {
      writeUserItem(PREFS_SUFFIX, JSON.stringify(prefs));
    } catch {
      /* quota */
    }
  }
  const userId = getActiveUserId();
  if (userId && isTauri()) {
    void dbSetPrefs(userId, prefs as unknown as Record<string, unknown>).catch(
      () => undefined,
    );
  }
}

async function loadPrefsFromDb(userId: string): Promise<Prefs | null> {
  try {
    const map = await dbGetPrefs(userId);
    if (!map || Object.keys(map).length === 0) return null;
    // Prefer bundled object if stored as single key
    if (map.bundle && typeof map.bundle === "object") {
      return { ...DEFAULT_PREFS, ...(map.bundle as Partial<Prefs>) };
    }
    return { ...DEFAULT_PREFS, ...(map as Partial<Prefs>) };
  } catch {
    return null;
  }
}

function clamp(n: number, min: number, max: number): number {
  if (!Number.isFinite(n)) {
    return min;
  }
  return Math.min(max, Math.max(min, n));
}

export function SettingsProvider({ children }: { children: ReactNode }) {
  const { user } = useUserSession();
  const [prefs, setPrefs] = useState<Prefs>(() => {
    const initial = readPrefs();
    applyPrefs(initial);
    return initial;
  });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (user?.id && isTauri()) {
        const fromDb = await loadPrefsFromDb(user.id);
        if (!cancelled && fromDb) {
          const next = {
            ...DEFAULT_PREFS,
            ...fromDb,
            volume: clamp(Number(fromDb.volume ?? DEFAULT_PREFS.volume), 0, 1),
            musicVolume: clamp(
              Number(fromDb.musicVolume ?? DEFAULT_PREFS.musicVolume),
              0,
              1,
            ),
            intensity: clamp(
              Number(fromDb.intensity ?? DEFAULT_PREFS.intensity),
              0.35,
              1.4,
            ),
            toastMs: [5000, 12000, 20000].includes(Number(fromDb.toastMs))
              ? Number(fromDb.toastMs)
              : DEFAULT_PREFS.toastMs,
          };
          applyPrefs(next);
          setPrefs(next);
          return;
        }
      }
      if (!cancelled) {
        const next = readPrefs();
        applyPrefs(next);
        setPrefs(next);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user?.id]);

  const patch = useCallback((partial: Partial<Prefs>) => {
    setPrefs((prev) => {
      const next = { ...prev, ...partial };
      writePrefs(next);
      applyPrefs(next);
      return next;
    });
  }, []);

  const reset = useCallback(() => {
    writePrefs(DEFAULT_PREFS);
    applyPrefs(DEFAULT_PREFS);
    setPrefs(DEFAULT_PREFS);
  }, []);

  const replace = useCallback((next: Prefs) => {
    const merged: Prefs = { ...DEFAULT_PREFS, ...next };
    writePrefs(merged);
    applyPrefs(merged);
    setPrefs(merged);
  }, []);

  const muteFx = useCallback(() => {
    setPrefs((prev) => {
      const next: Prefs = {
        ...prev,
        cursor: false,
        particles: false,
        frames: false,
        shine: false,
        background: false,
        rail: false,
        scramble: false,
        sounds: false,
        playful: false,
      };
      writePrefs(next);
      applyPrefs(next);
      return next;
    });
  }, []);

  const unmuteFx = useCallback(() => {
    setPrefs((prev) => {
      const next: Prefs = { ...prev, ...FX_ON };
      writePrefs(next);
      applyPrefs(next);
      return next;
    });
  }, []);

  const api = useMemo(
    () => ({ prefs, patch, reset, replace, muteFx, unmuteFx }),
    [prefs, patch, reset, replace, muteFx, unmuteFx],
  );

  return <PrefsContext.Provider value={api}>{children}</PrefsContext.Provider>;
}

export function usePrefs(): PrefsApi {
  const ctx = useContext(PrefsContext);
  if (!ctx) {
    return {
      prefs: DEFAULT_PREFS,
      patch: () => undefined,
      reset: () => undefined,
      replace: () => undefined,
      muteFx: () => undefined,
      unmuteFx: () => undefined,
    };
  }
  return ctx;
}
