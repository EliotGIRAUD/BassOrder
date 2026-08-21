import {
  useEffect,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type PointerEvent,
  type ReactNode,
} from "react";
import { usePrefs } from "./prefs";

const GLYPHS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789<>/█▓░#";

export function ScrambleText({
  text,
  className,
  as: Tag = "span",
}: {
  text: string;
  className?: string;
  as?: "span" | "h1" | "h2" | "p";
}) {
  const { prefs } = usePrefs();
  const [out, setOut] = useState(text);
  const timer = useRef<number>(0);

  function run() {
    if (!prefs.scramble) {
      return;
    }
    window.clearInterval(timer.current);
    let step = 0;
    timer.current = window.setInterval(() => {
      setOut(
        text
          .split("")
          .map((ch, i) => {
            if (ch === " " || ch === "\n") {
              return ch;
            }
            return i < step ? ch : GLYPHS[(Math.random() * GLYPHS.length) | 0];
          })
          .join(""),
      );
      step += 1;
      if (step > text.length) {
        window.clearInterval(timer.current);
        setOut(text);
      }
    }, 26);
  }

  useEffect(() => () => window.clearInterval(timer.current), []);

  if (!prefs.scramble) {
    return <Tag className={className}>{text}</Tag>;
  }

  return (
    <Tag className={className} onMouseEnter={run}>
      {out}
    </Tag>
  );
}

export function TiltCard({
  children,
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { children: ReactNode }) {
  function onMove(e: PointerEvent<HTMLButtonElement>) {
    const el = e.currentTarget;
    const r = el.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width;
    const y = (e.clientY - r.top) / r.height;
    el.style.setProperty("--rx", `${(0.5 - y) * 9}deg`);
    el.style.setProperty("--ry", `${(x - 0.5) * 12}deg`);
    el.style.setProperty("--mx", `${x * 100}%`);
    el.style.setProperty("--my", `${y * 100}%`);
  }

  function onLeave(e: PointerEvent<HTMLButtonElement>) {
    const el = e.currentTarget;
    el.style.setProperty("--rx", "0deg");
    el.style.setProperty("--ry", "0deg");
    el.style.setProperty("--mx", "50%");
    el.style.setProperty("--my", "40%");
  }

  return (
    <button
      {...props}
      className={`tilt-card ${className}`}
      onPointerMove={onMove}
      onPointerLeave={onLeave}
    >
      {children}
    </button>
  );
}

export function CountUp({
  value,
  suffix = "",
}: {
  value: number;
  suffix?: string;
}) {
  const [n, setN] = useState(0);

  useEffect(() => {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce) {
      setN(value);
      return;
    }
    const start = performance.now();
    const from = n;
    const dur = 780;
    let raf = 0;
    const tick = (t: number) => {
      const p = Math.min(1, (t - start) / dur);
      const eased = 1 - (1 - p) ** 3;
      setN(Math.round(from + (value - from) * eased));
      if (p < 1) {
        raf = window.requestAnimationFrame(tick);
      }
    };
    raf = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  return (
    <>
      {n}
      {suffix}
    </>
  );
}

export function TypeLine({ text, className }: { text: string; className?: string }) {
  const [out, setOut] = useState("");

  useEffect(() => {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce) {
      setOut(text);
      return;
    }
    setOut("");
    let i = 0;
    const id = window.setInterval(() => {
      i += 1;
      setOut(text.slice(0, i));
      if (i >= text.length) {
        window.clearInterval(id);
      }
    }, 18);
    return () => window.clearInterval(id);
  }, [text]);

  return (
    <p className={`type-line ${className ?? ""}`}>
      {out}
      <span className="type-caret" aria-hidden />
    </p>
  );
}
