import type { CSSProperties, ReactNode } from "react";

type BoneProps = {
  className?: string;
  style?: CSSProperties;
  /** largeur ex. "60%" | "8rem" */
  w?: string | number;
  /** hauteur */
  h?: string | number;
  r?: string | number;
};

/** Os de base — shimmer OLED. */
export function Skel({ className = "", style, w, h, r }: BoneProps) {
  return (
    <span
      className={`skel ${className}`.trim()}
      style={{
        width: w,
        height: h,
        borderRadius: r,
        ...style,
      }}
      aria-hidden
    />
  );
}

export function SkelLine({
  w = "100%",
  className = "",
}: {
  w?: string | number;
  className?: string;
}) {
  return <Skel className={`skel-line ${className}`.trim()} w={w} h="0.72rem" r={6} />;
}

export function SkelCircle({
  size = 40,
  className = "",
}: {
  size?: number;
  className?: string;
}) {
  return (
    <Skel
      className={`skel-circle ${className}`.trim()}
      w={size}
      h={size}
      r="50%"
    />
  );
}

export function SkelBlock({
  h = 120,
  className = "",
}: {
  h?: string | number;
  className?: string;
}) {
  return <Skel className={`skel-block ${className}`.trim()} w="100%" h={h} r={14} />;
}

export function SkelStack({
  lines = 3,
  className = "",
}: {
  lines?: number;
  className?: string;
}) {
  const widths = ["92%", "78%", "64%", "86%", "70%"];
  return (
    <div className={`skel-stack ${className}`.trim()} aria-hidden>
      {Array.from({ length: lines }, (_, i) => (
        <SkelLine key={i} w={widths[i % widths.length]} />
      ))}
    </div>
  );
}

function Frame({
  children,
  className = "",
  label = "Chargement",
}: {
  children: ReactNode;
  className?: string;
  label?: string;
}) {
  return (
    <div
      className={`skel-page ${className}`.trim()}
      role="status"
      aria-busy="true"
      aria-label={label}
    >
      {children}
    </div>
  );
}

/** KPI row — Local / Spotify. */
export function KpiGridSkeleton({ count = 4 }: { count?: number }) {
  return (
    <div className="skel-kpi-grid" aria-hidden>
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="skel-kpi">
          {i === 0 && <SkelCircle size={56} />}
          <SkelLine w="42%" />
          <Skel h="1.6rem" w="58%" r={8} />
          <SkelLine w="70%" />
        </div>
      ))}
    </div>
  );
}

export function KnowledgePageSkeleton() {
  return (
    <Frame className="skel-knowledge" label="Chargement du dictionnaire">
      <div className="skel-topbar">
        <div className="skel-stack">
          <SkelLine w="7rem" />
          <Skel h="1.8rem" w="16rem" r={8} />
          <SkelLine w="22rem" />
        </div>
        <div className="skel-toolbar">
          <Skel h="2.1rem" w="9rem" r={10} />
          <Skel h="2.1rem" w="7rem" r={10} />
        </div>
      </div>
      <div className="skel-knowledge-summary">
        <SkelBlock h={72} />
      </div>
      <div className="skel-knowledge-workspace">
        <div className="skel-panel">
          <SkelLine w="40%" />
          <SkelStack lines={8} />
        </div>
        <div className="skel-panel">
          <SkelLine w="35%" />
          <SkelStack lines={10} />
        </div>
        <div className="skel-panel">
          <SkelCircle size={48} />
          <SkelStack lines={5} />
        </div>
      </div>
    </Frame>
  );
}

export function SpotifyBootSkeleton() {
  return (
    <Frame className="skel-spotify" label="Chargement Spotify">
      <div className="skel-topbar">
        <div className="skel-stack">
          <SkelLine w="6rem" />
          <Skel h="1.8rem" w="14rem" r={8} />
          <SkelLine w="20rem" />
        </div>
        <div className="skel-toolbar">
          <Skel h="2.1rem" w="10rem" r={10} />
          <Skel h="2.1rem" w="9rem" r={10} />
        </div>
      </div>
      <KpiGridSkeleton count={4} />
      <div className="skel-plan">
        <div className="skel-panel">
          <SkelLine w="45%" />
          <SkelStack lines={7} />
        </div>
        <div className="skel-panel">
          <SkelLine w="50%" />
          <SkelStack lines={6} />
        </div>
      </div>
    </Frame>
  );
}

