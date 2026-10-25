export function formatBytes(bytes: number): string {
  if (!bytes || bytes < 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let i = 0;
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024;
    i += 1;
  }
  return `${value >= 10 || i === 0 ? Math.round(value) : value.toFixed(1)} ${units[i]}`;
}

export function formatTime(ts: number | null | undefined): string {
  if (!ts) return "—";
  const d = new Date(ts);
  return d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

export function formatDateTime(ts: number | null | undefined): string {
  if (!ts) return "—";
  const d = new Date(ts);
  return d.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

export function formatRelative(ts: number | null | undefined): string {
  if (!ts) return "—";
  const diff = ts - Date.now();
  const abs = Math.abs(diff);
  const units: [number, Intl.RelativeTimeFormatUnit][] = [
    [1000 * 60 * 60 * 24, "day"],
    [1000 * 60 * 60, "hour"],
    [1000 * 60, "minute"],
    [1000, "second"],
  ];
  const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
  for (const [ms, unit] of units) {
    if (abs >= ms || unit === "second") {
      return rtf.format(Math.round(diff / ms), unit);
    }
  }
  return "now";
}

export function formatDuration(ms: number | null | undefined): string {
  if (ms === null || ms === undefined) return "—";
  if (ms < 1000) return `${Math.round(ms)} ms`;
  return `${(ms / 1000).toFixed(2)} s`;
}

export function prettyJson(raw: string): { ok: boolean; text: string } {
  try {
    return { ok: true, text: JSON.stringify(JSON.parse(raw), null, 2) };
  } catch {
    return { ok: false, text: raw };
  }
}

export function methodTone(method: string): string {
  switch (method.toUpperCase()) {
    case "GET":
      return "tone-get";
    case "POST":
      return "tone-post";
    case "PUT":
      return "tone-put";
    case "PATCH":
      return "tone-patch";
    case "DELETE":
      return "tone-delete";
    default:
      return "tone-other";
  }
}

export function statusTone(code: number | null | undefined): string {
  if (!code) return "tone-other";
  if (code < 300) return "tone-ok";
  if (code < 400) return "tone-warn";
  return "tone-bad";
}

export function decodeForm(raw: string): [string, string][] | null {
  try {
    const params = new URLSearchParams(raw);
    const entries: [string, string][] = [];
    for (const [k, v] of params.entries()) entries.push([k, v]);
    return entries.length ? entries : null;
  } catch {
    return null;
  }
}

export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* fall through to the legacy path */
  }
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}

export function download(filename: string, content: string, type = "application/json") {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
