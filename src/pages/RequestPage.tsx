import { useCallback, useEffect, useMemo, useState } from "react";
import { api, ApiError, type RequestDetail } from "../api";
import { useEndpoint } from "../hooks";
import { Link, navigate } from "../router";
import {
  ConfirmModal,
  CopyButton,
  EmptyState,
  ErrorBanner,
  Loading,
  MethodChip,
  OriginChip,
  StatusChip,
  useToast,
} from "../components/ui";
import { TokenGate } from "../components/TokenGate";
import { decodeForm, formatBytes, formatDateTime, formatDuration, prettyJson } from "../format";
import { useI18n } from "../i18n";

type BodyView = "pretty" | "raw" | "fields";

export default function RequestPage({ id, requestId }: { id: string; requestId: string }) {
  const toast = useToast();
  const { t, locale, errorMessage } = useI18n();
  const { session, endpoint, loading, needsToken, attachToken } = useEndpoint(id);
  const [detail, setDetail] = useState<RequestDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(true);
  const [bodyView, setBodyView] = useState<BodyView>("pretty");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const load = useCallback(async () => {
    if (!session) return;
    setBusy(true);
    try {
      const res = await api.getRequest(session.id, session.token, requestId);
      setDetail(res.request);
      setError(null);
    } catch (err) {
      setError(
        err instanceof ApiError && err.status === 404 ? t("request.gone") : errorMessage(err),
      );
    } finally {
      setBusy(false);
    }
  }, [session, requestId, t, errorMessage]);

  useEffect(() => {
    void load();
  }, [load]);

  const json = useMemo(() => {
    if (!detail || detail.bodyEncoding !== "utf8" || !detail.bodyText) return null;
    if (detail.kind !== "json") return null;
    return prettyJson(detail.bodyText);
  }, [detail]);

  const formFields = useMemo(() => {
    if (!detail || detail.kind !== "form" || !detail.bodyText) return null;
    return decodeForm(detail.bodyText);
  }, [detail]);

  useEffect(() => {
    if (formFields && formFields.length) setBodyView("fields");
    else if (json && json.ok) setBodyView("pretty");
    else setBodyView("raw");
  }, [formFields, json]);

  async function onDelete() {
    if (!session || !detail) return;
    setDeleting(true);
    try {
      await api.deleteRequest(session.id, session.token, detail.id);
      toast(t("request.deleted"), "success");
      navigate(`/e/${id}`);
    } catch (err) {
      toast(err instanceof ApiError ? errorMessage(err) : t("request.deleteFailed"), "error");
    } finally {
      setDeleting(false);
      setConfirmDelete(false);
    }
  }

  if (loading || (busy && !detail)) {
    return (
      <div className="container">
        <Loading label={t("request.loading")} />
      </div>
    );
  }

  if (needsToken) return <TokenGate id={id} onSubmit={attachToken} />;

  if (error || !detail) {
    return (
      <div className="container">
        <div className="card stack">
          <h1 className="endpoint-title">{t("request.unavailable")}</h1>
          <ErrorBanner message={error || t("request.unavailableHint")} onRetry={() => void load()} />
          <div className="row">
            <Link to={`/e/${id}`} className="btn btn-ghost">
              {t("request.back")}
            </Link>
          </div>
        </div>
      </div>
    );
  }

  const curl = buildCurl(detail, window.location.origin, t("request.curlBinary"));
  const headersText = detail.headers.map(([k, v]) => `${k}: ${v}`).join("\n");
  const bodyForCopy = detail.bodyEncoding === "base64" ? (detail.bodyBase64 ?? "") : (detail.bodyText ?? "");

  return (
    <div className="container stack" style={{ gap: 16 }}>
      <div className="row" style={{ gap: 8 }}>
        <Link to={`/e/${id}`} className="btn btn-sm btn-ghost">
          {t("request.back")}
        </Link>
        <span className="faint small">{endpoint?.name}</span>
      </div>

      <div className="card stack" style={{ gap: 12 }}>
        <div className="row" style={{ justifyContent: "space-between", gap: 10 }}>
          <div style={{ minWidth: 0 }}>
            <div className="row" style={{ gap: 8, marginBottom: 6 }}>
              <MethodChip method={detail.method} />
              <OriginChip origin={detail.origin} />
              <span className="chip chip-mono">#{detail.seq}</span>
              <span className={`chip ${detail.kind === "binary" ? "tone-warn" : ""}`}>{detail.kind}</span>
            </div>
            <h1 className="endpoint-title mono" style={{ fontSize: "clamp(15px,2.6vw,19px)", wordBreak: "break-all" }}>
              {detail.path}
            </h1>
            <p className="small faint" style={{ margin: "6px 0 0" }}>
              {formatDateTime(detail.receivedAt, locale)} · {formatBytes(detail.bodySize)}
              {detail.clientCountry ? ` · ${detail.clientCountry}` : ""}
              {detail.userAgent ? ` · ${detail.userAgent.slice(0, 60)}` : ""}
            </p>
          </div>
          <div className="row" style={{ gap: 6 }}>
            <button
              type="button"
              className="btn btn-sm btn-primary"
              onClick={() => navigate(`/e/${id}/replay/${detail.id}`)}
            >
              {t("request.replay")}
            </button>
            <button type="button" className="btn btn-sm btn-danger" onClick={() => setConfirmDelete(true)}>
              {t("common.delete")}
            </button>
          </div>
        </div>

        {detail.redactedHeaders.length > 0 ? (
          <div className="banner banner-warn" role="status">
            <span aria-hidden="true">🔒</span>
            <div>
              <strong>{t("request.redactedTitle", { count: detail.redactedHeaders.length })}</strong>{" "}
              <code className="code-inline">{detail.redactedHeaders.join(", ")}</code>
              {endpoint?.storeSensitiveHeaders ? t("request.redactedOptIn") : t("request.redactedNever")}
            </div>
          </div>
        ) : null}
      </div>

      <div className="detail-grid">
        <div className="card stack" style={{ gap: 10 }}>
          <div className="row" style={{ justifyContent: "space-between" }}>
            <h2 className="card-title" style={{ margin: 0 }}>
              {t("request.body")}
            </h2>
            <div className="row" style={{ gap: 6 }}>
              {json?.ok ? (
                <button
                  type="button"
                  className={`btn btn-sm ${bodyView === "pretty" ? "btn-primary" : "btn-ghost"}`}
                  onClick={() => setBodyView("pretty")}
                >
                  {t("request.formatted")}
                </button>
              ) : null}
              {formFields ? (
                <button
                  type="button"
                  className={`btn btn-sm ${bodyView === "fields" ? "btn-primary" : "btn-ghost"}`}
                  onClick={() => setBodyView("fields")}
                >
                  {t("request.fields")}
                </button>
              ) : null}
              <button
                type="button"
                className={`btn btn-sm ${bodyView === "raw" ? "btn-primary" : "btn-ghost"}`}
                onClick={() => setBodyView("raw")}
              >
                {t("request.raw")}
              </button>
              <CopyButton value={bodyForCopy} label={t("request.copyBody")} />
            </div>
          </div>

          {detail.kind === "empty" || detail.bodySize === 0 ? (
            <EmptyState icon="∅" title={t("request.emptyTitle")} hint={t("request.emptyHint")} />
          ) : bodyView === "pretty" && json?.ok ? (
            <pre className="code-block">{json.text}</pre>
          ) : bodyView === "fields" && formFields ? (
            <div className="kv">
              {formFields.map(([k, v], i) => (
                <div key={`${k}-${i}`} style={{ display: "contents" }}>
                  <div>{k}</div>
                  <div className="mono">{v || <span className="faint">{t("request.emptyField")}</span>}</div>
                </div>
              ))}
            </div>
          ) : detail.bodyEncoding === "base64" ? (
            <div className="stack" style={{ gap: 8 }}>
              <div className="banner" role="status">
                <span aria-hidden="true">◼</span>
                <div>
                  {t("request.binaryNote")}
                  {detail.bodySha256 ? ` (SHA-256 ${detail.bodySha256.slice(0, 16)}…)` : ""}
                </div>
              </div>
              <pre className="code-block wrap">{detail.bodyBase64}</pre>
            </div>
          ) : (
            <pre className="code-block wrap">{detail.bodyText ?? ""}</pre>
          )}
        </div>

        <div className="stack" style={{ gap: 12 }}>
          <div className="card stack" style={{ gap: 8 }}>
            <div className="row" style={{ justifyContent: "space-between" }}>
              <h2 className="card-title" style={{ margin: 0 }}>
                {t("request.headers")} <span className="faint tiny">({detail.headers.length})</span>
              </h2>
              <CopyButton value={headersText} label={t("request.copyAll")} />
            </div>
            {detail.headers.length === 0 ? (
              <p className="small faint">{t("request.noHeaders")}</p>
            ) : (
              <div className="kv">
                {detail.headers.map(([k, v], i) => (
                  <div key={`${k}-${i}`} style={{ display: "contents" }}>
                    <div>{k}</div>
                    <div className="mono" style={v === "[REDACTED]" ? { color: "var(--warn)" } : undefined}>
                      {v}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="card stack" style={{ gap: 8 }}>
            <div className="row" style={{ justifyContent: "space-between" }}>
              <h2 className="card-title" style={{ margin: 0 }}>
                {t("request.query")} <span className="faint tiny">({detail.query.length})</span>
              </h2>
              {detail.query.length > 0 ? (
                <CopyButton value={JSON.stringify(Object.fromEntries(detail.query), null, 2)} label={t("request.copyJson")} />
              ) : null}
            </div>
            {detail.query.length === 0 ? (
              <p className="small faint">{t("request.noQuery")}</p>
            ) : (
              <div className="kv">
                {detail.query.map(([k, v], i) => (
                  <div key={`${k}-${i}`} style={{ display: "contents" }}>
                    <div>{k}</div>
                    <div className="mono">{v}</div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="card stack" style={{ gap: 8 }}>
            <div className="row" style={{ justifyContent: "space-between" }}>
              <h2 className="card-title" style={{ margin: 0 }}>
                {t("request.curl")}
              </h2>
              <CopyButton value={curl} label={t("request.copyCurl")} />
            </div>
            <pre className="code-block wrap">{curl}</pre>
            <p className="tiny faint" style={{ margin: 0 }}>
              {t("request.curlNote")}
            </p>
          </div>

          {detail.replays.length > 0 ? (
            <div className="card stack" style={{ gap: 8 }}>
              <h2 className="card-title" style={{ margin: 0 }}>
                {t("request.replayHistory")}
              </h2>
              <div className="stack" style={{ gap: 6 }}>
                {detail.replays.map((r) => (
                  <div key={r.id} className="row" style={{ justifyContent: "space-between", gap: 8, fontSize: 12.6 }}>
                    <span className="mono faint">{r.targetHost}</span>
                    <span className="row-tight">
                      <StatusChip code={r.statusCode} />
                      <span className="faint">{formatDuration(r.durationMs)}</span>
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      </div>

      <ConfirmModal
        open={confirmDelete}
        title={t("request.deleteTitle")}
        body={t("request.deleteBody")}
        confirmLabel={t("request.deleteConfirm")}
        danger
        busy={deleting}
        onCancel={() => setConfirmDelete(false)}
        onConfirm={() => void onDelete()}
      />
    </div>
  );
}

function buildCurl(detail: RequestDetail, origin: string, binaryNote: string): string {
  const url = `${origin}${detail.path}${
    detail.query.length
      ? `?${detail.query.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join("&")}`
      : ""
  }`;
  const lines = [`curl -X ${detail.method} '${url}'`];
  for (const [k, v] of detail.headers) {
    const lower = k.toLowerCase();
    if (
      [
        "host",
        "content-length",
        "cf-connecting-ip",
        "cf-ray",
        "cf-ipcountry",
        "cdn-loop",
        "x-forwarded-proto",
        "x-forwarded-for",
        "x-real-ip",
      ].includes(lower)
    )
      continue;
    lines.push(`  -H '${k}: ${String(v).replace(/'/g, "'\\''")}'`);
  }
  if (detail.bodySize > 0 && detail.bodyEncoding === "utf8" && detail.method !== "GET" && detail.method !== "HEAD") {
    lines.push(`  --data-raw '${(detail.bodyText || "").replace(/'/g, "'\\''")}'`);
  } else if (detail.bodyEncoding === "base64") {
    lines.push(`  ${binaryNote}`);
  }
  return lines.join(" \\\n");
}
