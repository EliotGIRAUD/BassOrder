import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type FormEvent,
} from "react";
import { LiveAvatar } from "./LiveAvatar";
import { USER_COLORS } from "./types";
import { useUserSession } from "./UserSession";
import type { AppUser } from "./types";
import { localAuthStatus, localAuthVerify } from "../account/localAuth";
import { getSoleUser } from "./store";

type Props = {
  onUnlockStart?: () => void;
  onUnlocked?: (user: AppUser) => void;
};

/**
 * Gate single-user : création une fois, puis entrée (PIN si défini).
 * Plus de grille Netflix / multi-profils.
 */
export function UserGate({ onUnlockStart, onUnlocked }: Props) {
  const session = useUserSession();
  const rootRef = useRef<HTMLDivElement>(null);
  const [name, setName] = useState("");
  const [color, setColor] = useState<string>(USER_COLORS[0]);
  const [busy, setBusy] = useState(false);
  const [lockedOut, setLockedOut] = useState(false);
  const [enterTick, setEnterTick] = useState(0);
  const [spotlight, setSpotlight] = useState({ x: 50, y: 40 });
  const sole = session.ready ? (session.users[0] ?? getSoleUser()) : null;
  const needsCreate = session.ready && !sole;

  useEffect(() => {
    const el = rootRef.current;
    if (!el) {
      return;
    }
    function onMove(event: PointerEvent) {
      const r = el!.getBoundingClientRect();
      setSpotlight({
        x: ((event.clientX - r.left) / r.width) * 100,
        y: ((event.clientY - r.top) / r.height) * 100,
      });
    }
    el.addEventListener("pointermove", onMove);
    return () => el.removeEventListener("pointermove", onMove);
  }, []);

  useEffect(() => {
    if (!session.ready || !sole || busy || lockedOut) {
      return;
    }
    void (async () => {
      setBusy(true);
      try {
        const status = await localAuthStatus(sole.id);
        if (status.hasPassword) {
          const pin = window.prompt(`PIN / mot de passe pour ${sole.name}`);
          if (pin == null) {
            setLockedOut(true);
            return;
          }
          const ok = await localAuthVerify(sole.id, pin);
          if (!ok) {
            window.alert("PIN / mot de passe incorrect.");
            setLockedOut(true);
            return;
          }
        }
        onUnlockStart?.();
        await new Promise((r) => window.setTimeout(r, 280));
        await session.enter(sole.id);
        onUnlocked?.(sole);
      } finally {
        setBusy(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.ready, sole?.id, enterTick]);

  async function onCreate(event: FormEvent) {
    event.preventDefault();
    if (name.trim().length < 2 || busy || !session.ready) {
      return;
    }
    setBusy(true);
    try {
      const created = await session.create(name, color);
      onUnlockStart?.();
      await new Promise((r) => window.setTimeout(r, 320));
      await session.enter(created.id);
      onUnlocked?.(created);
    } catch (err) {
      console.error("[BassOrder] create profile", err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      ref={rootRef}
      className={`user-gate is-creating${busy ? " is-picking" : ""}`}
      style={
        {
          ["--spot-x"]: `${spotlight.x}%`,
          ["--spot-y"]: `${spotlight.y}%`,
        } as CSSProperties
      }
    >
      <div className="user-gate-fx" aria-hidden>
        <span className="user-gate-spotlight" />
        <span className="user-gate-grid" />
        <span className="user-gate-orb user-gate-orb-a" />
        <span className="user-gate-orb user-gate-orb-b" />
        <span className="user-gate-wave">
          {Array.from({ length: 18 }, (_, i) => (
            <i key={i} style={{ ["--i" as string]: i }} />
          ))}
        </span>
      </div>

      <div className="user-gate-panel">
        <p className="eyebrow user-gate-eyebrow">BassOrder</p>
        <h1 className="user-gate-title">
          {!session.ready
            ? "Chargement…"
            : needsCreate
              ? "Bienvenue"
              : busy
                ? `Salut ${sole?.name ?? ""}`
                : "Déverrouillage…"}
        </h1>
        <p className="user-gate-lede">
          {!session.ready
            ? "On prépare ton espace…"
            : needsCreate
              ? "Un pseudo, une couleur — ensuite Spotify (ou tes fichiers) pour classer ta musique."
              : "Ouverture de ton espace…"}
        </p>

        {session.ready && needsCreate && (
          <form
            className="user-gate-form user-gate-glass"
            onSubmit={(e) => void onCreate(e)}
          >
            <div
              className="user-gate-preview"
              style={{ ["--user-color" as string]: color }}
            >
              <LiveAvatar
                name={name.trim() || "?"}
                color={color}
                size="xl"
                title="Aperçu de ton avatar"
              />
            </div>

            <label>
              <span>Ton pseudo</span>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="ex. Eliot"
                autoFocus
                maxLength={24}
                minLength={2}
                required
                disabled={busy}
              />
            </label>

            <div className="user-gate-colors" role="listbox" aria-label="Couleur">
              {USER_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  className={color === c ? "is-on" : undefined}
                  style={{ background: c }}
                  aria-label={c}
                  disabled={busy}
                  onClick={() => setColor(c)}
                />
              ))}
            </div>

            <button
              type="submit"
              className="btn-primary user-gate-submit"
              disabled={busy || name.trim().length < 2}
            >
              {busy ? "Ouverture…" : "Allumer BassOrder"}
            </button>
          </form>
        )}

        {session.ready && !needsCreate && (
          <div className="user-gate-form user-gate-glass" style={{ gap: "0.85rem" }}>
            {sole && (
              <div
                className="user-gate-preview"
                style={{ ["--user-color" as string]: sole.color }}
              >
                <LiveAvatar
                  name={sole.name}
                  color={sole.color}
                  size="xl"
                  imageUrl={sole.avatarUrl}
                />
              </div>
            )}
            <p className="user-gate-hint" style={{ margin: 0 }}>
              {busy
                ? "Ouverture…"
                : lockedOut
                  ? "Entre ton PIN pour continuer."
                  : "Un instant…"}
            </p>
            {lockedOut && (
              <button
                type="button"
                className="btn-primary user-gate-submit"
                onClick={() => {
                  setLockedOut(false);
                  setEnterTick((t) => t + 1);
                }}
              >
                Réessayer
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
