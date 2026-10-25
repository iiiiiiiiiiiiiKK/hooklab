import { useCallback, useEffect, useMemo, useState } from "react";
import { api, ApiError, type ReplayResult, type ReplaySummary, type RequestSummary } from "../api";
import { useEndpoint } from "../hooks";
import { Link, navigate } from "../router";
import {
  CopyButton,
  EmptyState,
  ErrorBanner,
  Loading,
  MethodChip,
  StatusChip,
  useToast,
} from "../components/ui";
import { TokenGate } from "../components/TokenGate";
import { formatBytes, formatDateTime, formatDuration, formatRelative, prettyJson } from "../format";
import { useI18n } from "../i18n";

export default function ReplayPage({ id, requestId }: { id: string; requestId?: string }) {
  const toast = useToast();
  const { t, locale, errorMessage } = useI18n();
  const { session, endpoint, loading, needsToken, attachToken } = useEndpoint(id);
  const [requests, setRequests] = useState<RequestSummary[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(requestId ?? null);
  const [targetUrl, setTargetUrl] = useState("");
  const [method, setMethod] = useState<string>("");
  const [headerOverride, setHeaderOverride] = useState("");
  const [includeBody, setIncludeBody] = useState(true);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ReplayResult | null>(null);
  const [error, setError] = useState<{ message: string; code?: string } | null>(null);
  const [history, setHistory] = useState<ReplaySummary[]>([]);
  const [loadingList, setLoadingList] = useState(true);

  const load = useCallback(async () => {
    if (!session) return;
    setLoadingList(true);
    try {
      const [reqRes, repRes] = await Promise.all([
        api.listRequests(session.id, session.token, { limit: 100 }),
        api.listReplays(session.id, session.token),
      ]);
      setRequests(reqRes.requests);
      setHistory(repRes.replays);
      setSelectedId((current) => current ?? reqRes.requests[0]?.id ?? null);
    } catch (err) {
      setError({ message: errorMessage(err) });
    } finally {
      setLoadingList(false);
    }
  }, [session, errorMessage]);

  useEffect(() => {
    void load();
  }, [load]);

  const selected = useMemo(() => requests.find((r) => r.id === selectedId) ?? null, [requests, selectedId]);

  useEffect(() => {
    if (selected && !method) setMethod(selected.method);
  }, [selected, method]);

  useEffect(() => {
    if (requestId && requestId !== selectedId) setSelectedId(requestId);
  }, [requestId, selectedId]);

  async function runReplay(e: React.FormEvent) {
    e.preventDefault();
    if (!session) return;
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const headers: [string, string][] = headerOverride
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => {
          const idx = line.indexOf(":");
          if (idx === -1) return null;
          return [line.slice(0, idx).trim(), line.slice(idx + 1).trim()] as [string, string];
        })
        .filter((h): h is [string, string] => !!h && !!h[0]);

      const res = await api.replay(session.id, session.token, {
        targetUrl: targetUrl.trim(),
        requestId: selectedId ?? undefined,
        method: method || selected?.method,
        headers,
        includeBody,
      });
      setResult(res.replay);
      toast(t("replay.sentToast", { status: res.replay.statusCode }), res.replay.ok ? "success" : "info");
      void load();
    } catch (err) {
      if (err instanceof ApiError) {
        setError({ message: errorMessage(err), code: err.code });
        toast(errorMessage(err), "error");
      } else {
        setError({ message: t("replay.failedToast") });
      }
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return (
      <div className="container">
        <Loading label={t("replay.opening")} />
      </div>
    );
  }

  if (needsToken) return <TokenGate id={id} onSubmit={attachToken} />;

  return (
    <div className="container stack" style={{ gap: 16 }}>
      <div className="row" style={{ gap: 8 }}>
        <Link to={`/e/${id}`} className="btn btn-sm btn-ghost">
          {t("request.back")}
        </Link>
        <span className="faint small">{endpoint?.name}</span>
      </div>

      <div className="card stack" style={{ gap: 6 }}>
        <h1 className="endpoint-title">{t("replay.title")}</h1>
        <p className="muted small" style={{ margin: 0 }}>
          {t("replay.intro")}
        </p>
      </div>

      <div className="replay-grid">
        <form className="card stack" style={{ gap: 12 }} onSubmit={runReplay}>
          <div className="stack" style={{ gap: 6 }}>
            <span className="section-title" style={{ margin: 0 }}>
              {t("replay.source")}
            </span>
            {loadingList ? (
              <Loading label={t("replay.loadingRequests")} />
            ) : requests.length === 0 ? (
              <EmptyState
                icon="∅"
                title={t("replay.noRequests")}
                hint={t("replay.noRequestsHint")}
                action={
                  <Link to={`/e/${id}`} className="btn btn-sm">
                    {t("replay.goInbox")}
                  </Link>
                }
              />
            ) : (
              <div className="stack" style={{ gap: 6, maxHeight: 300, overflowY: "auto" }}>
                {requests.map((r) => (
                  <button
                    type="button"
                    key={r.id}
                    onClick={() => {
                      setSelectedId(r.id);
                      setMethod(r.method);
                      navigate(`/e/${id}/replay/${r.id}`, true);
                    }}
                    className="inbox-row"
                    style={{
                      border: "1px solid var(--border)",
                      borderRadius: 10,
                      borderLeftWidth: 2,
                      gridTemplateColumns: "70px minmax(0,1fr)",
                      borderLeftColor: selectedId === r.id ? "var(--accent)" : "transparent",
                      background: selectedId === r.id ? "rgba(139,92,246,0.16)" : "transparent",
                    }}
                  >
                    <MethodChip method={r.method} />
                    <div className="inbox-path">
                      <span className="path">
                        #{r.seq} {r.path}
                      </span>
                      <span className="preview">
                        {formatBytes(r.bodySize)} · {formatRelative(r.receivedAt, locale)}
                      </span>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>

          <label className="field">
            {t("replay.target")}
            <input
              type="url"
              value={targetUrl}
              onChange={(e) => setTargetUrl(e.target.value)}
              placeholder={t("replay.targetPlaceholder")}
              spellCheck={false}
              autoComplete="off"
              required
            />
          </label>

          <div className="row" style={{ gap: 10 }}>
            <label className="field" style={{ flex: "1 1 110px" }}>
              {t("replay.method")}
              <select value={method} onChange={(e) => setMethod(e.target.value)}>
                {["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"].map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            </label>
            <label className="checkline" style={{ flex: "1 1 160px", marginTop: 20 }}>
              <input type="checkbox" checked={includeBody} onChange={(e) => setIncludeBody(e.target.checked)} />
              {t("replay.includeBody")}
            </label>
          </div>

          <label className="field">
            {t("replay.extraHeaders")}
            <textarea
              value={headerOverride}
              onChange={(e) => setHeaderOverride(e.target.value)}
              rows={3}
              placeholder={t("replay.extraHeadersPlaceholder")}
              spellCheck={false}
            />
          </label>

          <div className="row">
            <button type="submit" className="btn btn-primary" disabled={busy || !targetUrl.trim()}>
              {busy ? <span className="spin" aria-hidden="true" /> : "↻"}{" "}
              {busy ? t("replay.sending") : t("replay.send")}
            </button>
            <span className="tiny faint">{t("replay.limits")}</span>
          </div>

          <div className="banner" style={{ fontSize: 12.4 }}>
            <span aria-hidden="true">🛡</span>
            <div>{t("replay.guardNote")}</div>
          </div>
        </form>

        <div className="stack" style={{ gap: 16 }}>
          <div className="card stack" style={{ gap: 10 }}>
            <div className="row" style={{ justifyContent: "space-between" }}>
              <h2 className="card-title" style={{ margin: 0 }}>
                {t("replay.result")}
              </h2>
              {result ? <CopyButton value={JSON.stringify(result, null, 2)} label={t("request.copyJson")} /> : null}
            </div>

            {error ? (
              <ErrorBanner message={error.code ? `${error.message} (${error.code})` : error.message} />
            ) : !result ? (
              <p className="small faint" style={{ margin: 0 }}>
                {t("replay.noResult")}
              </p>
            ) : (
              <div className="stack" style={{ gap: 10 }}>
                <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
                  <StatusChip code={result.statusCode} />
                  <span className="chip chip-mono">{formatDuration(result.durationMs)}</span>
                  <span className="chip">{t("replay.received", { size: formatBytes(result.bytes) })}</span>
                  {result.truncated ? <span className="chip tone-warn">{t("replay.truncated")}</span> : null}
                  {result.dnsRebindingSuspected ? (
                    <span className="chip tone-bad">{t("replay.rebinding")}</span>
                  ) : null}
                </div>
                <div className="kv">
                  <div>{t("replay.kvTarget")}</div>
                  <div className="mono">{result.targetUrl}</div>
                  <div>{t("replay.kvFinal")}</div>
                  <div className="mono">{result.finalUrl}</div>
                  <div>{t("replay.kvHops")}</div>
                  <div className="mono">{result.hops.length}</div>
                </div>
                {result.hops.length > 1 ? (
                  <div className="stack" style={{ gap: 4 }}>
                    <span className="tiny faint">{t("replay.redirectChain")}</span>
                    <pre className="code-block wrap">{result.hops.map((h, i) => `${i + 1}. ${h}`).join("\n")}</pre>
                  </div>
                ) : null}
                <div className="stack" style={{ gap: 4 }}>
                  <span className="tiny faint">{t("replay.respHeaders")}</span>
                  <pre className="code-block wrap" style={{ maxHeight: 160 }}>
                    {result.responseHeaders.map(([k, v]) => `${k}: ${v}`).join("\n") || t("replay.none")}
                  </pre>
                </div>
                <div className="stack" style={{ gap: 4 }}>
                  <div className="row" style={{ justifyContent: "space-between" }}>
                    <span className="tiny faint">{t("replay.bodyPreview")}</span>
                    <CopyButton value={result.bodyPreview} label={t("common.copy")} />
                  </div>
                  <pre className="code-block wrap">
                    {(() => {
                      const pretty = prettyJson(result.bodyPreview);
                      return pretty.ok ? pretty.text : result.bodyPreview || t("replay.emptyResponse");
                    })()}
                  </pre>
                </div>
              </div>
            )}
          </div>

          <div className="card stack" style={{ gap: 8 }}>
            <div className="row" style={{ justifyContent: "space-between" }}>
              <h2 className="card-title" style={{ margin: 0 }}>
                {t("replay.history")}
              </h2>
              <button type="button" className="btn btn-sm btn-ghost" onClick={() => void load()}>
                ⟳ {t("common.refresh")}
              </button>
            </div>
            {history.length === 0 ? (
              <p className="small faint" style={{ margin: 0 }}>
                {t("replay.noHistory")}
              </p>
            ) : (
              <div className="stack" style={{ gap: 6 }}>
                {history.map((h) => (
                  <div key={h.id} className="row" style={{ justifyContent: "space-between", gap: 8, fontSize: 12.6 }}>
                    <span
                      className="mono"
                      style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: "55%" }}
                    >
                      {h.method} {h.targetHost ?? h.targetUrl}
                    </span>
                    <span className="row-tight">
                      <StatusChip code={h.statusCode} />
                      <span className="faint">{formatDuration(h.durationMs)}</span>
                      <span className="faint tiny">{formatDateTime(h.createdAt, locale)}</span>
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
