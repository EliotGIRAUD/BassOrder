import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { ExperienceProvider } from "./ui/Experience";
import { SettingsProvider } from "./ui/prefs";
import { UserSessionProvider } from "./users/UserSession";

const rootEl = document.getElementById("root");
if (!rootEl) {
  throw new Error("Pas de #root");
}

function BootError({ error }: { error: unknown }) {
  const message =
    error instanceof Error
      ? `${error.message}\n\n${error.stack ?? ""}`
      : String(error);
  return (
    <pre
      style={{
        margin: "1.5rem",
        padding: "1rem",
        color: "#ff8a7a",
        background: "#120405",
        whiteSpace: "pre-wrap",
        fontFamily: "Consolas, monospace",
        fontSize: "12px",
      }}
    >
      {message}
    </pre>
  );
}

class RootBoundary extends React.Component<
  { children: React.ReactNode },
  { error: unknown | null }
> {
  state: { error: unknown | null } = { error: null };

  static getDerivedStateFromError(error: unknown) {
    return { error };
  }

  render() {
    if (this.state.error) {
      return <BootError error={this.state.error} />;
    }
    return this.props.children;
  }
}

try {
  ReactDOM.createRoot(rootEl).render(
    <React.StrictMode>
      <RootBoundary>
        <UserSessionProvider>
          <SettingsProvider>
            <ExperienceProvider>
              <App />
            </ExperienceProvider>
          </SettingsProvider>
        </UserSessionProvider>
      </RootBoundary>
    </React.StrictMode>,
  );
} catch (error) {
  rootEl.replaceChildren();
  ReactDOM.createRoot(rootEl).render(<BootError error={error} />);
}

window.addEventListener("error", (event) => {
  console.error("[BassOrder]", event.error ?? event.message);
});
window.addEventListener("unhandledrejection", (event) => {
  console.error("[BassOrder rejection]", event.reason);
});
