import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from "react";
import type { Toast, ToastKind } from "./Experience";

const FLING_SPEED = 1100; // px/s — au-delà = yeet
const CLICK_SLOP = 8;

type Props = {
  item: Toast;
  onDismiss: (id: number) => void;
  onPause: (id: number) => void;
  onResume: (id: number) => void;
};

type DragState = {
  pointerId: number;
  originX: number;
  originY: number;
  offsetX: number;
  offsetY: number;
  baseLeft: number;
  baseTop: number;
};

/**
 * Toast draggable : on le place où on veut ;
 * un lancer assez fort le fait disparaître (yeet + blur).
 * Inspiration : interactions “toss to dismiss” (iOS / Material motion), en CSS léger.
 */
export function ThrowableToast({ item, onDismiss, onPause, onResume }: Props) {
  const ref = useRef<HTMLButtonElement>(null);
  const drag = useRef<DragState | null>(null);
  const sample = useRef({ x: 0, y: 0, t: 0, vx: 0, vy: 0 });
  const moved = useRef(false);

  const [free, setFree] = useState<{ left: number; top: number } | null>(null);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const [yeet, setYeet] = useState<{
    tx: number;
    ty: number;
    rot: number;
  } | null>(null);

  useEffect(() => {
    if (!yeet) {
      return;
    }
    const t = window.setTimeout(() => onDismiss(item.id), 480);
    return () => window.clearTimeout(t);
  }, [yeet, item.id, onDismiss]);

  function onPointerDown(event: ReactPointerEvent<HTMLButtonElement>) {
    if (yeet || event.button !== 0) {
      return;
    }
    const el = ref.current;
    if (!el) {
      return;
    }
    onPause(item.id);
    const rect = el.getBoundingClientRect();
    if (!free) {
      setFree({ left: rect.left, top: rect.top });
    }
    const baseLeft = free?.left ?? rect.left;
    const baseTop = free?.top ?? rect.top;
    drag.current = {
      pointerId: event.pointerId,
      originX: event.clientX,
      originY: event.clientY,
      offsetX: event.clientX - rect.left,
      offsetY: event.clientY - rect.top,
      baseLeft,
      baseTop,
    };
    sample.current = {
      x: event.clientX,
      y: event.clientY,
      t: performance.now(),
      vx: 0,
      vy: 0,
    };
    moved.current = false;
    setDragging(true);
    setOffset({ x: 0, y: 0 });
    el.setPointerCapture(event.pointerId);
  }

  function onPointerMove(event: ReactPointerEvent<HTMLButtonElement>) {
    const d = drag.current;
    if (!d || d.pointerId !== event.pointerId) {
      return;
    }
    const dx = event.clientX - d.originX;
    const dy = event.clientY - d.originY;
    if (Math.hypot(dx, dy) > CLICK_SLOP) {
      moved.current = true;
    }
    setOffset({ x: dx, y: dy });

    const now = performance.now();
    const dt = Math.max(1, now - sample.current.t) / 1000;
    sample.current = {
      x: event.clientX,
      y: event.clientY,
      t: now,
      vx: (event.clientX - sample.current.x) / dt,
      vy: (event.clientY - sample.current.y) / dt,
    };
  }

  function endDrag(event: ReactPointerEvent<HTMLButtonElement>) {
    const d = drag.current;
    if (!d || d.pointerId !== event.pointerId) {
      return;
    }
    drag.current = null;
    setDragging(false);

    try {
      ref.current?.releasePointerCapture(event.pointerId);
    } catch {
      /* déjà relâché */
    }

    const speed = Math.hypot(sample.current.vx, sample.current.vy);

    if (!moved.current) {
      setFree(null);
      setOffset({ x: 0, y: 0 });
      onDismiss(item.id);
      return;
    }

    if (speed >= FLING_SPEED) {
      const scale = 0.28;
      setFree({
        left: event.clientX - d.offsetX,
        top: event.clientY - d.offsetY,
      });
      setOffset({ x: 0, y: 0 });
      setYeet({
        tx: sample.current.vx * scale,
        ty: sample.current.vy * scale,
        rot: Math.max(-48, Math.min(48, sample.current.vx * 0.04)),
      });
      return;
    }

    setFree({
      left: event.clientX - d.offsetX,
      top: event.clientY - d.offsetY,
    });
    setOffset({ x: 0, y: 0 });
    onResume(item.id);
  }

  const style: CSSProperties = {};
  if (free) {
    style.position = "fixed";
    style.left = free.left + offset.x;
    style.top = free.top + offset.y;
    style.right = "auto";
    style.bottom = "auto";
    style.width = "min(360px, calc(100vw - 2.4rem))";
    style.zIndex = dragging || yeet ? 90 : 85;
    style.margin = 0;
  } else if (offset.x || offset.y) {
    style.transform = `translate3d(${offset.x}px, ${offset.y}px, 0)`;
  }

  if (yeet) {
    Object.assign(style, {
      ["--yeet-x"]: `${yeet.tx}px`,
      ["--yeet-y"]: `${yeet.ty}px`,
      ["--yeet-rot"]: `${yeet.rot}deg`,
    } as CSSProperties);
  }

  const className = [
    "toast",
    `toast-${item.kind as ToastKind}`,
    dragging ? "is-dragging" : "",
    yeet ? "is-yeeting" : "",
    free ? "is-free" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <button
      ref={ref}
      type="button"
      className={className}
      style={style}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
    >
      <span className="toast-mark" />
      <span className="toast-copy">
        <strong>{item.title}</strong>
        {item.body && <em>{item.body}</em>}
      </span>
      <span className="toast-bar" aria-hidden />
    </button>
  );
}
