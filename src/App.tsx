import { startTransition, useCallback, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import "./App.css";
import { HistoryPage } from "./history/HistoryPage";
import { KnowledgePage } from "./knowledge/KnowledgePage";
import { LocalModule } from "./local/LocalModule";
import { listLibraries } from "./local/libraryCache";
import { listImports } from "./spotify/importCache";
import { listProfiles } from "./spotify/profiles";
import { RailProfileStack } from "./spotify/RailProfileStack";
import { SpotifyModule } from "./spotify/SpotifyModule";
import { PushEq } from "./ui/push";
import { BackgroundJobs } from "./ui/BackgroundJobs";
import { useExperience } from "./ui/Experience";
import { GlobalSearch, useGlobalSearchHotkey } from "./ui/GlobalSearch";
import { SettingsPanel } from "./ui/SettingsPanel";
import { HomePageSkeleton } from "./ui/skeleton";
import { usePaintSkeleton } from "./ui/usePaintSkeleton";
import { listWorkJobs } from "./ui/workStatus";
import { TiltCard, TypeLine } from "./ui/motion";
import { TipPanel } from "./ui/AppTip";
import { LiveAvatar } from "./users/LiveAvatar";
import { ProfilePage } from "./users/ProfilePage";
import { AccountPage } from "./account/AccountPage";
import { UserGate } from "./users/UserGate";
import { useUserSession } from "./users/UserSession";

type View =
  | "home"
  | "spotify"
  | "spotifyHistory"
  | "local"
  | "localHistory"
  | "knowledge"
  | "profile"
  | "account";

function App() {
  const { t } = useTranslation("nav");
  const { t: tc } = useTranslation("common");
  const [view, setView] = useState<View>("home");
  /** Garde Local/Spotify montés après 1re visite (jobs longs en fond). */
  const [keepLocal, setKeepLocal] = useState(false);
  const [keepSpotify, setKeepSpotify] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [waking, setWaking] = useState(false);
  const [railNudge, setRailNudge] = useState(0);
  const fx = useExperience();
  const { user, leave } = useUserSession();
  const locked = !user;

  // Activation Spotify faite dans UserSession.enter (après hydrate DB).

  const openSearch = useCallback(() => {
    if (!user) {
      setRailNudge((n) => n + 1);
      return;
    }
    setSearchOpen(true);
  }, [user]);
  useGlobalSearchHotkey(openSearch);

  function go(next: View) {
    if (locked) {
      setRailNudge((n) => n + 1);
      fx.toast({
        kind: "hint",
        title: t("toastNeedProfileTitle"),
        body: t("toastNeedProfileBody"),
      });
      return;
    }
    if (next === view) {
      return;
    }

    const from = view;
    startTransition(() => {
      setView(next);
      if (next === "local" || next === "localHistory") {
        setKeepLocal(true);
      }
      if (next === "spotify" || next === "spotifyHistory") {
        setKeepSpotify(true);
      }
    });

    // FX après le paint de la nouvelle vue — évite le gel au clic rail.
    queueMicrotask(() => {
      const jobs = listWorkJobs();
      const leavingLocalWork =
        (from === "local" || from === "localHistory") &&
        next !== "local" &&
        next !== "localHistory" &&
        jobs.some((job) => job.id.startsWith("local"));
      const leavingSpotifyWork =
        (from === "spotify" || from === "spotifyHistory") &&
        next !== "spotify" &&
        next !== "spotifyHistory" &&
        jobs.some((job) => job.id.startsWith("spotify"));

      fx.flash();
      if (leavingLocalWork || leavingSpotifyWork) {
        const labels = jobs.map((job) => job.label).join(" · ");
        fx.toast({
          kind: "hint",
          title: t("toastBgWorkTitle"),
          body: t("toastBgWorkBody", { labels }),
        });
      } else if (next === "local") {
        const saved = listLibraries().length;
        fx.toast({
          kind: "go",
          title: t("toastLocalTitle"),
          body:
            saved > 0
              ? t("toastLocalBodySaved", { count: saved })
              : t("toastLocalBodyEmpty"),
        });
      } else if (next === "localHistory") {
        const saved = listLibraries().length;
        fx.toast({
          kind: "hint",
          title: t("toastLocalHistoryTitle"),
          body:
            saved > 0
              ? t("toastLocalHistoryBodySaved", { count: saved })
              : t("toastLocalHistoryBodyEmpty"),
        });
      } else if (next === "spotify") {
        const profiles = listProfiles().length;
        fx.toast({
          kind: "go",
          title: t("toastSpotifyTitle"),
          body:
            profiles > 0
              ? t("toastSpotifyBodySaved", { count: profiles })
              : t("toastSpotifyBodyEmpty"),
        });
      } else if (next === "spotifyHistory") {
        const saved = listImports().length;
        fx.toast({
          kind: "hint",
          title: t("toastSpotifyHistoryTitle"),
          body:
            saved > 0
              ? t("toastSpotifyHistoryBodySaved", { count: saved })
              : t("toastSpotifyHistoryBodyEmpty"),
        });
      } else if (next === "knowledge") {
        fx.toast({
          kind: "go",
          title: t("toastKnowledgeTitle"),
          body: t("toastKnowledgeBody"),
        });
      } else if (next === "profile") {
        fx.toast({
          kind: "hint",
          title: t("toastProfileTitle"),
          body: t("toastProfileBody"),
        });
      } else {
        fx.toast({
          kind: "hint",
          title: t("toastHomeTitle"),
          body: t("toastHomeBody"),
        });
      }
    });
  }

  return (
    <div
      className={`app-frame${railNudge ? " is-rail-nudge" : ""}`}
      data-view={locked ? "gate" : view}
      data-session={locked ? (waking ? "waking" : "locked") : "open"}
      onAnimationEnd={(e) => {
        if (e.animationName === "rail-nudge") {
          setRailNudge(0);
        }
      }}
    >
      <div className="fx-layer" aria-hidden>
        <span className="fx-orb fx-orb-a" />
        <span className="fx-orb fx-orb-b" />
        <span className="fx-orb fx-orb-c" />
        <span className="fx-scan" />
      </div>

      <aside
        className="rail fx-frame fx-frame--mid"
        aria-hidden={locked}
        {...(locked ? ({ inert: true } as object) : {})}
      >
        <span className="spin-border" aria-hidden />
        <span className="rail-lock-veil" aria-hidden />
        <button
          type="button"
          className="rail-logo"
          onClick={() => go("home")}
          aria-label={t("homeLogoAria")}
          tabIndex={locked ? -1 : 0}
        >
          <span className="rail-logo-mark">
            <img
              className="rail-logo-img"
              src="/logo.svg"
              width={42}
              height={42}
              alt=""
              decoding="async"
            />
          </span>
          <span className="rail-logo-text">
            B<span>O</span>
          </span>
        </button>

        <nav className="rail-nav" aria-label={t("mainAria")}>
          <RailBtn
            active={!locked && view === "home"}
            label={t("home")}
            hint={t("homeHint")}
            onClick={() => go("home")}
          >
            <HomeIcon />
          </RailBtn>
          <div className="rail-group">
            <RailBtn
              active={!locked && view === "local"}
              label={t("localFiles")}
              hint={t("localFilesHint")}
              onClick={() => go("local")}
            >
              <FolderIcon />
            </RailBtn>
            <RailBtn
              active={!locked && view === "localHistory"}
              label={t("localHistory")}
              hint={t("localHistoryHint")}
              onClick={() => go("localHistory")}
              sub
            >
              <ClockIcon />
            </RailBtn>
          </div>
          <div className="rail-group">
            <RailBtn
              active={!locked && view === "spotify"}
              label={t("spotify")}
              hint={t("spotifyHint")}
              onClick={() => go("spotify")}
            >
              <SpotifyIcon />
            </RailBtn>
            {!locked && <RailProfileStack onOpenSpotify={() => go("spotify")} />}
            <RailBtn
              active={!locked && view === "spotifyHistory"}
              label={t("spotifyHistory")}
              hint={t("spotifyHistoryHint")}
              onClick={() => go("spotifyHistory")}
              sub
            >
              <ClockIcon />
            </RailBtn>
          </div>
        </nav>

        {!locked && <BackgroundJobs onOpen={(target) => go(target)} />}

        <div className="rail-footer">
          {user ? (
            <button
              type="button"
              className={`rail-btn rail-user${view === "profile" ? " is-active" : ""}`}
              onClick={() => go("profile")}
              aria-label={t("profileAria", { name: user.name })}
            >
              <LiveAvatar
                name={user.name}
                color={user.color}
                size="sm"
                imageUrl={user.avatarUrl}
                className="rail-user-avatar"
              />
              <span className="rail-btn-label">{user.name}</span>
              <TipPanel>{t("profileTip", { name: user.name })}</TipPanel>
            </button>
          ) : (
            <div className="rail-btn rail-user is-ghost" aria-hidden>
              <span className="rail-user-avatar is-empty">?</span>
              <span className="rail-btn-label">{tc("profile")}</span>
            </div>
          )}

          <button
            type="button"
            className="rail-btn"
            onClick={openSearch}
            aria-label={t("searchAria")}
            tabIndex={locked ? -1 : 0}
          >
            <SearchIcon />
            <span className="rail-btn-label">{t("searchLabel")}</span>
            <TipPanel>{t("searchTip")}</TipPanel>
          </button>

          <RailBtn
            active={!locked && view === "knowledge"}
            label={t("knowledge")}
            hint={t("knowledgeHint")}
            onClick={() => go("knowledge")}
          >
            <KnowledgeIcon />
          </RailBtn>

          <RailBtn
            active={!locked && view === "account"}
            label={t("account")}
            hint={t("accountHint")}
            onClick={() => go("account")}
          >
            <AccountIcon />
          </RailBtn>

          <button
            type="button"
            className={`rail-btn rail-settings${settingsOpen ? " is-active" : ""}`}
            onClick={() => {
              if (locked) {
                setRailNudge((n) => n + 1);
                return;
              }
              setSettingsOpen(true);
            }}
            aria-label={t("settingsAria")}
            tabIndex={locked ? -1 : 0}
          >
            <GearIcon />
            <span className="rail-btn-label">{t("settings")}</span>
            <TipPanel>{t("settingsTip")}</TipPanel>
          </button>
        </div>

        <PushEq
          bars={5}
          hint={false}
          className="push-eq--rail"
          label={t("railEqLabel")}
        />
      </aside>

      <main className="stage">
        {locked ? (
          <div className="stage-panel stage-gate">
            <div className="gate-home-ghost" aria-hidden>
              <section className="home">
                <header className="home-hero">
                  <p className="eyebrow">{t("homeEyebrow")}</p>
                  <h1 className="glitch-title" data-text="BassOrder">
                    Bass<span>Order</span>
                  </h1>
                  <p className="home-lead">{t("homeLeadGate")}</p>
                </header>
                <section className="modules">
                  <div className="module-card is-ghost" data-module="spotify">
                    <h2>{t("cardSpotifyTitle")}</h2>
                    <p>{t("cardSpotifyGhost")}</p>
                  </div>
                  <div className="module-card is-ghost" data-module="local">
                    <h2>{t("cardLocalGhostTitle")}</h2>
                    <p>{t("cardLocalGhost")}</p>
                  </div>
                </section>
              </section>
            </div>
            <UserGate
              onUnlockStart={() => setWaking(true)}
              onUnlocked={() => {
                setWaking(false);
                setView("home");
                fx.flash();
                fx.toast({
                  kind: "ok",
                  title: t("toastUnlockedTitle"),
                  body: t("toastUnlockedBody"),
                });
              }}
            />
          </div>
        ) : (
          <>
            {view === "home" && (
              <div className="stage-panel">
                <HomePanel onGo={go} />
              </div>
            )}

            {(view === "spotify" || keepSpotify) && (
              <div
                className="stage-local"
                hidden={view !== "spotify"}
                inert={view !== "spotify"}
              >
                <SpotifyModule live={view === "spotify"} />
              </div>
            )}

            {view === "spotifyHistory" && (
              <div className="stage-panel">
                <HistoryPage kind="spotify" onOpenLocal={() => go("spotify")} />
              </div>
            )}

            {(view === "local" || keepLocal) && (
              <div
                className="stage-local"
                hidden={view !== "local"}
                inert={view !== "local"}
              >
                <LocalModule active={view === "local"} />
              </div>
            )}

            {view === "localHistory" && (
              <div className="stage-panel">
                <HistoryPage kind="local" onOpenLocal={() => go("local")} />
              </div>
            )}

            {view === "knowledge" && (
              <div className="stage-local">
                <KnowledgePage onOpenSpotify={() => go("spotify")} />
              </div>
            )}

            {view === "profile" && (
              <div className="stage-panel">
                <ProfilePage
                  onLeave={() => {
                    setView("home");
                    leave();
                  }}
                />
              </div>
            )}

            {view === "account" && (
              <div className="stage-panel" style={{ ["--user-color" as string]: user?.color }}>
                <AccountPage />
              </div>
            )}
          </>
        )}
      </main>

      {!locked && (
        <>
          <SettingsPanel open={settingsOpen} onClose={() => setSettingsOpen(false)} />
          <GlobalSearch
            open={searchOpen}
            onClose={() => setSearchOpen(false)}
            onNavigate={(next) => {
              setSearchOpen(false);
              go(next);
            }}
          />
        </>
      )}
    </div>
  );
}

function RailBtn({
  active,
  label,
  hint,
  onClick,
  children,
  sub = false,
}: {
  active: boolean;
  label: string;
  hint?: string;
  onClick: () => void;
  children: ReactNode;
  sub?: boolean;
}) {
  return (
    <button
      type="button"
      className={`rail-btn${sub ? " is-sub" : ""}${active ? " is-active" : ""}`}
      onClick={onClick}
      aria-current={active ? "page" : undefined}
      aria-label={hint ?? label}
    >
      {children}
      <span className="rail-btn-label">{label}</span>
      {hint ? <TipPanel>{hint}</TipPanel> : null}
    </button>
  );
}

function HomePanel({ onGo }: { onGo: (view: View) => void }) {
  const { t } = useTranslation("nav");
  const paintSkel = usePaintSkeleton(160);
  if (paintSkel) {
    return (
      <section className="home">
        <HomePageSkeleton />
      </section>
    );
  }
  return (
    <section className="home">
      <div className="cyber-floor" aria-hidden>
        <span />
      </div>
      <div className="ticker" aria-hidden>
        <div className="ticker-track">
          {Array.from({ length: 2 }, (_, i) => (
            <span key={i}>{t("homeTicker")}</span>
          ))}
        </div>
      </div>
      <header className="home-hero">
        <p className="eyebrow">{t("homeEyebrow")}</p>
        <h1 className="glitch-title" data-text="BassOrder">
          Bass<span>Order</span>
        </h1>
        <TypeLine className="home-lead" text={t("homeLead")} />
        <PushEq bars={24} active />
      </header>

      <section className="modules" aria-label={t("modulesAria")}>
        <TiltCard
          type="button"
          className="module-card"
          data-module="spotify"
          onClick={() => onGo("spotify")}
        >
          <span className="spin-border" aria-hidden />
          <span className="aurora" aria-hidden />
          <span className="module-spot" aria-hidden />
          <span className="module-shine" aria-hidden />
          <div className="module-icon">
            <SpotifyIcon />
          </div>
          <h2>{t("cardSpotifyTitle")}</h2>
          <p>{t("cardSpotifyBody")}</p>
          <span className="module-cta">
            {t("cardSpotifyCta")}
            <ArrowIcon />
          </span>
        </TiltCard>

        <TiltCard
          type="button"
          className="module-card"
          data-module="local"
          onClick={() => onGo("local")}
        >
          <span className="spin-border" aria-hidden />
          <span className="aurora" aria-hidden />
          <span className="module-spot" aria-hidden />
          <span className="module-shine" aria-hidden />
          <div className="module-icon">
            <FolderIcon />
          </div>
          <h2>{t("cardLocalTitle")}</h2>
          <p>{t("cardLocalBody")}</p>
          <span className="module-cta">
            {t("cardLocalCta")}
            <ArrowIcon />
          </span>
        </TiltCard>
      </section>
    </section>
  );
}

function GearIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="12" cy="12" r="3.1" stroke="currentColor" strokeWidth="1.6" />
      <path
        d="M12 3.4v2.2M12 18.4v2.2M4.9 7.1l1.9 1.1M17.2 15.8l1.9 1.1M3.4 12h2.2M18.4 12h2.2M4.9 16.9l1.9-1.1M17.2 8.2l1.9-1.1"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  );
}

function HomeIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M4 11.5 12 4l8 7.5V20a1 1 0 0 1-1 1h-5v-6H10v6H5a1 1 0 0 1-1-1v-8.5Z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function ClockIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="12" cy="12" r="8" stroke="currentColor" strokeWidth="1.6" />
      <path
        d="M12 8v4.2l2.6 1.6"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function FolderIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M3 7.5A1.5 1.5 0 0 1 4.5 6h5l2 2h8A1.5 1.5 0 0 1 21 9.5v8A1.5 1.5 0 0 1 19.5 19h-15A1.5 1.5 0 0 1 3 17.5v-10Z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function SearchIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="11" cy="11" r="6.5" stroke="currentColor" strokeWidth="1.6" />
      <path
        d="m16.2 16.2 3.3 3.3"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  );
}

function KnowledgeIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden>
      <ellipse cx="12" cy="6.5" rx="7" ry="2.6" stroke="currentColor" strokeWidth="1.6" />
      <path
        d="M5 6.5v7.2c0 1.4 3.1 2.6 7 2.6s7-1.2 7-2.6V6.5"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      <path
        d="M5 10.2c0 1.4 3.1 2.6 7 2.6s7-1.2 7-2.6"
        stroke="currentColor"
        strokeWidth="1.6"
      />
    </svg>
  );
}

function AccountIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="12" cy="9" r="3.4" stroke="currentColor" strokeWidth="1.6" />
      <path
        d="M5.5 19.2c1.2-3 3.5-4.5 6.5-4.5s5.3 1.5 6.5 4.5"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
      <path
        d="M17.2 6.2 19 8l2.6-3"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function SpotifyIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.6" />
      <path
        d="M8 10.2c2.8-1.1 5.8-.9 8.4.6M8.4 13c2.2-.8 4.6-.7 6.6.4M8.8 15.6c1.6-.5 3.3-.4 4.8.3"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  );
}

function ArrowIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" aria-hidden>
      <path
        d="M3 8h10M9 4l4 4-4 4"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export default App;
