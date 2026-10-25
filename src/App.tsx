import { useEffect, useState } from "react";
import { Link, parseRoute, useRoute, navigate } from "./router";
import { ToastProvider } from "./components/ui";
import { I18nProvider, useI18n } from "./i18n";
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

function GlobeIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" className="globe-icon">
      <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth="1.8" />
      <path
        d="M3 12h18M12 3c2.6 2.4 4 5.7 4 9s-1.4 6.6-4 9c-2.6-2.4-4-5.7-4-9s1.4-6.6 4-9z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
      />
    </svg>
  );
}

/** Compact EN / 中文 switch. Persists the choice and drives <html lang>. */
function LanguageToggle() {
  const { lang, setLang, t } = useI18n();
  return (
    <div className="lang-toggle" role="group" aria-label="Language / 语言">
      <button
        type="button"
        className={`lang-opt ${lang === "en" ? "active" : ""}`}
        onClick={() => setLang("en")}
        aria-pressed={lang === "en"}
        title={t("lang.switchToEn")}
        lang="en"
      >
        EN
      </button>
      <button
        type="button"
        className={`lang-opt ${lang === "zh" ? "active" : ""}`}
        onClick={() => setLang("zh")}
        aria-pressed={lang === "zh"}
        title={t("lang.switchToZh")}
        lang="zh-CN"
      >
        中文
      </button>
      <span className="lang-globe" aria-hidden="true">
        <GlobeIcon />
      </span>
    </div>
  );
}

function Shell() {
  const { t, lang } = useI18n();
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
    <div className="app" lang={lang === "zh" ? "zh-CN" : "en"}>
      <header className="topbar">
        <div className="topbar-inner">
          <Link to="/" className="brand" aria-label={t("brand.home")}>
            <span className="brand-mark" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none" stroke="#08111f" strokeWidth="2.6" strokeLinecap="round">
                <path d="M8 8v8M16 8v8M8 12h8" />
              </svg>
            </span>
            <span className="brand-text">HookLab</span>
          </Link>

          <nav className="topnav" aria-label={t("nav.home")}>
            <Link to="/" className={route.name === "home" ? "active" : ""}>
              <span aria-hidden="true">⌂</span>
              <span className="nav-label">{t("nav.home")}</span>
            </Link>
            {activeId ? (
              <Link to={`/e/${activeId}`} className={onEndpointRoute && route.name === "endpoint" ? "active" : ""}>
                <span aria-hidden="true">▤</span>
                <span className="nav-label">{t("nav.inbox")}</span>
              </Link>
            ) : null}
            {activeId ? (
              <Link to={`/e/${activeId}/replay`} className={route.name === "replay" ? "active" : ""}>
                <span aria-hidden="true">↻</span>
                <span className="nav-label">{t("nav.replay")}</span>
              </Link>
            ) : null}
            {activeId ? (
              <Link to={`/e/${activeId}/settings`} className={route.name === "settings" ? "active" : ""}>
                <span aria-hidden="true">⚙</span>
                <span className="nav-label">{t("nav.settings")}</span>
              </Link>
            ) : null}
            <a
              href={REPO_URL}
              className="topnav-link"
              target="_blank"
              rel="noreferrer noopener"
              title={t("nav.starTitle")}
              aria-label={t("nav.starTitle")}
              style={{ padding: "7px 11px", color: "var(--text-dim)" }}
            >
              <span aria-hidden="true">★</span>
              <span className="nav-label">{t("nav.star")}</span>
            </a>
            <LanguageToggle />
            <a
              className="x-link"
              href={X_URL}
              target="_blank"
              rel="noreferrer noopener"
              title={t("nav.xTitle")}
              aria-label={t("nav.xAria")}
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
          <span>{t("footer.tagline")}</span>
          <span className="spacer" />
          <a href={REPO_URL} target="_blank" rel="noreferrer noopener">
            {t("footer.github")}
          </a>
          <a href={`${REPO_URL}#security-model`} target="_blank" rel="noreferrer noopener">
            {t("footer.security")}
          </a>
          <a href={X_URL} target="_blank" rel="noreferrer noopener">
            {t("footer.x")}
          </a>
          <span className="faint">{t("footer.license")}</span>
        </div>
      </footer>
    </div>
  );
}

export default function App() {
  return (
    <I18nProvider>
      <ToastProvider>
        <Shell />
      </ToastProvider>
    </I18nProvider>
  );
}
