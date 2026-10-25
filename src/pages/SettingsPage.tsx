import { useState } from "react";
import { api, ApiError } from "../api";
import { useEndpoint } from "../hooks";
import { sessionStore } from "../store";
import { Link, navigate } from "../router";
import { ConfirmModal, CopyButton, ErrorBanner, Loading, useToast } from "../components/ui";
import { TokenGate, UrlField } from "../components/TokenGate";
import { download, formatBytes, formatDateTime, formatRelative } from "../format";
import { useI18n } from "../i18n";

export default function SettingsPage({ id }: { id: string }) {
  const toast = useToast();
  const { t, locale, errorMessage } = useI18n();
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
        <Loading label={t("settings.loading")} />
      </div>
    );
  }

  if (needsToken) return <TokenGate id={id} onSubmit={attachToken} />;

  if (!endpoint || !session) {
    return (
      <div className="container">
        <ErrorBanner message={t("settings.unavailable")} onRetry={() => void refresh()} />
      </div>
    );
  }

  const current = endpoint;
  const currentSession = session;
  const ingestUrl = `${window.location.origin}${current.ingestPath}`;
  const storagePct = stats ? Math.min(100, Math.round((stats.storedBytes / stats.quotaBytes) * 100)) : 0;
  const requestPct = Math.min(100, Math.round((current.requestCount / current.maxRequests) * 100));

  async function rename(e: React.FormEvent) {
    e.preventDefault();
    setSavingName(true);
    try {
      const res = await api.updateEndpoint(currentSession.id, currentSession.token, {
        name: name.trim() || current.name,
      });
      setEndpoint(res.endpoint);
      sessionStore.update(currentSession.id, { name: res.endpoint.name });
      setName("");
      toast(t("settings.renamed"), "success");
    } catch (err) {
      toast(err instanceof ApiError ? errorMessage(err) : t("settings.renameFailed"), "error");
    } finally {
      setSavingName(false);
    }
  }

  async function saveLimits(e: React.FormEvent) {
    e.preventDefault();
    setSavingLimits(true);
    try {
      const patch: Record<string, unknown> = {};
      if (rateLimit !== null) patch.rateLimitPerMinute = rateLimit;
      if (maxRequests !== null) patch.maxRequests = maxRequests;
      const res = await api.updateEndpoint(currentSession.id, currentSession.token, patch);
      setEndpoint(res.endpoint);
      setRateLimit(null);
      setMaxRequests(null);
      toast(t("settings.limitsSaved"), "success");
    } catch (err) {
      toast(err instanceof ApiError ? errorMessage(err) : t("settings.limitsFailed"), "error");
    } finally {
      setSavingLimits(false);
    }
  }

  async function togglePause() {
    setBusyAction(true);
    try {
      const res = await api.updateEndpoint(currentSession.id, currentSession.token, {
        status: current.status === "active" ? "paused" : "active",
      });
      setEndpoint(res.endpoint);
      toast(res.endpoint.status === "paused" ? t("settings.paused") : t("settings.resumed"), "success");
    } catch (err) {
      toast(err instanceof ApiError ? errorMessage(err) : t("settings.statusFailed"), "error");
    } finally {
      setBusyAction(false);
    }
  }

  async function extend(minutes: number) {
    setBusyAction(true);
    try {
      const res = await api.updateEndpoint(currentSession.id, currentSession.token, { extendMinutes: minutes });
      setEndpoint(res.endpoint);
      toast(t("settings.extended", { when: formatDateTime(res.endpoint.expiresAt, locale) }), "success");
    } catch (err) {
      toast(err instanceof ApiError ? errorMessage(err) : t("settings.limitsFailed"), "error");
    } finally {
      setBusyAction(false);
    }
  }

  async function purge() {
    setBusyAction(true);
    try {
      await api.purgeRequests(currentSession.id, currentSession.token);
      toast(t("settings.purged"), "success");
      await refresh();
    } catch (err) {
      toast(err instanceof ApiError ? errorMessage(err) : t("settings.purgeFailed"), "error");
    } finally {
      setBusyAction(false);
      setConfirmPurge(false);
    }
  }

  async function rotate() {
    setBusyAction(true);
    try {
      const res = await api.rotateToken(currentSession.id, currentSession.token);
      sessionStore.update(currentSession.id, { token: res.token });
      setNewToken(res.token);
      toast(t("settings.rotateOk"), "success");
      await refresh();
    } catch (err) {
      toast(err instanceof ApiError ? errorMessage(err) : t("settings.rotateFailed"), "error");
    } finally {
      setBusyAction(false);
      setConfirmRotate(false);
    }
  }

  async function destroy() {
    setBusyAction(true);
    try {
      await api.deleteEndpoint(currentSession.id, currentSession.token);
      sessionStore.remove(currentSession.id);
      toast(t("settings.deleted"), "success");
      navigate("/");
    } catch (err) {
      toast(err instanceof ApiError ? errorMessage(err) : t("settings.deleteFailed"), "error");
      setBusyAction(false);
    } finally {
      setConfirmDelete(false);
    }
  }

  async function exportReport(scope: "summary" | "all") {
    setExporting(true);
    setError(null);
    try {
      const res = await fetch(`/api/endpoints/${currentSession.id}/export?scope=${scope}`, {
        headers: { "x-hooklab-token": currentSession.token },
      });
      if (!res.ok) {
        throw new ApiError(`http_${res.status}`, `Export failed with status ${res.status}.`, res.status);
      }
      const text = await res.text();
      download(`hooklab-report-${current.slug}-${scope}.json`, text);
      toast(t("settings.exportOk"), "success");
    } catch (err) {
      setError(err instanceof ApiError ? errorMessage(err) : t("settings.exportFailed"));
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className="container stack" style={{ gap: 16 }}>
      <div className="row" style={{ gap: 8 }}>
        <Link to={`/e/${id}`} className="btn btn-sm btn-ghost">
          {t("request.back")}
        </Link>
        <span className="faint small">{current.name}</span>
      </div>

      <div className="card stack" style={{ gap: 12 }}>
        <h1 className="endpoint-title">{t("settings.title")}</h1>
        <div className="stack" style={{ gap: 6 }}>
          <span className="tiny faint">{t("settings.ingestUrl")}</span>
          <UrlField url={ingestUrl} />
        </div>
        <div className="stack" style={{ gap: 6 }}>
          <span className="tiny faint">{t("settings.token")}</span>
          <div className="copy-field">
            <code className="code-block">{currentSession.token}</code>
            <CopyButton value={currentSession.token} label={t("settings.copyToken")} />
          </div>
        </div>
        {newToken ? (
          <div className="banner banner-ok">
            <span aria-hidden="true">✓</span>
            <div>
              <strong>{t("settings.newTokenTitle")}</strong> <code className="code-inline">{newToken}</code>{" "}
              {t("settings.newTokenBody")}
            </div>
          </div>
        ) : null}
      </div>

      <div className="grid-cards">
        <div className="card stack card-tight" style={{ gap: 6 }}>
          <span className="stat-label">{t("settings.stat.requests")}</span>
          <span className="stat-value">
            {current.requestCount}
            <span className="small faint"> / {current.maxRequests}</span>
          </span>
          <div className="progress" aria-hidden="true">
            <div style={{ width: `${requestPct}%` }} />
          </div>
        </div>
        <div className="card stack card-tight" style={{ gap: 6 }}>
          <span className="stat-label">{t("settings.stat.storage")}</span>
          <span className="stat-value">
            {formatBytes(stats?.storedBytes ?? current.totalBytes)}
            <span className="small faint"> / {formatBytes(stats?.quotaBytes ?? 4 * 1024 * 1024)}</span>
          </span>
          <div className="progress" aria-hidden="true">
            <div style={{ width: `${storagePct}%` }} />
          </div>
        </div>
        <div className="card stack card-tight" style={{ gap: 6 }}>
          <span className="stat-label">{t("settings.stat.expires")}</span>
          <span className="stat-value" style={{ fontSize: 16 }}>
            {formatRelative(current.expiresAt, locale)}
          </span>
          <span className="tiny faint">{formatDateTime(current.expiresAt, locale)}</span>
        </div>
        <div className="card stack card-tight" style={{ gap: 6 }}>
          <span className="stat-label">{t("settings.stat.retention")}</span>
          <span className="stat-value" style={{ fontSize: 16 }}>
            {current.retentionMinutes}
          </span>
          <span className="tiny faint">
            {limits ? `${t("settings.max", { value: limits.maxRetentionMinutes })} · ` : ""}
            {t("settings.rowsSwept")}
          </span>
        </div>
      </div>

      <div className="card stack" style={{ gap: 12 }}>
        <h2 className="card-title">{t("settings.rename")}</h2>
        <form className="row" style={{ gap: 8, alignItems: "flex-end" }} onSubmit={rename}>
          <label className="field" style={{ flex: "1 1 220px" }}>
            {t("settings.displayName")}
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={current.name}
              maxLength={60}
            />
          </label>
          <button type="submit" className="btn" disabled={savingName || !name.trim()}>
            {savingName ? <span className="spin" aria-hidden="true" /> : null} {t("settings.saveName")}
          </button>
        </form>
      </div>

      <div className="card stack" style={{ gap: 12 }}>
        <h2 className="card-title">{t("settings.limits")}</h2>
        <form className="row" style={{ gap: 8, alignItems: "flex-end" }} onSubmit={saveLimits}>
          <label className="field" style={{ flex: "1 1 180px" }}>
            {t("settings.rateLimit")}
            <input
              type="number"
              min={1}
              max={300}
              value={rateLimit ?? current.rateLimitPerMinute}
              onChange={(e) => setRateLimit(Number(e.target.value))}
            />
          </label>
          <label className="field" style={{ flex: "1 1 180px" }}>
            {t("settings.maxRequests")}
            <input
              type="number"
              min={1}
              max={limits?.maxRequestsPerEndpoint ?? 500}
              value={maxRequests ?? current.maxRequests}
              onChange={(e) => setMaxRequests(Number(e.target.value))}
            />
          </label>
          <button type="submit" className="btn" disabled={savingLimits || (rateLimit === null && maxRequests === null)}>
            {savingLimits ? <span className="spin" aria-hidden="true" /> : null} {t("settings.saveLimits")}
          </button>
        </form>
        <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
          <button type="button" className="btn btn-sm btn-ghost" onClick={() => void extend(60)} disabled={busyAction}>
            {t("settings.extend1h")}
          </button>
          <button type="button" className="btn btn-sm btn-ghost" onClick={() => void extend(1440)} disabled={busyAction}>
            {t("settings.extend1d")}
          </button>
          <button type="button" className="btn btn-sm btn-ghost" onClick={() => void togglePause()} disabled={busyAction}>
            {current.status === "active" ? t("settings.pause") : t("settings.resume")}
          </button>
        </div>
        <p className="tiny faint" style={{ margin: 0 }}>
          {t("settings.limitsNote")}
        </p>
      </div>

      <div className="card stack" style={{ gap: 12 }}>
        <h2 className="card-title">{t("settings.dataControls")}</h2>
        <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
          <button type="button" className="btn btn-sm" onClick={() => void exportReport("summary")} disabled={exporting}>
            {exporting ? <span className="spin" aria-hidden="true" /> : "⤓"} {t("settings.exportSummary")}
          </button>
          <button type="button" className="btn btn-sm btn-ghost" onClick={() => void exportReport("all")} disabled={exporting}>
            ⤓ {t("settings.exportAll")}
          </button>
          <button type="button" className="btn btn-sm btn-danger" onClick={() => setConfirmPurge(true)}>
            🗑 {t("settings.purge")}
          </button>
        </div>
        {error ? <ErrorBanner message={error} /> : null}
        <p className="tiny faint" style={{ margin: 0 }}>
          {t("settings.exportNote")}
        </p>
      </div>

      <div className="card stack" style={{ gap: 12 }}>
        <h2 className="card-title">{t("settings.danger")}</h2>
        <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
          <button type="button" className="btn btn-sm btn-ghost" onClick={() => setConfirmRotate(true)}>
            {t("settings.rotate")}
          </button>
          <button type="button" className="btn btn-sm btn-danger" onClick={() => setConfirmDelete(true)}>
            {t("settings.deleteEndpoint")}
          </button>
        </div>
        <p className="tiny faint" style={{ margin: 0 }}>
          {t("settings.dangerNote")}
        </p>
      </div>

      <ConfirmModal
        open={confirmPurge}
        title={t("settings.purgeTitle")}
        body={t("settings.purgeBody")}
        confirmLabel={t("settings.purgeConfirm")}
        danger
        busy={busyAction}
        onCancel={() => setConfirmPurge(false)}
        onConfirm={() => void purge()}
      />
      <ConfirmModal
        open={confirmRotate}
        title={t("settings.rotateTitle")}
        body={t("settings.rotateBody")}
        confirmLabel={t("settings.rotateConfirm")}
        busy={busyAction}
        onCancel={() => setConfirmRotate(false)}
        onConfirm={() => void rotate()}
      />
      <ConfirmModal
        open={confirmDelete}
        title={t("settings.deleteTitle")}
        body={t("settings.deleteBody")}
        confirmLabel={t("settings.deleteConfirm")}
        danger
        busy={busyAction}
        onCancel={() => setConfirmDelete(false)}
        onConfirm={() => void destroy()}
      />
    </div>
  );
}
