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
import { useI18n } from "../i18n";

const METHODS = ["", "GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"] as const;

export default function EndpointPage({ id }: { id: string }) {
  const { t, locale, errorMessage } = useI18n();
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
        setListError(errorMessage(err));
      } finally {
        setListLoading(false);
      }
    },
    [session, id, errorMessage],
  );

  useEffect(() => {
    void loadRequests();
  }, [loadRequests]);

  // Debounced re-query when filters change.
  useEffect(() => {
    const timer = window.setTimeout(() => void loadRequests(true), 260);
    return () => window.clearTimeout(timer);
  }, [search, method, origin, loadRequests]);

  usePolling(() => void loadRequests(true), 3000, live && !!session);

  useEffect(() => {
    if (!requests.length) return;
    const maxSeq = Math.max(...requests.map((r) => r.seq));
    setNewCount(requests.filter((r) => r.seq > maxSeq - 0 && r.receivedAt > Date.now() - 4000).length);
  }, [requests]);

  const baseUrl = useMemo(() => (typeof window === "undefined" ? "" : window.location.origin), []);
  const ingestUrl = endpoint ? `${baseUrl}${endpoint.ingestPath}` : session ? session.ingestUrl : "";
  const hasFilters = Boolean(search || method || origin);

  if (loading) {
    return (
      <div className="container">
        <Loading label={t("endpoint.opening")} />
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
          <h1 className="endpoint-title">{t("endpoint.unavailable")}</h1>
          <ErrorBanner
            message={error.status === 401 ? t("endpoint.tokenInvalid") : errorMessage(error)}
            onRetry={() => void refresh()}
          />
          <div className="row">
            <Link to="/" className="btn btn-ghost">
              {t("endpoint.backHome")}
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
          <EmptyState title={t("endpoint.nothing")} hint={t("endpoint.nothingHint")} />
        </div>
      </div>
    );
  }

  const expired = endpoint.status === "expired" || endpoint.expiresAt <= Date.now();
  const statusLabel = expired
    ? t("endpoint.status.expired")
    : endpoint.status === "paused"
      ? t("endpoint.status.paused")
      : t("endpoint.status.active");

  return (
    <div className="container stack" style={{ gap: 16 }}>
      <div className="card stack" style={{ gap: 14 }}>
        <div className="endpoint-head">
          <div style={{ flex: "1 1 320px", minWidth: 0 }}>
            <div className="row" style={{ gap: 8, marginBottom: 4 }}>
              <span className={`chip ${expired ? "tone-bad" : endpoint.status === "paused" ? "tone-warn" : "chip-captured"}`}>
                {statusLabel}
              </span>
              <span className="chip chip-mono">{endpoint.tokenHint}</span>
              {endpoint.storeSensitiveHeaders ? <span className="chip tone-warn">{t("endpoint.storeSensitive")}</span> : null}
            </div>
            <h1 className="endpoint-title">{endpoint.name}</h1>
            <p className="small faint" style={{ margin: "4px 0 0" }}>
              {t("endpoint.meta", {
                when: formatRelative(endpoint.expiresAt, locale),
                retention: endpoint.retentionMinutes,
                rate: endpoint.rateLimitPerMinute,
              })}
            </p>
          </div>
          <div className="row" style={{ gap: 8 }}>
            <button type="button" className="btn btn-primary" onClick={() => navigate(`/e/${id}/replay`)}>
              {t("endpoint.replayLab")}
            </button>
            <button type="button" className="btn btn-ghost" onClick={() => navigate(`/e/${id}/settings`)}>
              {t("endpoint.settings")}
            </button>
          </div>
        </div>

        <div className="stack" style={{ gap: 6 }}>
          <span className="tiny faint">{t("endpoint.sendTo")}</span>
          <UrlField url={ingestUrl} />
        </div>

        <div className="grid-cards" style={{ gap: 10 }}>
          <div className="card card-tight stat">
            <span className="stat-value">
              {stats?.storedRequests ?? endpoint.requestCount}
              <span className="small faint"> / {endpoint.maxRequests}</span>
            </span>
            <span className="stat-label">{t("endpoint.stat.requests")}</span>
          </div>
          <div className="card card-tight stat">
            <span className="stat-value">{formatBytes(stats?.storedBytes ?? endpoint.totalBytes)}</span>
            <span className="stat-label">{t("endpoint.stat.storage")}</span>
          </div>
          <div className="card card-tight stat">
            <span className="stat-value">{stats?.replays ?? 0}</span>
            <span className="stat-label">{t("endpoint.stat.replays")}</span>
          </div>
          <div className="card card-tight stat">
            <span className="stat-value">
              {endpoint.lastRequestAt ? formatRelative(endpoint.lastRequestAt, locale) : "—"}
            </span>
            <span className="stat-label">{t("endpoint.stat.last")}</span>
          </div>
        </div>
      </div>

      {expired ? (
        <div className="banner banner-warn" role="status">
          <span aria-hidden="true">⏱</span>
          <div>
            <strong>{t("endpoint.expiredTitle")}</strong> {t("endpoint.expiredBody")}
          </div>
        </div>
      ) : null}

      <TestRequestPanel id={id} onSent={() => void loadRequests(true)} token={session?.token || ""} />

      <div className="card stack" style={{ gap: 12 }}>
        <div className="row" style={{ justifyContent: "space-between", gap: 10 }}>
          <div>
            <h2 className="card-title">{t("endpoint.inbox")}</h2>
            <p className="card-hint">
              {t("endpoint.inboxCount", { count: requests.length })}
              {live ? t("endpoint.inboxLive") : t("endpoint.inboxPaused")}
            </p>
          </div>
          <div className="row" style={{ gap: 6 }}>
            <button
              type="button"
              className={`btn btn-sm ${live ? "btn-primary" : "btn-ghost"}`}
              onClick={() => setLive((v) => !v)}
              aria-pressed={live}
            >
              <span
                className="pulse-dot"
                style={{ background: live ? "#052e1b" : "#475569", animation: live ? undefined : "none" }}
                aria-hidden="true"
              />
              {live ? t("common.pollingLive") : t("common.pollingPaused")}
            </button>
            <button type="button" className="btn btn-sm btn-ghost" onClick={() => void loadRequests(false)} disabled={listLoading}>
              {listLoading ? <span className="spin" aria-hidden="true" /> : "⟳"} {t("common.refresh")}
            </button>
          </div>
        </div>

        <div className="row" style={{ gap: 8 }}>
          <input
            type="search"
            placeholder={t("endpoint.search")}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ flex: "2 1 220px" }}
            aria-label={t("endpoint.searchAria")}
          />
          <select
            value={method}
            onChange={(e) => setMethod(e.target.value)}
            style={{ flex: "1 1 120px" }}
            aria-label={t("endpoint.methodAria")}
          >
            {METHODS.map((m) => (
              <option key={m || "all"} value={m}>
                {m || t("endpoint.allMethods")}
              </option>
            ))}
          </select>
          <select
            value={origin}
            onChange={(e) => setOrigin(e.target.value)}
            style={{ flex: "1 1 140px" }}
            aria-label={t("endpoint.originAria")}
          >
            <option value="">{t("endpoint.allOrigins")}</option>
            <option value="captured">{t("endpoint.originReal")}</option>
            <option value="synthetic">{t("endpoint.originTest")}</option>
          </select>
        </div>

        {listError ? <ErrorBanner message={listError} onRetry={() => void loadRequests()} /> : null}

        {requests.length === 0 && !listLoading ? (
          <EmptyState
            icon="⇥"
            title={hasFilters ? t("endpoint.emptyFiltered") : t("endpoint.emptyInbox")}
            hint={hasFilters ? t("endpoint.emptyFilteredHint") : t("endpoint.emptyInboxHint")}
            action={
              hasFilters ? (
                <button
                  type="button"
                  className="btn btn-sm btn-ghost"
                  onClick={() => {
                    setSearch("");
                    setMethod("");
                    setOrigin("");
                  }}
                >
                  {t("endpoint.clearFilters")}
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
                aria-label={t("endpoint.rowAria", { seq: r.seq, method: r.method, path: r.path })}
              >
                <MethodChip method={r.method} />
                <div className="inbox-path">
                  <span className="path">{r.path}</span>
                  <span className="preview">
                    {r.bodyPreview
                      ? r.bodyPreview.slice(0, 120)
                      : r.kind === "empty"
                        ? t("endpoint.emptyBody")
                        : t("endpoint.binaryBody")}
                  </span>
                </div>
                <div className="inbox-meta">
                  <span>#{r.seq}</span>
                  <span>{formatBytes(r.bodySize)}</span>
                </div>
                <div className="inbox-right">
                  <OriginChip origin={r.origin} />
                  <span className="tiny faint">{formatTime(r.receivedAt, locale)}</span>
                </div>
              </button>
            ))}
          </div>
        )}

        <div className="row tiny faint" style={{ justifyContent: "space-between" }}>
          <span>{lastSync ? t("endpoint.lastSync", { time: formatTime(lastSync, locale) }) : t("endpoint.notSynced")}</span>
          <span>{newCount > 0 ? t("endpoint.recent", { count: newCount }) : ""}</span>
        </div>
      </div>
    </div>
  );
}

