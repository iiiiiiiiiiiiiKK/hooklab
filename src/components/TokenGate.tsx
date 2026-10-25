import { useState } from "react";
import { Link } from "../router";
import { CopyButton, ErrorBanner } from "./ui";
import { useI18n } from "../i18n";

export function TokenGate({
  id,
  message,
  onSubmit,
}: {
  id: string;
  message?: string;
  onSubmit: (token: string) => Promise<boolean>;
}) {
  const { t } = useI18n();
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const ok = await onSubmit(token);
    setBusy(false);
    if (!ok) setError(t("gate.rejected"));
  }

  return (
    <div className="container container-narrow">
      <div className="card stack">
        <h1 className="endpoint-title">{t("gate.title")}</h1>
        <p className="muted small" style={{ margin: 0 }}>
          {message ? message : t("gate.body", { id })}
        </p>
        <form onSubmit={submit} className="stack" style={{ gap: 12 }}>
          <label className="field">
            {t("gate.label")}
            <input
              type="text"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder="hl_…"
              autoComplete="off"
              spellCheck={false}
              autoFocus
            />
          </label>
          <div className="row">
            <button type="submit" className="btn btn-primary" disabled={busy || token.trim().length < 8}>
              {busy ? <span className="spin" aria-hidden="true" /> : null}
              {t("gate.unlock")}
            </button>
            <Link to="/" className="btn btn-ghost">
              {t("gate.create")}
            </Link>
          </div>
          {error ? <ErrorBanner message={error} /> : null}
        </form>
        <p className="tiny faint" style={{ margin: 0 }}>
          {t("gate.note")}
        </p>
      </div>
    </div>
  );
}

export function UrlField({ url }: { url: string }) {
  const { t } = useI18n();
  return (
    <div className="copy-field">
      <code className="code-block" aria-label={t("settings.ingestUrl")}>
        {url}
      </code>
      <CopyButton value={url} label={t("common.copy")} testId="copy-url" />
    </div>
  );
}
