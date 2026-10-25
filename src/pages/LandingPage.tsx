import { useEffect, useMemo, useState } from "react";
import { api, type EndpointView } from "../api";
import { sessionStore, type StoredEndpoint } from "../store";
import { navigate } from "../router";
import { EmptyState, ErrorBanner, useToast } from "../components/ui";
import { formatRelative } from "../format";
import { useI18n, type TextKey } from "../i18n";

const FEATURE_KEYS: { icon: string; title: TextKey; body: TextKey }[] = [
  { icon: "⇥", title: "feature.1.title", body: "feature.1.body" },
  { icon: "⌕", title: "feature.2.title", body: "feature.2.body" },
  { icon: "↻", title: "feature.3.title", body: "feature.3.body" },
  { icon: "⧉", title: "feature.4.title", body: "feature.4.body" },
  { icon: "◐", title: "feature.5.title", body: "feature.5.body" },
  { icon: "⏱", title: "feature.6.title", body: "feature.6.body" },
];

const TTL_OPTIONS: { key: TextKey; value: number }[] = [
  { key: "ttl.1h", value: 60 },
  { key: "ttl.6h", value: 360 },
  { key: "ttl.24h", value: 1440 },
  { key: "ttl.3d", value: 4320 },
  { key: "ttl.7d", value: 10080 },
  { key: "ttl.30d", value: 43200 },
];

