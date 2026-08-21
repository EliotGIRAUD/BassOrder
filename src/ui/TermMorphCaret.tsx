import { useEffect, useMemo, useState } from "react";

/** Frames 8×8 — petit perso qui court (pixel art terminal). */
const RUN_FRAMES: string[][] = [
  [
    "........",
    "..██....",
    ".████...",
    "..██.█..",
    ".████...",
    ".█..█...",
    ".█..█...",
    "........",
  ],
  [
    "........",
    "...██...",
    "..████..",
    "...██.█.",
    "..████..",
    "...██...",
    "..█..█..",
    "........",
  ],
  [
    "........",
    "..██....",
    ".████...",
    "█.██....",
    ".████...",
    "..█.█...",
    ".█...█..",
    "........",
  ],
  [
    "........",
    "...██...",
    "..████..",
    ".█.██...",
    "..████..",
    "...█.█..",
    "..█...█.",
    "........",
  ],
];

const IDLE_FRAMES: string[][] = [
  [
    "........",
    "...██...",
    "..████..",
    "...██...",
    "..████..",
    "..█..█..",
    "..█..█..",
    "........",
  ],
  [
    "........",
    "...██...",
    "..████..",
    "...██...",
    "..████..",
    "..█..█..",
    ".█....█.",
    "........",
  ],
];

const WIN_FRAMES: string[][] = [
  [
    "........",
    ".█..██.█",
    "..████..",
    "...██...",
    "..████..",
    "..█..█..",
    "..█..█..",
    "........",
  ],
  [
    "........",
    "█...██..",
    "..████.█",
    "...██...",
    "..████..",
    ".█....█.",
    "..█..█..",
    "........",
  ],
];

type SpriteKind = "star" | "diamond" | "note" | "cube" | "spark" | "wave" | "heart";

/** Formes 5×5 — décor pixel le long du terminal. */
const SPRITES: Record<SpriteKind, string[][]> = {
  star: [
    [
      "..█..",
      ".███.",
      "█████",
      ".███.",
      "..█..",
    ],
    [
      ".█.█.",
      "..█..",
      "█████",
      "..█..",
      ".█.█.",
    ],
  ],
  diamond: [
    [
      "..█..",
      ".█.█.",
      "█...█",
      ".█.█.",
      "..█..",
    ],
    [
      "..█..",
      ".███.",
      "█████",
      ".███.",
      "..█..",
    ],
  ],
  note: [
    [
      "...█.",
      "...█.",
      "...█.",
      ".███.",
      ".██..",
    ],
    [
      "...█.",
      "...█.",
      "..██.",
      ".███.",
      ".██..",
    ],
  ],
  cube: [
    [
      ".███.",
      "█...█",
      "█.█.█",
      "█...█",
      ".███.",
    ],
    [
      ".███.",
      "█████",
      "█.█.█",
      "█████",
      ".███.",
    ],
  ],
  spark: [
    [
      "..█..",
      "..█..",
      "█████",
      "..█..",
      "..█..",
    ],
    [
      "█...█",
      ".█.█.",
      "..█..",
      ".█.█.",
      "█...█",
    ],
  ],
  wave: [
    [
      ".....",
      "█...█",
      ".█.█.",
      "..█..",
      ".....",
    ],
    [
      ".....",
      ".█.█.",
      "█...█",
      ".█.█.",
      ".....",
    ],
  ],
  heart: [
    [
      ".█.█.",
      "█████",
      "█████",
      ".███.",
      "..█..",
    ],
    [
      ".█.█.",
      "█████",
      ".███.",
      "..█..",
      ".....",
    ],
  ],
};

type FieldProp = {
  kind: SpriteKind;
  x: number;
  y: number;
  delay: number;
  scale: number;
  speed: number;
};

