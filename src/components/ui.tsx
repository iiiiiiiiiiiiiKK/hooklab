import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { copyText, methodTone, statusTone } from "../format";

/* ------------------------------------------------------------------ toasts */

type ToastKind = "info" | "success" | "error";
interface Toast {
  id: number;
  kind: ToastKind;
  message: string;
}

const ToastCtx = createContext<{ push: (message: string, kind?: ToastKind) => void }>({ push: () => {} });

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const idRef = useRef(0);

  const push = useCallback((message: string, kind: ToastKind = "info") => {
    const id = ++idRef.current;
    setToasts((prev) => [...prev.slice(-3), { id, kind, message }]);
    window.setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, kind === "error" ? 6000 : 3200);
  }, []);

  const value = useMemo(() => ({ push }), [push]);

  return (
    <ToastCtx.Provider value={value}>
      {children}
      <div className="toast-wrap" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.kind}`}>
            <span aria-hidden="true">{t.kind === "error" ? "⚠" : t.kind === "success" ? "✓" : "•"}</span>
            <span>{t.message}</span>
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

export function useToast() {
  return useContext(ToastCtx).push;
}

/* ---------------------------------------------------------------- copy btn */

export function CopyButton({
  value,
  label = "Copy",
  size = "sm",
  title,
}: {
  value: string;
  label?: string;
  size?: "sm" | "md";
  title?: string;
}) {
  const [state, setState] = useState<"idle" | "ok" | "fail">("idle");
  const toast = useToast();

  async function onClick() {
    const ok = await copyText(value);
    setState(ok ? "ok" : "fail");
    if (!ok) toast("Clipboard is blocked by the browser. Select the text and copy manually.", "error");
    window.setTimeout(() => setState("idle"), 1600);
  }

  return (
    <button
      type="button"
      className={`btn ${size === "sm" ? "btn-sm" : ""} btn-ghost`}
      onClick={onClick}
      title={title || "Copy to clipboard"}
      aria-label={title || label}
    >
      <span aria-hidden="true">{state === "ok" ? "✓" : state === "fail" ? "✕" : "⧉"}</span>
      <span className="copy-label">{state === "ok" ? "Copied" : state === "fail" ? "Failed" : label}</span>
    </button>
  );
}

/* ------------------------------------------------------------------ chips */

export function MethodChip({ method }: { method: string }) {
  return <span className={`chip chip-mono ${methodTone(method)}`}>{method.toUpperCase()}</span>;
}

export function StatusChip({ code }: { code: number | null | undefined }) {
  return (
    <span className={`chip chip-mono ${statusTone(code)}`} title={code ? "HTTP status returned by the target" : "No response"}>
      {code ?? "ERR"}
    </span>
  );
}

export function OriginChip({ origin }: { origin: "captured" | "synthetic" }) {
  return (
    <span className={`chip ${origin === "captured" ? "chip-captured" : "chip-synthetic"}`}>
      {origin === "captured" ? "● real request" : "◇ test request"}
    </span>
  );
}

/* ---------------------------------------------------------------- collapsible */

export function Collapsible({
  title,
  subtitle,
  defaultOpen = false,
  children,
  right,
}: {
  title: string;
  subtitle?: string;
  defaultOpen?: boolean;
  children: ReactNode;
  right?: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div>
      <div className="row" style={{ gap: 6, flexWrap: "nowrap" }}>
        <button type="button" className="collapse-head" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
          <span aria-hidden="true" style={{ width: 12, display: "inline-block" }}>
            {open ? "▾" : "▸"}
          </span>
          <span>{title}</span>
          {subtitle ? <span className="tiny faint" style={{ fontWeight: 500 }}>{subtitle}</span> : null}
        </button>
        {right ? <div className="row-tight">{right}</div> : null}
      </div>
      {open ? <div className="collapse-body">{children}</div> : null}
    </div>
  );
}

/* ------------------------------------------------------------------ modal */

export function ConfirmModal({
  open,
  title,
  body,
  confirmLabel = "Confirm",
  danger,
  busy,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  title: string;
  body: ReactNode;
  confirmLabel?: string;
  danger?: boolean;
  busy?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onCancel();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onCancel]);

  if (!open) return null;
  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label={title} onClick={onCancel}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>{title}</h2>
        <div className="muted small">{body}</div>
        <div className="modal-actions">
          <button type="button" className="btn btn-ghost" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
          <button type="button" className={`btn ${danger ? "btn-danger" : "btn-primary"}`} onClick={onConfirm} disabled={busy}>
            {busy ? <span className="spin" aria-hidden="true" /> : null}
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ----------------------------------------------------------------- states */

export function EmptyState({ icon, title, hint, action }: { icon?: ReactNode; title: string; hint?: string; action?: ReactNode }) {
  return (
    <div className="empty">
      <div className="empty-icon" aria-hidden="true">
        {icon ?? "◎"}
      </div>
      <h3>{title}</h3>
      {hint ? <p>{hint}</p> : null}
      {action ? <div style={{ marginTop: 14 }}>{action}</div> : null}
    </div>
  );
}

export function ErrorBanner({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="banner banner-error" role="alert">
      <span aria-hidden="true">⚠</span>
      <div style={{ flex: 1 }}>
        <div>{message}</div>
        {onRetry ? (
          <button type="button" className="btn btn-sm btn-ghost" style={{ marginTop: 8 }} onClick={onRetry}>
            Retry
          </button>
        ) : null}
      </div>
    </div>
  );
}

export function Loading({ label = "Loading…" }: { label?: string }) {
  return (
    <div className="row" style={{ padding: "22px 4px", color: "var(--text-dim)", fontSize: 13 }}>
      <span className="spin" aria-hidden="true" />
      <span>{label}</span>
    </div>
  );
}