export default function LandingPage() {
  const toast = useToast();
  const { t, locale, errorMessage } = useI18n();
  const [sessions, setSessions] = useState<StoredEndpoint[]>([]);
  const [name, setName] = useState("");
  const [ttlMinutes, setTtlMinutes] = useState(1440);
  const [maxRequests, setMaxRequests] = useState(100);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<{ endpoint: EndpointView; token: string; ingestUrl: string } | null>(null);

  useEffect(() => {
    setSessions(sessionStore.list());
  }, []);

  async function onCreate(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await api.createEndpoint({
        name: name.trim() || undefined,
        ttlMinutes,
        maxRequests,
        retentionMinutes: Math.min(ttlMinutes, 60),
      });
      sessionStore.save({
        id: res.endpoint.id,
        token: res.token,
        name: res.endpoint.name,
        ingestUrl: res.ingestUrl,
        createdAt: Date.now(),
      });
      setCreated({ endpoint: res.endpoint, token: res.token, ingestUrl: res.ingestUrl });
      setSessions(sessionStore.list());
      toast(t("landing.createdToast"), "success");
      navigate(`/e/${res.endpoint.id}`);
    } catch (err) {
      const message = errorMessage(err) || t("landing.createFailed");
      setError(message);
      toast(message, "error");
    } finally {
      setBusy(false);
    }
  }

  const origin = useMemo(() => (typeof window === "undefined" ? "" : window.location.origin), []);

  return (
    <div className="container">
      <section className="hero">
        <span className="hero-badge">
          <span className="pulse-dot" aria-hidden="true" /> {t("landing.badge")}
        </span>
        <h1>
          {t("landing.h1a")} <span className="grad">{t("landing.h1b")}</span>
        </h1>
        <p>{t("landing.intro")}</p>
        <div className="hero-actions">
          <a className="btn btn-primary" href="#create">
            {t("landing.ctaCreate")}
          </a>
          <a
            className="btn btn-ghost"
            href="https://github.com/iiiiiiiiiiiiiKK/hooklab"
            target="_blank"
            rel="noreferrer noopener"
          >
            {t("landing.ctaSource")}
          </a>
        </div>
      </section>

      <div className="stack">
        <div className="grid-cards" id="create">
          <div className="card" style={{ gridColumn: "span 1" }}>
            <h2 className="card-title">{t("landing.newEndpoint")}</h2>
            <p className="card-hint" style={{ marginBottom: 14 }}>
              {t("landing.newEndpointHint")}
            </p>
            <form onSubmit={onCreate} className="stack" style={{ gap: 12 }}>
              <label className="field">
                {t("landing.label")}
                <input
                  type="text"
                  value={name}
                  maxLength={60}
                  onChange={(e) => setName(e.target.value)}
                  placeholder={t("landing.labelPlaceholder")}
                  autoComplete="off"
                />
              </label>
              <div className="row" style={{ gap: 10, alignItems: "flex-start" }}>
                <label className="field" style={{ flex: "1 1 130px" }}>
                  {t("landing.expiresIn")}
                  <select value={ttlMinutes} onChange={(e) => setTtlMinutes(Number(e.target.value))}>
                    {TTL_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>
                        {t(o.key)}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="field" style={{ flex: "1 1 130px" }}>
                  {t("landing.maxRequests")}
                  <input
                    type="number"
                    min={1}
                    max={500}
                    value={maxRequests}
                    onChange={(e) => setMaxRequests(Number(e.target.value))}
                  />
                </label>
              </div>
              <button type="submit" className="btn btn-primary" disabled={busy}>
                {busy ? <span className="spin" aria-hidden="true" /> : <span aria-hidden="true">+</span>}
                {busy ? t("landing.creating") : t("landing.create")}
              </button>
              {error ? <ErrorBanner message={error} /> : null}
            </form>
          </div>

          <div className="card" style={{ gridColumn: "span 1" }}>
            <h2 className="card-title">{t("landing.snippetTitle")}</h2>
            <p className="card-hint" style={{ marginBottom: 12 }}>
              {t("landing.snippetHint")}
            </p>
            <pre className="code-block wrap">{`curl -X POST ${origin}/h/<your-endpoint-id> \\
  -H 'content-type: application/json' \\
  -d '{"event":"order.paid","amount":4999}'`}</pre>
            <p className="card-hint" style={{ marginTop: 10 }}>
              {t("landing.snippetNote")}
            </p>
          </div>
        </div>

        {created ? (
          <div className="banner banner-ok" role="status">
            <span aria-hidden="true">✓</span>
            <div>
              <strong>{t("landing.ready")}</strong>{" "}
              {t("landing.readyBody", { name: created.endpoint.name, hint: created.endpoint.tokenHint })}
            </div>
          </div>
        ) : null}

        <section className="stack">
          <h2 className="section-title">{t("landing.yours")}</h2>
          {sessions.length === 0 ? (
            <div className="card card-tight">
              <EmptyState icon="⇥" title={t("landing.noneTitle")} hint={t("landing.noneHint")} />
            </div>
          ) : (
            <div className="grid-cards">
              {sessions.map((s) => (
                <div key={s.id} className="card card-tight stack" style={{ gap: 8 }}>
                  <div className="row" style={{ justifyContent: "space-between", gap: 8 }}>
                    <strong style={{ fontSize: 14.5, wordBreak: "break-word" }}>{s.name}</strong>
                    <span className="chip chip-mono">{s.token.slice(0, 7)}…</span>
                  </div>
                  <div className="tiny faint mono" style={{ wordBreak: "break-all" }}>
                    /h/{s.id}
                  </div>
                  <div className="tiny faint">
                    {t("landing.createdAt", { when: formatRelative(s.createdAt, locale) })}
                  </div>
                  <div className="row" style={{ gap: 8 }}>
                    <button type="button" className="btn btn-sm" onClick={() => navigate(`/e/${s.id}`)}>
                      {t("landing.openConsole")}
                    </button>
                    <button
                      type="button"
                      className="btn btn-sm btn-ghost"
                      onClick={() => {
                        sessionStore.remove(s.id);
                        setSessions(sessionStore.list());
                        toast(t("landing.forgotten"), "info");
                      }}
                    >
                      {t("landing.forget")}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="stack">
          <h2 className="section-title">{t("landing.features")}</h2>
          <div className="feature-grid">
            {FEATURE_KEYS.map((f) => (
              <div className="feature" key={f.title}>
                <div className="feature-icon" aria-hidden="true">
                  {f.icon}
                </div>
                <h3>{t(f.title)}</h3>
                <p>{t(f.body)}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="stack">
          <h2 className="section-title">{t("landing.how")}</h2>
          <div className="terminal">
            <div className="terminal-bar">
              <span className="terminal-dot" aria-hidden="true" />
              <span className="terminal-dot" aria-hidden="true" />
              <span className="terminal-dot" aria-hidden="true" />
              <span className="tiny faint" style={{ marginLeft: 6, fontFamily: "var(--mono)" }}>
                {t("landing.terminalTitle")}
              </span>
            </div>
            <div className="terminal-body">
              <div>
                <span className="tk-cmd">$</span> curl -X POST https://your-app.dev/h/Qm9vbGFuZC1kZW1v \
              </div>
              <div>
                {"    "}-H <span className="tk-str">'x-api-key: sk_live_demo'</span> -d{" "}
                <span className="tk-str">{`'{"event":"invoice.paid"}'`}</span>
              </div>
              <div className="tk-dim">→ 202 Accepted {"{ seq: 1, origin: "}captured{" }"}</div>
              <div> </div>
              <div>
                <span className="tk-key">method</span> <span className="tk-str">POST</span>{"  "}
                <span className="tk-key">kind</span> <span className="tk-str">json</span>{"  "}
                <span className="tk-key">size</span> <span className="tk-num">26 B</span>
              </div>
              <div>
                <span className="tk-key">x-api-key</span> <span className="tk-dim">[REDACTED]</span>
              </div>
              <div>
                <span className="tk-key">body</span>
              </div>
              <div>
                {"  "}
                <span className="tk-dim">{"{"}</span>
              </div>
              <div>
                {"    "}
                <span className="tk-key">"event"</span>: <span className="tk-str">"invoice.paid"</span>
              </div>
              <div>
                {"  "}
                <span className="tk-dim">{"}"}</span>
              </div>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
