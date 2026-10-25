import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, ApiError, type RequestSummary } from "../api";
import { useEndpoint, usePolling } from "../hooks";
import { navigate, Link } from "../router";
import {
  EmptyState,
  ErrorBanner,
  Loading,
  MethodChip,
  OriginChip,
  useToast,
} from "../components/ui";
import { TokenGate, UrlField } from "../components/TokenGate";
import { formatBytes, formatRelative, formatTime } from "../format";

const METHODS = ["", "GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"] as const;

export default function EndpointPage({ id }: { id: string }) {
  const { session, endpoint, loading, error, refresh, needsToken, attachToken, stats } = useEndpoint(id);
  const [requests, setRequests] = useState<RequestSummary[]>([]);
  const [listError, setListError] = useState<string | null>(null);
  const [listLoading, setListLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [method, setMethod] = useState<string>("");
  const [origin, setOrigin] = useState<string>("");
  const [live, setLive] = useState(true);
  const [lastSync, setLastSync] = useState<number | null>(null);
  const [newCount, setNewCount] = useState(0);
  const filtersRef = useRef({ search, method, origin });
  filtersRef.current = { search, method, origin };

  const loadRequests = useCallback(
    async (quiet = false) => {
      if (!session) return;
      if (!quiet) setListLoading(true);
      try {
        const res = await api.listRequests(session.id, session.token, {
          q: filtersRef.current.search || undefined,
          method: filtersRef.current.method || undefined,
          origin: filtersRef.current.origin || undefined,
          limit: 100,
        });
        setRequests(res.requests);
        setListError(null);
        setLastSync(Date.now());
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) {
          navigate(`/e/${id}`, true);
        }
        setListError(err instanceof ApiError ? err.message : "Could not load requests.");
      } finally {
        setListLoading(false);
      }
    },
    [session, id],
  );

  useEffect(() => {
    void loadRequests();
  }, [loadRequests]);

  // Debounced re-query when filters change.
  useEffect(() => {
    const t = window.setTimeout(() => void loadRequests(true), 260);
    return () => window.clearTimeout(t);
  }, [search, method, origin, loadRequests]);

  usePolling(() => void loadRequests(true), 3000, live && !!session);

  useEffect(() => {
    if (!requests.length) return;
    const maxSeq = Math.max(...requests.map((r) => r.seq));
    setNewCount(requests.filter((r) => r.seq > maxSeq - 0 && r.receivedAt > Date.now() - 4000).length);
  }, [requests]);

  const baseUrl = useMemo(() => (typeof window === "undefined" ? "" : window.location.origin), []);
  const ingestUrl = endpoint ? `${baseUrl}${endpoint.ingestPath}` : session ? session.ingestUrl : "";

  if (loading) {
    return (
      <div className="container">
        <Loading label="Opening endpoint…" />
      </div>
    );
  }

  if (needsToken) {
    return <TokenGate id={id} onSubmit={attachToken} />;
  }

  if (error && !endpoint) {
    return (
      <div className="container">
        <div className="card stack">
          <h1 className="endpoint-title">Endpoint unavailable</h1>
          <ErrorBanner
            message={
              error.status === 401
                ? "The stored token for this endpoint is no longer valid. It may have expired or been rotated."
                : error.message
            }
            onRetry={() => void refresh()}
          />
          <div className="row">
            <Link to="/" className="btn btn-ghost">
              Back to home
            </Link>
          </div>
        </div>
      </div>
    );
  }

  if (!endpoint) {
    return (
      <div className="container">
        <div className="card">
          <EmptyState title="Nothing to show" hint="This endpoint could not be loaded." />
        </div>
      </div>
    );
  }

  const expired = endpoint.status === "expired" || endpoint.expiresAt <= Date.now();

  return (
    <div className="container stack" style={{ gap: 16 }}>
      <div className="card stack" style={{ gap: 14 }}>
        <div className="endpoint-head">
          <div style={{ flex: "1 1 320px", minWidth: 0 }}>
            <div className="row" style={{ gap: 8, marginBottom: 4 }}>
              <span className={`chip ${expired ? "tone-bad" : endpoint.status === "paused" ? "tone-warn" : "chip-captured"}`}>
                {expired ? "expired" : endpoint.status}
              </span>
              <span className="chip chip-mono">{endpoint.tokenHint}</span>
              {endpoint.storeSensitiveHeaders ? <span className="chip tone-warn">sensitive headers stored</span> : null}
            </div>
            <h1 className="endpoint-title">{endpoint.name}</h1>
            <p className="small faint" style={{ margin: "4px 0 0" }}>
              Expires {formatRelative(endpoint.expiresAt)} · retains {endpoint.retentionMinutes} min ·{" "}
              {endpoint.rateLimitPerMinute}/min ingest limit
            </p>
          </div>
          <div className="row" style={{ gap: 8 }}>
            <button type="button" className="btn btn-primary" onClick={() => navigate(`/e/${id}/replay`)}>
              ↻ Replay lab
            </button>
            <button type="button" className="btn btn-ghost" onClick={() => navigate(`/e/${id}/settings`)}>
              ⚙ Settings
            </button>
          </div>
        </div>

        <div className="stack" style={{ gap: 6 }}>
          <span className="tiny faint">Send requests to:</span>
          <UrlField url={ingestUrl} />
        </div>

        <div className="grid-cards" style={{ gap: 10 }}>
          <div className="card card-tight stat">
            <span className="stat-value">
              {stats?.storedRequests ?? endpoint.requestCount}
              <span className="small faint"> / {endpoint.maxRequests}</span>
            </span>
            <span className="stat-label">Requests stored</span>
          </div>
          <div className="card card-tight stat">
            <span className="stat-value">{formatBytes(stats?.storedBytes ?? endpoint.totalBytes)}</span>
            <span className="stat-label">Payload storage</span>
          </div>
          <div className="card card-tight stat">
            <span className="stat-value">{stats?.replays ?? 0}</span>
            <span className="stat-label">Replays run</span>
          </div>
          <div className="card card-tight stat">
            <span className="stat-value">{endpoint.lastRequestAt ? formatRelative(endpoint.lastRequestAt) : "—"}</span>
            <span className="stat-label">Last request</span>
          </div>
        </div>
      </div>

      {expired ? (
        <div className="banner banner-warn" role="status">
          <span aria-hidden="true">⏱</span>
          <div>
            <strong>This endpoint has expired.</strong> It no longer accepts requests and its stored requests are being
            swept. Create a new endpoint to keep testing.
          </div>
        </div>
      ) : null}

      <TestRequestPanel id={id} onSent={() => void loadRequests(true)} token={session?.token || ""} />

      <div className="card stack" style={{ gap: 12 }}>
        <div className="row" style={{ justifyContent: "space-between", gap: 10 }}>
          <div>
            <h2 className="card-title">Inbox</h2>
            <p className="card-hint">
              {requests.length} shown{live ? " · live polling every 3s" : " · polling paused"}
            </p>
          </div>
          <div className="row" style={{ gap: 6 }}>
            <button
              type="button"
              className={`btn btn-sm ${live ? "btn-primary" : "btn-ghost"}`}
              onClick={() => setLive((v) => !v)}
              aria-pressed={live}
            >
              <span className={`pulse-dot`} style={{ background: live ? "#052e1b" : "#475569", animation: live ? undefined : "none" }} aria-hidden="true" />
              {live ? "Live" : "Paused"}
            </button>
            <button type="button" className="btn btn-sm btn-ghost" onClick={() => void loadRequests(false)} disabled={listLoading}>
              {listLoading ? <span className="spin" aria-hidden="true" /> : "⟳"} Refresh
            </button>
          </div>
        </div>

        <div className="row" style={{ gap: 8 }}>
          <input
            type="search"
            placeholder="Search path, body or user-agent…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ flex: "2 1 220px" }}
            aria-label="Search requests"
          />
          <select value={method} onChange={(e) => setMethod(e.target.value)} style={{ flex: "1 1 120px" }} aria-label="Filter by method">
            {METHODS.map((m) => (
              <option key={m || "all"} value={m}>
                {m || "All methods"}
              </option>
            ))}
          </select>
          <select value={origin} onChange={(e) => setOrigin(e.target.value)} style={{ flex: "1 1 140px" }} aria-label="Filter by origin">
            <option value="">All origins</option>
            <option value="captured">Real requests</option>
            <option value="synthetic">Test requests</option>
          </select>
        </div>

        {listError ? <ErrorBanner message={listError} onRetry={() => void loadRequests()} /> : null}

        {requests.length === 0 && !listLoading ? (
          <EmptyState
            icon="⇥"
            title={search || method || origin ? "No requests match these filters" : "Waiting for the first request"}
            hint={
              search || method || origin
                ? "Clear the search box or filters to see everything this endpoint captured."
                : "Point your provider's webhook at the URL above, or use the test request panel to send one now."
            }
            action={
              search || method || origin ? (
                <button
                  type="button"
                  className="btn btn-sm btn-ghost"
                  onClick={() => {
                    setSearch("");
                    setMethod("");
                    setOrigin("");
                  }}
                >
                  Clear filters
                </button>
              ) : null
            }
          />
        ) : (
          <div className="inbox">
            {requests.map((r) => (
              <button
                type="button"
                key={r.id}
                className="inbox-row"
                onClick={() => navigate(`/e/${id}/r/${r.id}`)}
                aria-label={`Request ${r.seq}, ${r.method} ${r.path}`}
              >
                <MethodChip method={r.method} />
                <div className="inbox-path">
                  <span className="path">{r.path}</span>
                  <span className="preview">
                    {r.bodyPreview ? r.bodyPreview.slice(0, 120) : r.kind === "empty" ? "(empty body)" : "(binary body)"}
                  </span>
                </div>
                <div className="inbox-meta">
                  <span>#{r.seq}</span>
                  <span>{formatBytes(r.bodySize)}</span>
                </div>
                <div className="inbox-right">
                  <OriginChip origin={r.origin} />
                  <span className="tiny faint">{formatTime(r.receivedAt)}</span>
                </div>
              </button>
            ))}
          </div>
        )}

        <div className="row tiny faint" style={{ justifyContent: "space-between" }}>
          <span>{lastSync ? `Last sync ${formatTime(lastSync)}` : "Not synced yet"}</span>
          <span>{newCount > 0 ? `${newCount} recent` : ""}</span>
        </div>
      </div>
    </div>
  );
}

