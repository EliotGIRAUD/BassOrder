import { startTransition, useCallback, useState, type ReactNode } from "react";
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
        title: "D’abord ton profil",
        body: "Choisis qui tu es au centre — la barre s’allumera ensuite.",
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
          title: "Ça continue en fond",
          body: `${labels}. Reviens quand tu veux — rien n’est annulé.`,
        });
      } else if (next === "local") {
        const saved = listLibraries().length;
        fx.toast({
          kind: "go",
          title: "Musique sur ton PC",
          body:
            saved > 0
              ? `${saved} analyse${saved > 1 ? "s" : ""} déjà en mémoire — tu peux en rouvrir une depuis Historique.`
              : "Choisis un dossier : on lit les titres sans rien déplacer pour l’instant.",
        });
      } else if (next === "localHistory") {
        const saved = listLibraries().length;
        fx.toast({
          kind: "hint",
          title: "Historique des analyses",
          body:
            saved > 0
              ? `${saved} dossier${saved > 1 ? "s" : ""} déjà analysé${saved > 1 ? "s" : ""} — clique pour reprendre.`
              : "Ici apparaîtront tes analyses de dossiers, pour les rouvrir plus tard.",
        });
      } else if (next === "spotify") {
        const profiles = listProfiles().length;
        fx.toast({
          kind: "go",
          title: "Compte Spotify",
          body:
            profiles > 0
              ? `${profiles} profil${profiles > 1 ? "s" : ""} enregistré${profiles > 1 ? "s" : ""} — clique une bulle sous Spotify pour basculer.`
              : "Importe tes likes : ça devient le dictionnaire pour classer aussi tes fichiers locaux.",
        });
      } else if (next === "spotifyHistory") {
        const saved = listImports().length;
        fx.toast({
          kind: "hint",
          title: "Historique des imports Spotify",
          body:
            saved > 0
              ? `${saved} import${saved > 1 ? "s" : ""} mémorisé${saved > 1 ? "s" : ""} — tu peux les rouvrir.`
              : "Chaque import de likes sera listé ici, par profil.",
        });
      } else if (next === "knowledge") {
        fx.toast({
          kind: "go",
          title: "Dictionnaire d’artistes",
          body: "Liste des artistes et genres appris via Spotify — utilisée aussi pour tes MP3.",
        });
      } else if (next === "profile") {
        fx.toast({
          kind: "hint",
          title: "Ton profil",
          body: "Pseudo, couleur, stats — et un terrain orbital pour t’amuser.",
        });
      } else {
        fx.toast({
          kind: "hint",
          title: "BassOrder",
          body: "En clair : importer depuis Spotify ou ton PC → proposer des genres → classer quand tu es d’accord.",
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
          aria-label="BassOrder — accueil"
          tabIndex={locked ? -1 : 0}
        >
          <span className="rail-logo-mark">
            <span className="brand-pulse" />
          </span>
          <span className="rail-logo-text">
            B<span>O</span>
          </span>
        </button>

        <nav className="rail-nav" aria-label="Navigation principale">
          <RailBtn
            active={!locked && view === "home"}
            label="Accueil"
            hint="Retour à l’écran d’accueil"
            onClick={() => go("home")}
          >
            <HomeIcon />
          </RailBtn>
          <div className="rail-group">
            <RailBtn
              active={!locked && view === "local"}
              label="Mes fichiers"
              hint="Analyser et classer la musique sur ton PC"
              onClick={() => go("local")}
            >
              <FolderIcon />
            </RailBtn>
            <RailBtn
              active={!locked && view === "localHistory"}
              label="Hist. local"
              hint="Historique local — analyses de dossiers déjà faites, avec l’amélioration de détection"
              onClick={() => go("localHistory")}
              sub
            >
              <ClockIcon />
            </RailBtn>
          </div>
          <div className="rail-group">
            <RailBtn
              active={!locked && view === "spotify"}
              label="Spotify"
              hint="Importer tes likes pour enrichir le dictionnaire de genres"
              onClick={() => go("spotify")}
            >
              <SpotifyIcon />
            </RailBtn>
            {!locked && <RailProfileStack onOpenSpotify={() => go("spotify")} />}
            <RailBtn
              active={!locked && view === "spotifyHistory"}
              label="Hist. Spotify"
              hint="Historique Spotify — imports déjà réalisés, par profil"
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
              aria-label={`Profil de ${user.name}`}
            >
              <LiveAvatar
                name={user.name}
                color={user.color}
                size="sm"
                imageUrl={user.avatarUrl}
                className="rail-user-avatar"
              />
              <span className="rail-btn-label">{user.name}</span>
              <TipPanel>{`Profil BassOrder de ${user.name} — avatar & session`}</TipPanel>
            </button>
          ) : (
            <div className="rail-btn rail-user is-ghost" aria-hidden>
              <span className="rail-user-avatar is-empty">?</span>
              <span className="rail-btn-label">Profil</span>
            </div>
          )}

          <button
            type="button"
            className="rail-btn"
            onClick={openSearch}
            aria-label="Recherche globale (Ctrl+K)"
            tabIndex={locked ? -1 : 0}
          >
            <SearchIcon />
            <span className="rail-btn-label">Recherche</span>
            <TipPanel>Recherche globale · Ctrl+K</TipPanel>
          </button>

          <RailBtn
            active={!locked && view === "knowledge"}
            label="Dictionnaire"
            hint="Artistes et genres du profil Spotify actif"
            onClick={() => go("knowledge")}
          >
            <KnowledgeIcon />
          </RailBtn>

          <RailBtn
            active={!locked && view === "account"}
            label="Compte"
            hint="Login local, cloud et presets de réglages"
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
            aria-label="Sons, effets visuels et volume"
            tabIndex={locked ? -1 : 0}
          >
            <GearIcon />
            <span className="rail-btn-label">Réglages</span>
            <TipPanel>Sons, effets visuels et volume</TipPanel>
          </button>
        </div>

        <PushEq
          bars={5}
          hint={false}
          className="push-eq--rail"
          label="Mini égaliseur du rail"
        />
      </aside>

      <main className="stage">
        {locked ? (
          <div className="stage-panel stage-gate">
            <div className="gate-home-ghost" aria-hidden>
              <section className="home">
                <header className="home-hero">
                  <p className="eyebrow">Système de triage audio</p>
                  <h1 className="glitch-title" data-text="BassOrder">
                    Bass<span>Order</span>
                  </h1>
                  <p className="home-lead">
                    La scène est déjà là — il ne manque que toi.
                  </p>
                </header>
                <section className="modules">
                  <div className="module-card is-ghost" data-module="spotify">
                    <h2>Spotify</h2>
                    <p>Tes likes deviennent un dictionnaire de genres.</p>
                  </div>
                  <div className="module-card is-ghost" data-module="local">
                    <h2>Fichiers</h2>
                    <p>Analyse et classe ta musique locale.</p>
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
                  title: "C’est parti",
                  body: "Navigation allumée — ton espace t’attend.",
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
            <span key={i}>
              SCAN · TAGS ID3 · GENRE GRAPH · OLED BLACK · TRI AUTO 85% ·
              ITUNES · DEEZER · MUSICBRAINZ · TRIAGE LIVE · COPY / MOVE · BASSORDER ·
            </span>
          ))}
        </div>
      </div>
      <header className="home-hero">
        <p className="eyebrow">Système de triage audio</p>
        <h1 className="glitch-title" data-text="BassOrder">
          Bass<span>Order</span>
        </h1>
        <TypeLine
          className="home-lead"
          text="Classe ta musique par genre : likes Spotify ou dossiers sur ton PC. Tu choisis, BassOrder propose un plan, et rien n’est écrit sur le disque sans ton accord."
        />
        <PushEq bars={24} active />
      </header>

      <section className="modules" aria-label="Modules">
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
          <h2>Spotify</h2>
          <p>
            Connecte ton compte, importe tes titres likés, et construis un
            dictionnaire d’artistes → genres. Ensuite, tes MP3 locaux en
            profitent automatiquement.
          </p>
          <span className="module-cta">
            Commencer avec Spotify
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
          <h2>Fichiers sur mon PC</h2>
          <p>
            Choisis un dossier Windows. BassOrder lit les infos des titres,
            propose des dossiers par genre, puis copie ou déplace seulement
            quand tu cliques sur confirmer.
          </p>
          <span className="module-cta">
            Analyser mon dossier
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
