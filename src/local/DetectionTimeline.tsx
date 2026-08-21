import type { DetectionEvent } from "./libraryCache";
import { useCollapsedPanel } from "./useCollapsedPanel";

/** Chronologie des hausses / baisses du % de tri auto — repliable. */
export function DetectionTimeline({
  events,
  compact = false,
  collapsible = true,
}: {
  events: DetectionEvent[];
  compact?: boolean;
  /** Si false (ex. carte historique), toujours affiché ouvert. */
  collapsible?: boolean;
}) {
  const [collapsed, toggle] = useCollapsedPanel(
    "bassorder.ui.detectionTimeline.collapsed",
    true,
  );
  const isCollapsed = collapsible && collapsed;

  if (events.length === 0) {
    return null;
  }
  const shown = events.slice(-5).reverse();
  const last = shown[0];
  return (
    <div
      className={`history-detection${compact ? " is-compact" : ""}${isCollapsed ? " is-collapsed" : ""}`}
      aria-label="Historique d’amélioration"
    >
      {collapsible ? (
        <button
          type="button"
          className="panel-collapse-toggle"
          aria-expanded={!isCollapsed}
          onClick={toggle}
        >
          <span className="panel-collapse-chevron" aria-hidden>
            {isCollapsed ? "▸" : "▾"}
          </span>
          <span className="history-detection-label">Amélioration détection</span>
          {isCollapsed && last && (
            <span className="panel-collapse-summary">
              <em
                className={`history-detection-delta${last.delta > 0 ? " is-up" : last.delta < 0 ? " is-down" : ""}`}
              >
                {last.delta > 0
                  ? `+${last.delta}`
                  : last.delta < 0
                    ? `${last.delta}`
                    : "="}
                %
              </em>
              {last.reason}
              <strong>{last.percent}%</strong>
            </span>
          )}
          <span className="panel-collapse-hint">
            {isCollapsed ? "Déplier" : "Réduire"}
          </span>
        </button>
      ) : (
        <p className="history-detection-label">Amélioration détection</p>
      )}
      {!isCollapsed && (
        <ul>
          {shown.map((ev, i) => (
            <li key={`${ev.at}-${i}`}>
              <span
                className={`history-detection-delta${ev.delta > 0 ? " is-up" : ev.delta < 0 ? " is-down" : ""}`}
              >
                {ev.delta > 0 ? `+${ev.delta}` : ev.delta < 0 ? `${ev.delta}` : "="}%
              </span>
              <span className="history-detection-reason">{ev.reason}</span>
              <span className="history-detection-pct">{ev.percent}%</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
