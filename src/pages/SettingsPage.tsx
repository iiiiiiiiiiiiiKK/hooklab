import { useState } from "react";
import { api, ApiError } from "../api";
import { useEndpoint } from "../hooks";
import { sessionStore } from "../store";
import { Link, navigate } from "../router";
import {
  ConfirmModal,
  CopyButton,
  ErrorBanner,
  Loading,
  useToast,
} from "../components/ui";
import { TokenGate, UrlField } from "../components/TokenGate";
import { download, formatBytes, formatDateTime, formatRelative } from "../format";

export default function SettingsPage({ id }: { id: string }) {
  const toast = useToast();
  const { session, endpoint, limits, stats, loading, needsToken, attachToken, refresh, setEndpoint } = useEndpoint(id);
  const [name, setName] = useState("");
  const [savingName, setSavingName] = useState(false);
  const [rateLimit, setRateLimit] = useState<number | null>(null);
  const [maxRequests, setMaxRequests] = useState<number | null>(null);
  const [savingLimits, setSavingLimits] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmPurge, setConfirmPurge] = useState(false);
  const [confirmRotate, setConfirmRotate] = useState(false);
  const [busyAction, setBusyAction] = useState(false);
  const [newToken, setNewToken] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);

  if (loading) {
    return (
      <div className="container">
        <Loading label="Loading settings…" />
      </div>
    );
  }

  if (needsToken) return <TokenGate id={id} onSubmit={attachToken} />;

  if (!endpoint || !session) {
    return (
      <div className="container">
        <ErrorBanner message="Endpoint could not be loaded." onRetry={() => void refresh()} />
      </div>
    );
  }

  const ingestUrl = `${window.location.origin}${endpoint.ingestPath}`;
  const storagePct = stats ? Math.min(100, Math.round((stats.storedBytes / stats.quotaBytes) * 100)) : 0;
  const requestPct = Math.min(100, Math.round((endpoint.requestCount / endpoint.maxRequests) * 100));

  async function rename(e: React.FormEvent) {
    e.preventDefault();
    if (!session) return;
    setSavingName(true);
    try {
      const res = await api.updateEndpoint(session.id, session.token, { name: name.trim() || endpoint!.name });
      setEndpoint(res.endpoint);
      sessionStore.update(session.id, { name: res.endpoint.name });
      setName("");
      toast("Endpoint renamed.", "success");
    } catch (err) {
      toast(err instanceof ApiError ? err.message : "Rename failed.", "error");
    } finally {
      setSavingName(false);
    }
  }

  async function saveLimits(e: React.FormEvent) {
    e.preventDefault();
    if (!session) return;
    setSavingLimits(true);
    try {
      const patch: Record<string, unknown> = {};
      if (rateLimit !== null) patch.rateLimitPerMinute = rateLimit;
      if (maxRequests !== null) patch.maxRequests = maxRequests;
      const res = await api.updateEndpoint(session.id, session.token, patch);
      setEndpoint(res.endpoint);
      setRateLimit(null);
      setMaxRequests(null);
      toast("Limits updated.", "success");
    } catch (err) {
      toast(err instanceof ApiError ? err.message : "Update failed.", "error");
    } finally {
      setSavingLimits(false);
    }
  }

  async function togglePause() {
    if (!session || !endpoint) return;
    setBusyAction(true);
    try {
      const res = await api.updateEndpoint(session.id, session.token, {
        status: endpoint.status === "active" ? "paused" : "active",
      });
      setEndpoint(res.endpoint);
      toast(res.endpoint.status === "paused" ? "Endpoint paused." : "Endpoint resumed.", "success");
    } catch (err) {
      toast(err instanceof ApiError ? err.message : "Could not change status.", "error");
    } finally {
      setBusyAction(false);
    }
  }

  async function extend(minutes: number) {
    if (!session) return;
    setBusyAction(true);
    try {
      const res = await api.updateEndpoint(session.id, session.token, { extendMinutes: minutes });
      setEndpoint(res.endpoint);
      toast(`Extended until ${formatDateTime(res.endpoint.expiresAt)}.`, "success");
    } catch (err) {
      toast(err instanceof ApiError ? err.message : "Could not extend TTL.", "error");
    } finally {
      setBusyAction(false);
    }
  }

  async function purge() {
    if (!session) return;
    setBusyAction(true);
    try {
      await api.purgeRequests(session.id, session.token);
      toast("All captured requests deleted.", "success");
      await refresh();
    } catch (err) {
      toast(err instanceof ApiError ? err.message : "Purge failed.", "error");
    } finally {
      setBusyAction(false);
      setConfirmPurge(false);
    }
  }

  async function rotate() {
    if (!session) return;
    setBusyAction(true);
    try {
      const res = await api.rotateToken(session.id, session.token);
      sessionStore.update(session.id, { token: res.token });
      setNewToken(res.token);
      toast("Token rotated — the old token stopped working immediately.", "success");
      await refresh();
    } catch (err) {
      toast(err instanceof ApiError ? err.message : "Rotation failed.", "error");
    } finally {
      setBusyAction(false);
      setConfirmRotate(false);
    }
  }

  async function destroy() {
    if (!session) return;
    setBusyAction(true);
    try {
      await api.deleteEndpoint(session.id, session.token);
      sessionStore.remove(session.id);
      toast("Endpoint and all stored requests deleted.", "success");
      navigate("/");
    } catch (err) {
      toast(err instanceof ApiError ? err.message : "Delete failed.", "error");
      setBusyAction(false);
    } finally {
      setConfirmDelete(false);
    }
  }

  async function exportReport(scope: "summary" | "all") {
    if (!session) return;
    setExporting(true);
    setError(null);
    try {
      const res = await fetch(`/api/endpoints/${session.id}/export?scope=${scope}`, {
        headers: { "x-hooklab-token": session.token },
      });
      if (!res.ok) {
        throw new ApiError(`http_${res.status}`, `Export failed with status ${res.status}.`, res.status);
      }
      const text = await res.text();
      download(`hooklab-report-${endpoint!.slug}-${scope}.json`, text);
      toast("Report downloaded (sensitive headers already redacted).", "success");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Export failed.");
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className="container stack" style={{ gap: 16 }}>
      <div className="row" style={{ gap: 8 }}>
        <Link to={`/e/${id}`} className="btn btn-sm btn-ghost">
          ← Inbox
        </Link>
        <span className="faint small">{endpoint.name}</span>
      </div>

      <div className="card stack" style={{ gap: 12 }}>
        <h1 className="endpoint-title">Endpoint settings</h1>
        <div className="stack" style={{ gap: 6 }}>
          <span className="tiny faint">Ingest URL</span>
          <UrlField url={ingestUrl} />
        </div>
        <div className="stack" style={{ gap: 6 }}>
          <span className="tiny faint">Access token (stored in this browser only)</span>
          <div className="copy-field">
            <code className="code-block">{session.token}</code>
            <CopyButton value={session.token} label="Copy token" />
          </div>
        </div>
        {newToken ? (
          <div className="banner banner-ok">
            <span aria-hidden="true">✓</span>
            <div>
              <strong>New token:</strong> <code className="code-inline">{newToken}</code> — copy it now. It has replaced
              the previous token and is already saved in this browser.
            </div>
          </div>
        ) : null}
      </div>

      <div className="grid-cards">
        <div className="card stack card-tight" style={{ gap: 6 }}>
          <span className="stat-label">Requests</span>
          <span className="stat-value">
            {endpoint.requestCount}
            <span className="small faint"> / {endpoint.maxRequests}</span>
          </span>
          <div className="progress" aria-hidden="true">
            <div style={{ width: `${requestPct}%` }} />
          </div>
        </div>
        <div className="card stack card-tight" style={{ gap: 6 }}>
          <span className="stat-label">Storage</span>
          <span className="stat-value">
            {formatBytes(stats?.storedBytes ?? endpoint.totalBytes)}
            <span className="small faint"> / {formatBytes(stats?.quotaBytes ?? 4 * 1024 * 1024)}</span>
          </span>
          <div className="progress" aria-hidden="true">
            <div style={{ width: `${storagePct}%` }} />
          </div>
        </div>
        <div className="card stack card-tight" style={{ gap: 6 }}>
          <span className="stat-label">Expires</span>
          <span className="stat-value" style={{ fontSize: 16 }}>
            {formatRelative(endpoint.expiresAt)}
          </span>
          <span className="tiny faint">{formatDateTime(endpoint.expiresAt)}</span>
        </div>
        <div className="card stack card-tight" style={{ gap: 6 }}>
          <span className="stat-label">Retention</span>
          <span className="stat-value" style={{ fontSize: 16 }}>
            {endpoint.retentionMinutes} min
          </span>
          <span className="tiny faint">
            {limits ? `max ${limits.maxRetentionMinutes} min` : ""} · rows auto-swept
          </span>
        </div>
      </div>

      <div className="card stack" style={{ gap: 12 }}>
        <h2 className="card-title">Rename</h2>
        <form className="row" style={{ gap: 8, alignItems: "flex-end" }} onSubmit={rename}>
          <label className="field" style={{ flex: "1 1 220px" }}>
            Display name
            <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder={endpoint.name} maxLength={60} />
          </label>
          <button type="submit" className="btn" disabled={savingName || !name.trim()}>
            {savingName ? <span className="spin" aria-hidden="true" /> : null} Save name
          </button>
        </form>
      </div>

      <div className="card stack" style={{ gap: 12 }}>
        <h2 className="card-title">Limits</h2>
        <form className="row" style={{ gap: 8, alignItems: "flex-end" }} onSubmit={saveLimits}>
          <label className="field" style={{ flex: "1 1 180px" }}>
            Ingest rate limit (per minute)
            <input
              type="number"
              min={1}
              max={300}
              value={rateLimit ?? endpoint.rateLimitPerMinute}
              onChange={(e) => setRateLimit(Number(e.target.value))}
            />
          </label>
          <label className="field" style={{ flex: "1 1 180px" }}>
            Max stored requests
            <input
              type="number"
              min={1}
              max={limits?.maxRequestsPerEndpoint ?? 500}
              value={maxRequests ?? endpoint.maxRequests}
              onChange={(e) => setMaxRequests(Number(e.target.value))}
            />
          </label>
          <button type="submit" className="btn" disabled={savingLimits || (rateLimit === null && maxRequests === null)}>
            {savingLimits ? <span className="spin" aria-hidden="true" /> : null} Save limits
          </button>
        </form>
        <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
          <button type="button" className="btn btn-sm btn-ghost" onClick={() => void extend(60)} disabled={busyAction}>
            Extend 1 hour
          </button>
          <button type="button" className="btn btn-sm btn-ghost" onClick={() => void extend(1440)} disabled={busyAction}>
            Extend 1 day
          </button>
          <button type="button" className="btn btn-sm btn-ghost" onClick={() => void togglePause()} disabled={busyAction}>
            {endpoint.status === "active" ? "⏸ Pause endpoint" : "▶ Resume endpoint"}
          </button>
        </div>
        <p className="tiny faint" style={{ margin: 0 }}>
          Pausing blocks new captures (HTTP 409/410 style rejection) without deleting stored requests. Limits are enforced
          server-side — the UI only reflects them.
        </p>
      </div>

      <div className="card stack" style={{ gap: 12 }}>
        <h2 className="card-title">Data controls</h2>
        <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
          <button type="button" className="btn btn-sm" onClick={() => void exportReport("summary")} disabled={exporting}>
            {exporting ? <span className="spin" aria-hidden="true" /> : "⤓"} Export sanitised report
          </button>
          <button type="button" className="btn btn-sm btn-ghost" onClick={() => void exportReport("all")} disabled={exporting}>
            ⤓ Export with bodies
          </button>
          <button type="button" className="btn btn-sm btn-danger" onClick={() => setConfirmPurge(true)}>
            🗑 Delete all requests
          </button>
        </div>
        {error ? <ErrorBanner message={error} /> : null}
        <p className="tiny faint" style={{ margin: 0 }}>
          Exports include every stored request with sensitive headers already replaced by [REDACTED]. Bodies are included
          only in the “with bodies” variant, capped at 64 KB per request.
        </p>
      </div>

      <div className="card stack" style={{ gap: 12 }}>
        <h2 className="card-title">Danger zone</h2>
        <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
          <button type="button" className="btn btn-sm btn-ghost" onClick={() => setConfirmRotate(true)}>
            ⟳ Rotate token
          </button>
          <button type="button" className="btn btn-sm btn-danger" onClick={() => setConfirmDelete(true)}>
            Delete endpoint
          </button>
        </div>
        <p className="tiny faint" style={{ margin: 0 }}>
          Deleting removes the endpoint, every captured request and its replay history. This cannot be undone.
        </p>
      </div>

      <ConfirmModal
        open={confirmPurge}
        title="Delete all captured requests?"
        body="Every stored request for this endpoint is deleted immediately. The endpoint itself stays active."
        confirmLabel="Delete requests"
        danger
        busy={busyAction}
        onCancel={() => setConfirmPurge(false)}
        onConfirm={() => void purge()}
      />
      <ConfirmModal
        open={confirmRotate}
        title="Rotate the access token?"
        body="The current token stops working immediately. Anyone using the old token loses access — including other tabs of this browser until they pick up the new one."
        confirmLabel="Rotate token"
        busy={busyAction}
        onCancel={() => setConfirmRotate(false)}
        onConfirm={() => void rotate()}
      />
      <ConfirmModal
        open={confirmDelete}
        title="Delete this endpoint?"
        body="The endpoint URL, all captured requests and replay history are destroyed. This cannot be undone and the token cannot be recovered."
        confirmLabel="Delete endpoint"
        danger
        busy={busyAction}
        onCancel={() => setConfirmDelete(false)}
        onConfirm={() => void destroy()}
      />
    </div>
  );
}
