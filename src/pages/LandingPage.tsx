import { useEffect, useMemo, useState } from "react";
import { api, ApiError, type EndpointView } from "../api";
import { sessionStore, type StoredEndpoint } from "../store";
import { navigate } from "../router";
import { EmptyState, ErrorBanner, useToast } from "../components/ui";
import { formatRelative } from "../format";

const FEATURES = [
  {
    icon: "⇥",
    title: "Real, public HTTPS endpoints",
    body: "Every endpoint is a live server route — point any provider webhook at it and the request is captured in milliseconds.",
  },
  {
    icon: "⌕",
    title: "Full-fidelity inspection",
    body: "Method, path, query, headers, timing and the raw body. JSON is prettified, forms are decoded, binaries are hashed safely.",
  },
  {
    icon: "↻",
    title: "Safe replay",
    body: "Replay to a target you type — SSRF-guarded against private IPs, metadata services, DNS rebinding and redirect hops.",
  },
  {
    icon: "⧉",
    title: "Paste-ready snippets",
    body: "curl, fetch and Python examples generated for your endpoint, so wiring a provider takes seconds.",
  },
  {
    icon: "◐",
    title: "Redaction by default",
    body: "Authorization, Cookie, API keys and signatures are stored as [REDACTED] unless you explicitly opt in.",
  },
  {
    icon: "⏱",
    title: "Self-destructing data",
    body: "TTLs, request caps and byte quotas are enforced server-side. Expired rows are swept automatically.",
  },
];

const TTL_OPTIONS = [
  { label: "1 hour", value: 60 },
  { label: "6 hours", value: 360 },
  { label: "24 hours", value: 1440 },
  { label: "3 days", value: 4320 },
  { label: "7 days", value: 10080 },
  { label: "30 days", value: 43200 },
];

export default function LandingPage() {
  const toast = useToast();
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
      toast("Endpoint created — token saved in this browser only.", "success");
      navigate(`/e/${res.endpoint.id}`);
    } catch (err) {
      const message = err instanceof ApiError ? err.message : "Could not create the endpoint. Please retry.";
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
          <span className="pulse-dot" aria-hidden="true" /> Live capture service · no signup required
        </span>
        <h1>
          A webhook lab for <span className="grad">requests you can actually see</span>
        </h1>
        <p>
          HookLab creates a temporary public HTTPS endpoint that records every request it receives — headers, query
          string, body and timing. Inspect it, copy a ready-made snippet, then replay it to a target you choose. Built
          for Stripe/GitHub/Shopee-style webhook debugging where “did the payload even arrive?” is the whole question.
        </p>
        <div className="hero-actions">
          <a className="btn btn-primary" href="#create">
            Create an endpoint
          </a>
          <a className="btn btn-ghost" href="https://github.com/iiiiiiiiiiiiiKK/hooklab" target="_blank" rel="noreferrer noopener">
            ★ Read the source
          </a>
        </div>
      </section>

      <div className="stack">
        <div className="grid-cards" id="create">
          <div className="card" style={{ gridColumn: "span 1" }}>
            <h2 className="card-title">New endpoint</h2>
            <p className="card-hint" style={{ marginBottom: 14 }}>
              The access token is shown once and kept only in this browser.
            </p>
            <form onSubmit={onCreate} className="stack" style={{ gap: 12 }}>
              <label className="field">
                Label (optional)
                <input
                  type="text"
                  value={name}
                  maxLength={60}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Stripe checkout test"
                  autoComplete="off"
                />
              </label>
              <div className="row" style={{ gap: 10, alignItems: "flex-start" }}>
                <label className="field" style={{ flex: "1 1 130px" }}>
                  Expires in
                  <select value={ttlMinutes} onChange={(e) => setTtlMinutes(Number(e.target.value))}>
                    {TTL_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="field" style={{ flex: "1 1 130px" }}>
                  Max requests
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
                {busy ? "Creating…" : "Create endpoint"}
              </button>
              {error ? <ErrorBanner message={error} /> : null}
            </form>
          </div>

          <div className="card" style={{ gridColumn: "span 1" }}>
            <h2 className="card-title">Try it in one command</h2>
            <p className="card-hint" style={{ marginBottom: 12 }}>
              After creating an endpoint, paste these with your own id:
            </p>
            <pre className="code-block wrap">{`curl -X POST ${origin}/h/<your-endpoint-id> \\
  -H 'content-type: application/json' \\
  -d '{"event":"order.paid","amount":4999}'`}</pre>
            <p className="card-hint" style={{ marginTop: 10 }}>
              Requests appear in the inbox instantly — the console polls the API every 3 seconds.
            </p>
          </div>
        </div>

        {created ? (
          <div className="banner banner-ok" role="status">
            <span aria-hidden="true">✓</span>
            <div>
              <strong>Endpoint ready.</strong> {created.endpoint.name} — token {created.endpoint.tokenHint} saved
              locally. Open the console to copy the full URL.
            </div>
          </div>
        ) : null}

        <section className="stack">
          <h2 className="section-title">Your endpoints in this browser</h2>
          {sessions.length === 0 ? (
            <div className="card card-tight">
              <EmptyState
                icon="⇥"
                title="No endpoints yet"
                hint="Create one above. Tokens live in this browser's localStorage, so a different device or a cleared cache cannot open old endpoints."
              />
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
                  <div className="tiny faint">Created {formatRelative(s.createdAt)}</div>
                  <div className="row" style={{ gap: 8 }}>
                    <button type="button" className="btn btn-sm" onClick={() => navigate(`/e/${s.id}`)}>
                      Open console
                    </button>
                    <button
                      type="button"
                      className="btn btn-sm btn-ghost"
                      onClick={() => {
                        sessionStore.remove(s.id);
                        setSessions(sessionStore.list());
                        toast("Endpoint removed from this browser. Server data expires on its own TTL.", "info");
                      }}
                    >
                      Forget
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="stack">
          <h2 className="section-title">What you get</h2>
          <div className="feature-grid">
            {FEATURES.map((f) => (
              <div className="feature" key={f.title}>
                <div className="feature-icon" aria-hidden="true">
                  {f.icon}
                </div>
                <h3>{f.title}</h3>
                <p>{f.body}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="stack">
          <h2 className="section-title">How it works</h2>
          <div className="terminal">
            <div className="terminal-bar">
              <span className="terminal-dot" aria-hidden="true" />
              <span className="terminal-dot" aria-hidden="true" />
              <span className="terminal-dot" aria-hidden="true" />
              <span className="tiny faint" style={{ marginLeft: 6, fontFamily: "var(--mono)" }}>
                hooklab — capture flow
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