export function LocalBootSkeleton() {
  return (
    <Frame className="skel-local" label="Chargement de l’analyse">
      <div className="skel-topbar">
        <div className="skel-stack">
          <SkelLine w="7rem" />
          <Skel h="1.8rem" w="15rem" r={8} />
          <SkelLine w="18rem" />
        </div>
        <div className="skel-toolbar">
          <Skel h="2.1rem" w="11rem" r={10} />
          <Skel h="2.1rem" w="9rem" r={10} />
        </div>
      </div>
      <KpiGridSkeleton count={4} />
      <div className="skel-plan">
        <div className="skel-panel">
          <SkelLine w="40%" />
          <SkelStack lines={8} />
        </div>
        <div className="skel-panel">
          <SkelLine w="55%" />
          <SkelBlock h={160} />
          <SkelStack lines={4} />
        </div>
      </div>
    </Frame>
  );
}

export function HistoryListSkeleton({ cards = 3 }: { cards?: number }) {
  return (
    <Frame className="skel-history" label="Chargement de l’historique">
      <div className="skel-topbar">
        <div className="skel-stack">
          <SkelLine w="6rem" />
          <Skel h="1.8rem" w="14rem" r={8} />
          <SkelLine w="20rem" />
        </div>
      </div>
      <ul className="skel-history-list">
        {Array.from({ length: cards }, (_, i) => (
          <li key={i} className="skel-history-card">
            <div className="skel-history-head">
              <SkelCircle size={36} />
              <div className="skel-stack" style={{ flex: 1 }}>
                <SkelLine w="55%" />
                <SkelLine w="35%" />
              </div>
              <Skel h="1.4rem" w="4.5rem" r={999} />
            </div>
            <SkelBlock h={48} />
            <div className="skel-history-stats">
              {Array.from({ length: 6 }, (_, j) => (
                <Skel key={j} h="2.6rem" r={10} />
              ))}
            </div>
          </li>
        ))}
      </ul>
    </Frame>
  );
}

export function ProfilePageSkeleton() {
  return (
    <Frame className="skel-profile" label="Chargement du profil">
      <div className="skel-topbar">
        <div className="skel-stack">
          <SkelLine w="8rem" />
          <Skel h="1.8rem" w="12rem" r={8} />
          <SkelLine w="24rem" />
        </div>
      </div>
      <div className="skel-profile-hero">
        <SkelCircle size={200} />
        <div className="skel-stack" style={{ flex: 1 }}>
          <SkelLine w="6rem" />
          <Skel h="1.6rem" w="10rem" r={8} />
          <SkelLine w="16rem" />
        </div>
      </div>
      <div className="skel-profile-grid">
        <SkelBlock h={180} />
        <SkelBlock h={180} />
        <SkelBlock h={180} />
      </div>
    </Frame>
  );
}

export function ArtistListSkeleton({ rows = 8 }: { rows?: number }) {
  return (
    <ul className="skel-artist-list" aria-busy="true" aria-label="Chargement des artistes">
      {Array.from({ length: rows }, (_, i) => (
        <li key={i}>
          <SkelLine w={`${62 + ((i * 17) % 30)}%`} />
        </li>
      ))}
    </ul>
  );
}

export function SearchHitsSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <ul className="skel-search-list" aria-busy="true" aria-label="Indexation…">
      {Array.from({ length: rows }, (_, i) => (
        <li key={i} className="skel-search-row">
          <SkelCircle size={28} />
          <div className="skel-stack" style={{ flex: 1 }}>
            <SkelLine w={`${50 + (i % 4) * 10}%`} />
            <SkelLine w={`${35 + (i % 3) * 12}%`} />
          </div>
        </li>
      ))}
    </ul>
  );
}

export function ConnectFormSkeleton() {
  return (
    <div className="skel-connect fx-frame fx-frame--mid" role="status" aria-busy="true">
      <SkelLine w="8rem" />
      <Skel h="1.5rem" w="18rem" r={8} />
      <SkelStack lines={4} />
      <Skel h="2.4rem" w="100%" r={10} />
      <Skel h="2.4rem" w="100%" r={10} />
      <Skel h="2.6rem" w="12rem" r={10} />
    </div>
  );
}

export function CoverSkeleton({ size = 56 }: { size?: number }) {
  return <Skel className="skel-cover" w={size} h={size} r={10} />;
}

export function HomePageSkeleton() {
  return (
    <Frame className="skel-home" label="Chargement de l’accueil">
      <div className="skel-stack">
        <SkelLine w="9rem" />
        <Skel h="2.6rem" w="14rem" r={10} />
        <SkelLine w="28rem" />
      </div>
      <SkelBlock h={72} />
      <div className="skel-home-modules">
        <SkelBlock h={200} />
        <SkelBlock h={200} />
      </div>
    </Frame>
  );
}

export function SettingsSkeleton() {
  return (
    <div className="skel-settings" role="status" aria-busy="true" aria-label="Chargement des paramètres">
      <SkelLine w="6rem" />
      <Skel h="1.6rem" w="10rem" r={8} />
      <SkelBlock h={96} />
      <SkelStack lines={6} />
      <SkelBlock h={72} />
    </div>
  );
}