function TestRequestPanel({ id, token, onSent }: { id: string; token: string; onSent: () => void }) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [method, setMethod] = useState("POST");
  const [contentType, setContentType] = useState("application/json");
  const [body, setBody] = useState('{\n  "event": "hooklab.test",\n  "amount": 4999\n}');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  async function send() {
    setBusy(true);
    setResult(null);
    try {
      const res = await api.sendTestRequest(id, token, { method, contentType, body });
      setResult(`Test request #${res.request.seq} stored — marked as “test request”, never as a real capture.`);
      toast("Test request stored.", "success");
      onSent();
    } catch (err) {
      const message = err instanceof ApiError ? err.message : "Test request failed.";
      setResult(null);
      toast(message, "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card stack" style={{ gap: 10 }}>
      <button
        type="button"
        className="collapse-head"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        style={{ border: "none", background: "transparent", padding: 0 }}
      >
        <span aria-hidden="true" style={{ width: 12, display: "inline-block" }}>
          {open ? "▾" : "▸"}
        </span>
        <span>Send a test request</span>
        <span className="tiny faint" style={{ fontWeight: 500 }}>
          platform-generated · labelled separately from real traffic
        </span>
      </button>

      {open ? (
        <div className="stack" style={{ gap: 10 }}>
          <div className="row" style={{ gap: 10 }}>
            <label className="field" style={{ flex: "1 1 110px" }}>
              Method
              <select value={method} onChange={(e) => setMethod(e.target.value)}>
                {["GET", "POST", "PUT", "PATCH", "DELETE"].map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            </label>
            <label className="field" style={{ flex: "2 1 190px" }}>
              Content-Type
              <select value={contentType} onChange={(e) => setContentType(e.target.value)}>
                <option value="application/json">application/json</option>
                <option value="application/x-www-form-urlencoded">application/x-www-form-urlencoded</option>
                <option value="text/plain">text/plain</option>
                <option value="application/octet-stream">application/octet-stream</option>
              </select>
            </label>
          </div>
          <label className="field">
            Body
            <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={5} spellCheck={false} />
          </label>
          <div className="row">
            <button type="button" className="btn btn-primary btn-sm" onClick={send} disabled={busy}>
              {busy ? <span className="spin" aria-hidden="true" /> : "➤"} Send to endpoint
            </button>
            {result ? <span className="tiny" style={{ color: "var(--ok)" }}>{result}</span> : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
