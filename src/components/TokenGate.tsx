import { useState } from "react";
import { Link } from "../router";
import { CopyButton, ErrorBanner } from "./ui";

export function TokenGate({
  id,
  message,
  onSubmit,
}: {
  id: string;
  message?: string;
  onSubmit: (token: string) => Promise<boolean>;
}) {
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const ok = await onSubmit(token);
    setBusy(false);
    if (!ok) setError("That token was rejected for this endpoint. Check that you copied the full hl_… string.");
  }

  return (
    <div className="container container-narrow">
      <div className="card stack">
        <h1 className="endpoint-title">Access token required</h1>
        <p className="muted small" style={{ margin: 0 }}>
          {message ||
            `Endpoint ${id} is not stored in this browser. HookLab keeps only a hash of each token on the server, so the token must come from you.`}
        </p>
        <form onSubmit={submit} className="stack" style={{ gap: 12 }}>
          <label className="field">
            Endpoint token
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
              Unlock endpoint
            </button>
            <Link to="/" className="btn btn-ghost">
              Create a new endpoint
            </Link>
          </div>
          {error ? <ErrorBanner message={error} /> : null}
        </form>
        <p className="tiny faint" style={{ margin: 0 }}>
          Tokens are sent only to the HookLab API over HTTPS as an <code className="code-inline">x-hooklab-token</code>{" "}
          header and are stored locally in this browser.
        </p>
      </div>
    </div>
  );
}

export function UrlField({ url }: { url: string }) {
  return (
    <div className="copy-field">
      <code className="code-block" aria-label="Endpoint URL">
        {url}
      </code>
      <CopyButton value={url} label="Copy URL" />
    </div>
  );
}
