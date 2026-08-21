import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { TipPanel } from "../ui/AppTip";
import { ProfileAura, auraColorFromName } from "../users/ProfileAura";
import { activateSpotifyProfile } from "./api";
import {
  getActiveProfile,
  listProfiles,
  selectProfile,
  type SpotifyProfile,
} from "./profiles";
import {
  notifyProfilesChanged,
  requestOpenProfile,
  subscribeProfilesChange,
} from "./profileEvents";

type Props = {
  onOpenSpotify: () => void;
};

export function RailProfileStack({ onOpenSpotify }: Props) {
  const [profiles, setProfiles] = useState<SpotifyProfile[]>(listProfiles);
  const [activeId, setActiveId] = useState(getActiveProfile()?.id ?? null);
  const [open, setOpen] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [menuPos, setMenuPos] = useState({ top: 0, left: 0 });
  const rootRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    return subscribeProfilesChange(() => {
      setProfiles(listProfiles());
      setActiveId(getActiveProfile()?.id ?? null);
    });
  }, []);

  useLayoutEffect(() => {
    if (!open || !rootRef.current) {
      return;
    }
    function place() {
      const r = rootRef.current!.getBoundingClientRect();
      const width = 220;
      const left = Math.min(
        window.innerWidth - width - 12,
        Math.max(8, r.right + 10),
      );
      setMenuPos({ top: r.top, left });
    }
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open, profiles.length]);

  useEffect(() => {
    if (!open) {
      return;
    }
    function onDoc(event: MouseEvent) {
      const target = event.target as Node;
      if (rootRef.current?.contains(target) || menuRef.current?.contains(target)) {
        return;
      }
      setOpen(false);
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (profiles.length === 0) {
    return null;
  }

  const ordered = orderProfiles(profiles, activeId);
  const primary = ordered[0];

  async function pick(profile: SpotifyProfile) {
    selectProfile(profile.id);
    setBusyId(profile.id);
    try {
      await activateSpotifyProfile(profile.id);
    } catch {
      /* le prochain refresh Spotify rattrapera */
    } finally {
      setBusyId(null);
    }
    notifyProfilesChanged();
    requestOpenProfile(profile);
    setActiveId(profile.id);
    setProfiles(listProfiles());
    setOpen(false);
    onOpenSpotify();
  }

  return (
    <div
      ref={rootRef}
      className={`rail-avatar-stack${open ? " is-open" : ""}`}
    >
      <button
        type="button"
        className={`rail-avatar-trigger${activeId === primary.id ? " is-active" : ""}`}
        onClick={() => {
          if (profiles.length === 1) {
            void pick(primary);
            return;
          }
          setOpen((value) => !value);
        }}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label={
          open
            ? "Réduire les profils"
            : profiles.length > 1
              ? `${primary.name} — cliquer pour voir / changer de profil`
              : `${primary.name} — chaque profil a sa session et son dictionnaire`
        }
      >
        <ProfileBubble profile={primary} hot />
        {profiles.length > 1 && (
          <span className="rail-avatar-count">+{profiles.length - 1}</span>
        )}
        {!open && (
          <TipPanel>
            {profiles.length > 1
              ? `${primary.name} — cliquer pour voir / changer de profil`
              : `${primary.name} — chaque profil a sa session et son dictionnaire`}
          </TipPanel>
        )}
      </button>

      {open &&
        createPortal(
          <div
            ref={menuRef}
            className="rail-avatar-menu"
            role="menu"
            aria-label="Profils Spotify"
            style={{ top: menuPos.top, left: menuPos.left }}
          >
            <p className="rail-avatar-menu-title">Comptes Spotify</p>
            <ul className="rail-avatar-menu-list">
              {ordered.map((profile) => {
                const label = (profile.displayName || profile.name || "?").trim();
                const sub =
                  profile.displayName && profile.name !== profile.displayName
                    ? profile.name
                    : null;
                return (
                  <li key={profile.id}>
                    <button
                      type="button"
                      role="menuitem"
                      className={`rail-avatar-menu-item${profile.id === activeId ? " is-active" : ""}${busyId === profile.id ? " is-busy" : ""}`}
                      onClick={() => void pick(profile)}
                    >
                      <ProfileBubble
                        profile={profile}
                        hot={profile.id === activeId}
                        size={34}
                      />
                      <span className="rail-avatar-menu-copy">
                        <strong>{label}</strong>
                        {sub && <em>{sub}</em>}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>,
          document.body,
        )}
    </div>
  );
}

function ProfileBubble({
  profile,
  hot = false,
  size = 40,
}: {
  profile: SpotifyProfile;
  hot?: boolean;
  size?: number;
}) {
  const label = (profile.displayName || profile.name || "?").trim();
  const accent = auraColorFromName(label);
  return (
    <span className={`rail-avatar-bubble${hot ? " is-hot" : ""}`}>
      <ProfileAura
        name={label}
        color={accent}
        size={size}
        compact
        interactive={false}
        imageUrl={profile.avatarUrl}
        className="rail-avatar-aura"
      />
    </span>
  );
}

function orderProfiles(
  profiles: SpotifyProfile[],
  activeId: string | null,
): SpotifyProfile[] {
  const sorted = [...profiles].sort((a, b) => {
    const aSync = a.lastSyncedAt ?? 0;
    const bSync = b.lastSyncedAt ?? 0;
    if (bSync !== aSync) {
      return bSync - aSync;
    }
    return b.lastUsedAt - a.lastUsedAt;
  });
  if (!activeId) {
    return sorted;
  }
  const active = sorted.find((p) => p.id === activeId);
  if (!active) {
    return sorted;
  }
  return [active, ...sorted.filter((p) => p.id !== activeId)];
}