function TestRequestPanel({ id, token, onSent }: { id: string; token: string; onSent: () => void }) {
  const toast = useToast();
  const { t, errorMessage } = useI18n();
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
      setResult(t("testReq.sent", { seq: res.request.seq }));
      toast(t("testReq.ok"), "success");
      onSent();
    } catch (err) {
      setResult(null);
      toast(err instanceof ApiError ? errorMessage(err) : t("testReq.failed"), "error");
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
        <span>{t("testReq.toggle")}</span>
        <span className="tiny faint" style={{ fontWeight: 500 }}>
          {t("testReq.subtitle")}
        </span>
      </button>

      {open ? (
        <div className="stack" style={{ gap: 10 }}>
          <div className="row" style={{ gap: 10 }}>
            <label className="field" style={{ flex: "1 1 110px" }}>
              {t("testReq.method")}
              <select value={method} onChange={(e) => setMethod(e.target.value)}>
                {["GET", "POST", "PUT", "PATCH", "DELETE"].map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            </label>
            <label className="field" style={{ flex: "2 1 190px" }}>
              {t("testReq.contentType")}
              <select value={contentType} onChange={(e) => setContentType(e.target.value)}>
                <option value="application/json">application/json</option>
                <option value="application/x-www-form-urlencoded">application/x-www-form-urlencoded</option>
                <option value="text/plain">text/plain</option>
                <option value="application/octet-stream">application/octet-stream</option>
              </select>
            </label>
          </div>
          <label className="field">
            {t("testReq.body")}
            <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={5} spellCheck={false} />
          </label>
          <div className="row">
            <button type="button" className="btn btn-primary btn-sm" onClick={send} disabled={busy}>
              {busy ? <span className="spin" aria-hidden="true" /> : "➤"} {t("testReq.send")}
            </button>
            {result ? (
              <span className="tiny" style={{ color: "var(--ok)" }}>
                {result}
              </span>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
