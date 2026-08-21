import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { CursorField } from "./CursorField";
import { usePrefs } from "./prefs";
import { playNotify, unlockAudio } from "./sounds";
import { ThrowableToast } from "./ThrowableToast";

export type ToastKind = "hint" | "ok" | "warn" | "go";

export type Toast = {
  id: number;
  kind: ToastKind;
  title: string;
  body?: string;
};

type Ripple = { id: number; x: number; y: number };

type ExperienceApi = {
  toast: (input: Omit<Toast, "id">) => void;
  burst: (x?: number, y?: number) => void;
  flash: () => void;
};

const ExperienceContext = createContext<ExperienceApi | null>(null);

let nextId = 1;

export function ExperienceProvider({ children }: { children: ReactNode }) {
  const { prefs } = usePrefs();
  const prefsRef = useRef(prefs);
  prefsRef.current = prefs;
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [ripples, setRipples] = useState<Ripple[]>([]);
  const [flashing, setFlashing] = useState(false);
  const timers = useRef(new Map<number, number>());

  const dismiss = useCallback((id: number) => {
    const t = timers.current.get(id);
    if (t) {
      window.clearTimeout(t);
      timers.current.delete(id);
    }
    setToasts((list) => list.filter((item) => item.id !== id));
  }, []);

  const arm = useCallback(
    (id: number, ms: number) => {
      const prev = timers.current.get(id);
      if (prev) {
        window.clearTimeout(prev);
      }
      const t = window.setTimeout(() => dismiss(id), ms);
      timers.current.set(id, t);
    },
    [dismiss],
  );

  const pause = useCallback((id: number) => {
    const t = timers.current.get(id);
    if (t) {
      window.clearTimeout(t);
      timers.current.delete(id);
    }
  }, []);

  const resume = useCallback(
    (id: number) => {
      arm(id, Math.min(prefsRef.current.toastMs, 8000));
    },
    [arm],
  );

  const toast = useCallback(
    (input: Omit<Toast, "id">) => {
      const current = prefsRef.current;
      if (current.sounds) {
        playNotify(input.kind, current.volume);
      }
      if (!current.toasts) {
        return;
      }
      const id = nextId++;
      setToasts((list) => [...list.slice(-3), { ...input, id }]);
      arm(id, current.toastMs);
    },
    [arm],
  );

  const burst = useCallback((_x?: number, _y?: number) => {
    /* étincelles laser retirées — trop agressives */
  }, []);

  const flash = useCallback(() => {
    if (!prefsRef.current.particles) {
      return;
    }
    setFlashing(true);
    window.setTimeout(() => setFlashing(false), 520);
  }, []);

  useEffect(() => {
    function onDown(e: PointerEvent) {
      unlockAudio();
      const target = (e.target as HTMLElement | null)?.closest(
        "button, .folder-row, .module-card, .triage-folder-btn, .kpi",
      );
      if (!target) {
        return;
      }
      /* Ne pas “cliquer” un toast en train d’être balancé */
      if ((target as HTMLElement).closest(".toast")) {
        return;
      }
      target.classList.add("is-acting");
      window.setTimeout(() => target.classList.remove("is-acting"), 420);

      if (!prefsRef.current.particles) {
        return;
      }

      const id = nextId++;
      setRipples((list) => [...list, { id, x: e.clientX, y: e.clientY }]);
      window.setTimeout(() => {
        setRipples((list) => list.filter((r) => r.id !== id));
      }, 580);
    }

    window.addEventListener("pointerdown", onDown);
    return () => {
      window.removeEventListener("pointerdown", onDown);
    };
  }, [burst]);

  const api = useMemo<ExperienceApi>(
    () => ({ toast, burst, flash }),
    [toast, burst, flash],
  );

  return (
    <ExperienceContext.Provider value={api}>
      {children}
      {prefs.cursor && <CursorField />}
      <div className={`fx-flash${flashing ? " is-on" : ""}`} aria-hidden />
      <div className="fx-hits" aria-hidden>
        {ripples.map((r) => (
          <span
            key={r.id}
            className="fx-ripple"
            style={{ left: r.x, top: r.y }}
          />
        ))}
      </div>
      {prefs.toasts && (
        <div className="toast-stack" aria-live="polite">
          {toasts.map((item) => (
            <ThrowableToast
              key={item.id}
              item={item}
              onDismiss={dismiss}
              onPause={pause}
              onResume={resume}
            />
          ))}
        </div>
      )}
    </ExperienceContext.Provider>
  );
}

export function useExperience(): ExperienceApi {
  const ctx = useContext(ExperienceContext);
  if (!ctx) {
    return {
      toast: () => undefined,
      burst: () => undefined,
      flash: () => undefined,
    };
  }
  return ctx;
}
