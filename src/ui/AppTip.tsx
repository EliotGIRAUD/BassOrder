import {
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";

type Side = "right" | "bottom";

type TipPanelProps = {
  children: ReactNode;
  /** right = rail / colonnes ; bottom = toolbars en haut à droite */
  side?: Side;
};

/** Bulle d’aide custom — portail fixed pour échapper overflow. */
export function TipPanel({ children, side = "right" }: TipPanelProps) {
  const hostRef = useRef<HTMLSpanElement>(null);
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const tipId = useId();

  useEffect(() => {
    const host = hostRef.current;
    const trigger = host?.parentElement;
    if (!trigger) {
      return;
    }

    function place() {
      const r = trigger!.getBoundingClientRect();
      if (side === "bottom") {
        setPos({
          top: r.bottom + 10,
          left: Math.min(
            window.innerWidth - 16,
            Math.max(16, r.left + r.width / 2),
          ),
        });
      } else {
        setPos({
          top: r.top + r.height / 2,
          left: Math.min(window.innerWidth - 16, r.right + 10),
        });
      }
    }

    function show() {
      place();
      setOpen(true);
    }

    function hide() {
      setOpen(false);
    }

    trigger.addEventListener("pointerenter", show);
    trigger.addEventListener("pointerleave", hide);
    trigger.addEventListener("focus", show);
    trigger.addEventListener("blur", hide);
    window.addEventListener("scroll", hide, true);
    window.addEventListener("resize", hide);

    return () => {
      trigger.removeEventListener("pointerenter", show);
      trigger.removeEventListener("pointerleave", hide);
      trigger.removeEventListener("focus", show);
      trigger.removeEventListener("blur", hide);
      window.removeEventListener("scroll", hide, true);
      window.removeEventListener("resize", hide);
    };
  }, [side]);

  return (
    <>
      <span ref={hostRef} className="app-tip-host" aria-hidden />
      {open &&
        createPortal(
          <span
            id={tipId}
            className={`app-tip-panel is-open is-${side}`}
            role="tooltip"
            style={{ top: pos.top, left: pos.left }}
          >
            <span className="app-tip-glow" aria-hidden />
            <span className="app-tip-dot" aria-hidden />
            <span className="app-tip-text">{children}</span>
          </span>,
          document.body,
        )}
    </>
  );
}
