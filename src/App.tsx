import { useEffect, useState } from "react";
import { Link, parseRoute, useRoute, navigate } from "./router";
import { ToastProvider } from "./components/ui";
import LandingPage from "./pages/LandingPage";
import EndpointPage from "./pages/EndpointPage";
import RequestPage from "./pages/RequestPage";
import ReplayPage from "./pages/ReplayPage";
import SettingsPage from "./pages/SettingsPage";

const X_URL = "https://x.com/0xkillcoin";
const REPO_URL = "https://github.com/iiiiiiiiiiiiiKK/hooklab";

function XIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
    </svg>
  );
}

export default function App() {
  const route = useRoute();
  const [path, setPath] = useState(window.location.pathname);

  useEffect(() => {
    const sync = () => setPath(window.location.pathname);
    window.addEventListener("popstate", sync);
    return () => window.removeEventListener("popstate", sync);
  }, []);

  useEffect(() => {
    const r = parseRoute(path);
    if (r.name === "notfound" && r.path !== "/") {
      // Unknown deep link: fall back to the console home instead of a dead page.
      navigate("/", true);
    }
  }, [path]);

  const onEndpointRoute = route.name !== "home" && route.name !== "notfound";
  const activeId = "id" in route ? route.id : null;

  return (
    <ToastProvider>
      <div className="app">
        <header className="topbar">
          <div className="topbar-inner">
            <Link to="/" className="brand" aria-label="HookLab home">
              <span className="brand-mark" aria-hidden="true">
                <svg viewBox="0 0 24 24" fill="none" stroke="#08111f" strokeWidth="2.6" strokeLinecap="round">
                  <path d="M8 8v8M16 8v8M8 12h8" />
                </svg>
              </span>
              <span className="brand-text">HookLab</span>
            </Link>

            <nav className="topnav" aria-label="Primary">
              <Link to="/" className={route.name === "home" ? "active" : ""}>
                <span aria-hidden="true">⌂</span>
                <span className="nav-label">Home</span>
              </Link>
              {activeId ? (
                <Link to={`/e/${activeId}`} className={onEndpointRoute && route.name === "endpoint" ? "active" : ""}>
                  <span aria-hidden="true">▤</span>
                  <span className="nav-label">Inbox</span>
                </Link>
              ) : null}
              {activeId ? (
                <Link to={`/e/${activeId}/replay`} className={route.name === "replay" ? "active" : ""}>
                  <span aria-hidden="true">↻</span>
                  <span className="nav-label">Replay</span>
                </Link>
              ) : null}
              {activeId ? (
                <Link to={`/e/${activeId}/settings`} className={route.name === "settings" ? "active" : ""}>
                  <span aria-hidden="true">⚙</span>
                  <span className="nav-label">Settings</span>
                </Link>
              ) : null}
              <a
                href={REPO_URL}
                className="topnav-link"
                target="_blank"
                rel="noreferrer noopener"
                title="HookLab on GitHub"
                aria-label="HookLab on GitHub"
                style={{ padding: "7px 11px", color: "var(--text-dim)" }}
              >
                <span aria-hidden="true">★</span>
                <span className="nav-label">Star</span>
              </a>
              <a
                className="x-link"
                href={X_URL}
                target="_blank"
                rel="noreferrer noopener"
                title="Author on X — @0xkillcoin"
                aria-label="Author on X, @0xkillcoin"
              >
                <XIcon />
                <span>@0xkillcoin</span>
              </a>
            </nav>
          </div>
        </header>

        <main>
          {route.name === "home" ? <LandingPage /> : null}
          {route.name === "endpoint" ? <EndpointPage id={route.id} /> : null}
          {route.name === "request" ? <RequestPage id={route.id} requestId={route.requestId} /> : null}
          {route.name === "replay" ? <ReplayPage id={route.id} requestId={route.requestId} /> : null}
          {route.name === "settings" ? <SettingsPage id={route.id} /> : null}
        </main>

        <footer>
          <div className="footer-inner">
            <span>HookLab — capture · inspect · replay. Built for developers who are tired of guessing.</span>
            <span className="spacer" />
            <a href={REPO_URL} target="_blank" rel="noreferrer noopener">
              GitHub
            </a>
            <a href={`${REPO_URL}#security-model`} target="_blank" rel="noreferrer noopener">
              Security model
            </a>
            <a href={X_URL} target="_blank" rel="noreferrer noopener">
              𝕏 @0xkillcoin
            </a>
            <span className="faint">MIT License</span>
          </div>
        </footer>
      </div>
    </ToastProvider>
  );
}