const FIELD: FieldProp[] = [
  { kind: "star", x: 4, y: 8, delay: 0, scale: 1, speed: 1 },
  { kind: "diamond", x: 12, y: 42, delay: 0.2, scale: 0.9, speed: 1.1 },
  { kind: "wave", x: 18, y: 18, delay: 0.45, scale: 1.05, speed: 0.85 },
  { kind: "note", x: 26, y: 55, delay: 0.1, scale: 1, speed: 1.2 },
  { kind: "cube", x: 34, y: 12, delay: 0.55, scale: 0.85, speed: 0.95 },
  { kind: "spark", x: 42, y: 48, delay: 0.3, scale: 1.1, speed: 1.15 },
  { kind: "heart", x: 50, y: 22, delay: 0.7, scale: 0.9, speed: 1 },
  { kind: "star", x: 58, y: 60, delay: 0.15, scale: 0.8, speed: 1.25 },
  { kind: "diamond", x: 66, y: 10, delay: 0.4, scale: 1, speed: 0.9 },
  { kind: "note", x: 74, y: 38, delay: 0.6, scale: 1.05, speed: 1.05 },
  { kind: "wave", x: 82, y: 58, delay: 0.25, scale: 0.95, speed: 1.1 },
  { kind: "spark", x: 90, y: 16, delay: 0.5, scale: 1, speed: 0.88 },
  { kind: "cube", x: 96, y: 45, delay: 0.35, scale: 0.85, speed: 1.18 },
];

function PixelGrid({
  rows,
  className,
}: {
  rows: string[];
  className?: string;
}) {
  const cells = useMemo(() => {
    const out: { on: boolean; i: number }[] = [];
    const w = rows[0]?.length ?? 0;
    rows.forEach((row, y) => {
      for (let x = 0; x < w; x += 1) {
        out.push({ on: row[x] === "█", i: y * w + x });
      }
    });
    return out;
  }, [rows]);

  const cols = rows[0]?.length ?? 8;

  return (
    <span
      className={className}
      style={{ ["--px-cols" as string]: cols, ["--px-rows" as string]: rows.length }}
    >
      {cells.map((c) => (
        <i key={c.i} className={c.on ? "is-on" : undefined} />
      ))}
    </span>
  );
}

/**
 * Piste terminal = formes pixel art sur toute la largeur + perso qui court.
 */
export function TermMorphCaret({
  percent,
}: {
  percent: number | null;
}) {
  const p = percent == null ? 0 : Math.max(0, Math.min(100, percent));
  const bank = p >= 100 ? WIN_FRAMES : p <= 0 ? IDLE_FRAMES : RUN_FRAMES;
  const [frame, setFrame] = useState(0);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const ms = p >= 100 ? 320 : p <= 0 ? 480 : 140;
    const id = window.setInterval(() => {
      setFrame((f) => (f + 1) % bank.length);
    }, ms);
    return () => window.clearInterval(id);
  }, [bank.length, p]);

  useEffect(() => {
    const ms = p >= 100 ? 280 : p <= 0 ? 520 : 220;
    const id = window.setInterval(() => {
      setTick((t) => t + 1);
    }, ms);
    return () => window.clearInterval(id);
  }, [p]);

  const mood = p >= 100 ? "win" : p <= 0 ? "idle" : "run";
  const heroRows = bank[frame % bank.length];
  const heroLeft = Math.max(2, Math.min(92, p <= 0 ? 8 : p));

  return (
    <span
      className={`term-pixel-runway is-${mood}`}
      style={{ ["--term-progress" as string]: String(p / 100) }}
      aria-hidden
      title={`${Math.round(p)}%`}
    >
      <span className="term-pixel-ground" />
      <span className="term-pixel-dust" />

      {FIELD.map((prop, idx) => {
        const frames = SPRITES[prop.kind];
        const fi = (tick + Math.floor(prop.delay * 5) + idx) % frames.length;
        return (
          <span
            key={`${prop.kind}-${idx}`}
            className={`term-pixel-prop is-${prop.kind}`}
            style={{
              left: `${prop.x}%`,
              top: `${prop.y}%`,
              animationDelay: `${prop.delay}s`,
              animationDuration: `${1.6 / prop.speed}s`,
              ["--px-scale" as string]: String(prop.scale),
            }}
          >
            <PixelGrid rows={frames[fi]} className="term-pixel-mini" />
          </span>
        );
      })}

      <span
        className={`term-pixel-hero is-${mood}`}
        style={{ left: `${heroLeft}%` }}
      >
        <PixelGrid rows={heroRows} className="term-pixel-grid" />
        <span className="term-pixel-trail" />
      </span>
    </span>
  );
}
