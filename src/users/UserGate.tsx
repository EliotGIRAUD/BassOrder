import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type FormEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { LiveAvatar } from "./LiveAvatar";
import { USER_COLORS } from "./types";
import { listUsers } from "./store";
import { useUserSession } from "./UserSession";
import type { AppUser } from "./types";
import { localAuthStatus, localAuthVerify } from "../account/localAuth";

type Props = {
  /** Appelé juste avant `enter` — laisse le shell animer le « dégrisage ». */
  onUnlockStart?: () => void;
  onUnlocked?: (user: AppUser) => void;
};

/**
 * Gate immersive (inspiration Netflix “Who’s watching?” + 3D profile pickers
 * type 21st.dev : tilt, spotlight curseur, tuiles magnétiques).
 * Visuellement dans le stage, pas une page à part.
 */
export function UserGate({ onUnlockStart, onUnlocked }: Props) {
  const session = useUserSession();
  const rootRef = useRef<HTMLDivElement>(null);
  const [name, setName] = useState("");
  const [color, setColor] = useState<string>(USER_COLORS[0]);
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [pickingId, setPickingId] = useState<string | null>(null);
  const [spotlight, setSpotlight] = useState({ x: 50, y: 40 });

  const sorted = useMemo(() => session.users, [session.users]);

  useEffect(() => {
    if (!session.ready) {
      return;
    }
    // Après hydrate SQLite : form si aucun profil, sinon grille.
    setCreating(session.users.length === 0);
  }, [session.ready, session.users.length]);

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

  async function finishEnter(user: AppUser) {
    const status = await localAuthStatus(user.id);
    if (status.hasPassword) {
      const pin = window.prompt(`PIN / mot de passe pour ${user.name}`);
      if (pin == null) {
        return;
      }
      const ok = await localAuthVerify(user.id, pin);
      if (!ok) {
        window.alert("PIN / mot de passe incorrect.");
        return;
      }
    }
    onUnlockStart?.();
    setPickingId(user.id);
    setBusy(true);
    try {
      await new Promise((r) => window.setTimeout(r, 420));
      await session.enter(user.id);
      onUnlocked?.(user);
    } finally {
      setBusy(false);
    }
  }

  async function onCreate(event: FormEvent) {
    event.preventDefault();
    if (name.trim().length < 2 || busy || !session.ready) {
      return;
    }
    setBusy(true);
    try {
      const created = await session.create(name, color);
      onUnlockStart?.();
      setPickingId(created.id);
      await new Promise((r) => window.setTimeout(r, 420));
      await session.enter(created.id);
      onUnlocked?.(created);
    } catch (err) {
      console.error("[BassOrder] create profile", err);
      setPickingId(null);
    } finally {
      setBusy(false);
    }
  }

  function onTileMove(event: ReactPointerEvent<HTMLButtonElement>) {
    const el = event.currentTarget;
    const r = el.getBoundingClientRect();
    const x = (event.clientX - r.left) / r.width;
    const y = (event.clientY - r.top) / r.height;
    el.style.setProperty("--rx", `${(0.5 - y) * 14}deg`);
    el.style.setProperty("--ry", `${(x - 0.5) * 16}deg`);
    el.style.setProperty("--mx", `${x * 100}%`);
    el.style.setProperty("--my", `${y * 100}%`);
  }

  function onTileLeave(event: ReactPointerEvent<HTMLButtonElement>) {
    const el = event.currentTarget;
    el.style.setProperty("--rx", "0deg");
    el.style.setProperty("--ry", "0deg");
  }

  return (
    <div
      ref={rootRef}
      className={`user-gate${pickingId ? " is-picking" : ""}${creating ? " is-creating" : ""}`}
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
        <p className="eyebrow user-gate-eyebrow">Session BassOrder</p>
        <h1 className="user-gate-title">
          {!session.ready
            ? "Chargement…"
            : creating
              ? "Crée ton profil"
              : "Qui écoute\u00a0?"}
        </h1>
        <p className="user-gate-lede">
          {!session.ready
            ? "On récupère tes profils depuis la base locale…"
            : creating
              ? "Un pseudo, une couleur — et la barre de nav s’allume pour toi."
              : "Sélectionne-toi : la navigation se dégrise et ton espace s’ouvre."}
        </p>

        {session.ready && sorted.length > 0 && !creating && (
          <ul className="user-gate-tiles">
            {sorted.map((user, index) => (
              <li
                key={user.id}
                style={{ ["--stagger" as string]: `${index * 70}ms` }}
              >
                <button
                  type="button"
                  className={`user-gate-tile${pickingId === user.id ? " is-picked" : ""}${session.lastUserId === user.id ? " is-last" : ""}`}
                  style={{ ["--user-color" as string]: user.color }}
                  onPointerMove={onTileMove}
                  onPointerLeave={onTileLeave}
                  onClick={() => void finishEnter(user)}
                  disabled={Boolean(pickingId) || busy}
                >
                  <span className="user-gate-tile-glow" aria-hidden />
                  <span className="user-gate-tile-face">
                    <LiveAvatar
                      name={user.name}
                      color={user.color}
                      size="lg"
                      imageUrl={user.avatarUrl}
                    />
                  </span>
                  <strong>{user.name}</strong>
                  <em>Entrer</em>
                </button>
                {confirmDelete === user.id ? (
                  <div className="user-gate-confirm">
                    <button
                      type="button"
                      className="btn-ghost"
                      onClick={() => setConfirmDelete(null)}
                    >
                      Annuler
                    </button>
                    <button
                      type="button"
                      className="btn-danger"
                      onClick={() => {
                        void session.remove(user.id).then(() => {
                          setConfirmDelete(null);
                          if (listUsers().length === 0) {
                            setCreating(true);
                          }
                        });
                      }}
                    >
                      Supprimer
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    className="user-gate-delete"
                    title="Supprimer ce profil"
                    disabled={Boolean(pickingId)}
                    onClick={() => setConfirmDelete(user.id)}
                  >
                    ×
                  </button>
                )}
              </li>
            ))}

            <li style={{ ["--stagger" as string]: `${sorted.length * 70}ms` }}>
              <button
                type="button"
                className="user-gate-tile user-gate-tile-add"
                disabled={Boolean(pickingId)}
                onPointerMove={onTileMove}
                onPointerLeave={onTileLeave}
                onClick={() => {
                  setCreating(true);
                  setName("");
                  setColor(
                    USER_COLORS.find((c) => !sorted.some((u) => u.color === c)) ??
                      USER_COLORS[0],
                  );
                }}
              >
                <span className="user-gate-tile-glow" aria-hidden />
                <span className="user-gate-tile-face">
                  <LiveAvatar
                    name="+"
                    color="transparent"
                    size="lg"
                    variant="add"
                  />
                </span>
                <strong>Nouveau</strong>
                <em>Ajouter</em>
              </button>
            </li>
          </ul>
        )}

        {session.ready && (creating || sorted.length === 0) && (
          <form className="user-gate-form user-gate-glass" onSubmit={(e) => void onCreate(e)}>
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
                disabled={Boolean(pickingId) || busy}
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
                  disabled={Boolean(pickingId) || busy}
                  onClick={() => setColor(c)}
                />
              ))}
            </div>

            <button
              type="submit"
              className="btn-primary user-gate-submit"
              disabled={Boolean(pickingId) || busy || name.trim().length < 2}
            >
              {pickingId || busy ? "Ouverture…" : "Allumer BassOrder"}
            </button>

            {sorted.length > 0 && (
              <button
                type="button"
                className="btn-ghost"
                disabled={Boolean(pickingId) || busy}
                onClick={() => setCreating(false)}
              >
                Retour aux profils
              </button>
            )}
          </form>
        )}

        <p className="user-gate-hint">
          Astuce : après entrée, ton avatar en bas du rail change d’utilisateur.
        </p>
      </div>
    </div>
  );
}
