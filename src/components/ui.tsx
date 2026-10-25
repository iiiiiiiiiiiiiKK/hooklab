import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { copyText, methodTone, statusTone } from "../format";
import { useI18n } from "../i18n";

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
  label,
  size = "sm",
  title,
  testId,
}: {
  value: string;
  label?: string;
  size?: "sm" | "md";
  title?: string;
  testId?: string;
}) {
  const { t } = useI18n();
  const [state, setState] = useState<"idle" | "ok" | "fail">("idle");
  const toast = useToast();
  const text = label ?? t("common.copy");

  async function onClick() {
    const ok = await copyText(value);
    setState(ok ? "ok" : "fail");
    if (!ok) toast(t("common.clipboardBlocked"), "error");
    window.setTimeout(() => setState("idle"), 1600);
  }

  return (
    <button
      type="button"
      className={`btn ${size === "sm" ? "btn-sm" : ""} btn-ghost`}
      onClick={onClick}
      title={title || t("common.copyTitle")}
      aria-label={title || text}
      data-test={testId}
    >
      <span aria-hidden="true">{state === "ok" ? "✓" : state === "fail" ? "✕" : "⧉"}</span>
      <span className="copy-label copy-state">
        {state === "ok" ? t("common.copied") : state === "fail" ? t("common.failed") : text}
      </span>
    </button>
  );
}

/* ------------------------------------------------------------------ chips */

export function MethodChip({ method }: { method: string }) {
  return <span className={`chip chip-mono ${methodTone(method)}`}>{method.toUpperCase()}</span>;
}

export function StatusChip({ code }: { code: number | null | undefined }) {
  const { t } = useI18n();
  return (
    <span
      className={`chip chip-mono ${statusTone(code)}`}
      title={code ? t("chip.statusTitle") : t("chip.noResponse")}
    >
      {code ?? "ERR"}
    </span>
  );
}

export function OriginChip({ origin }: { origin: "captured" | "synthetic" }) {
  const { t } = useI18n();
  return (
    <span className={`chip ${origin === "captured" ? "chip-captured" : "chip-synthetic"}`}>
      {origin === "captured" ? t("chip.real") : t("chip.test")}
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
  confirmLabel,
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
  const { t } = useI18n();

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
            {t("common.cancel")}
          </button>
          <button type="button" className={`btn ${danger ? "btn-danger" : "btn-primary"}`} onClick={onConfirm} disabled={busy}>
            {busy ? <span className="spin" aria-hidden="true" /> : null}
            {confirmLabel ?? t("common.confirm")}
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
  const { t } = useI18n();
  return (
    <div className="banner banner-error" role="alert">
      <span aria-hidden="true">⚠</span>
      <div style={{ flex: 1 }}>
        <div>{message}</div>
        {onRetry ? (
          <button type="button" className="btn btn-sm btn-ghost" style={{ marginTop: 8 }} onClick={onRetry}>
            {t("common.retry")}
          </button>
        ) : null}
      </div>
    </div>
  );
}

export function Loading({ label }: { label?: string }) {
  const { t } = useI18n();
  return (
    <div className="row" style={{ padding: "22px 4px", color: "var(--text-dim)", fontSize: 13 }}>
      <span className="spin" aria-hidden="true" />
      <span>{label ?? t("common.loading")}</span>
    </div>
  );
}
