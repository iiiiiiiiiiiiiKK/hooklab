/**
 * Small, dependency-free helpers shared by the HookLab Worker.
 * Everything here must be safe to run in the Cloudflare Workers runtime.
 */

export const MAX_BODY_BYTES = 128 * 1024; // hard cap for captured payloads
export const MAX_RESPONSE_PREVIEW_BYTES = 8 * 1024;
export const MAX_DETAIL_TEXT = 64 * 1024;

export const CORS_HEADERS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, PUT, PATCH, DELETE, HEAD, OPTIONS",
  "access-control-allow-headers": "authorization, content-type, x-hooklab-token",
  "access-control-max-age": "86400",
};

export function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      ...headers,
    },
  });
}

export function apiError(code, message, status = 400, extra = {}, headers = {}) {
  return json({ error: { code, message, ...extra } }, status, headers);
}

export function nowMs() {
  return Date.now();
}

export function clampInt(value, min, max, fallback) {
  const n = typeof value === "string" ? Number(value) : value;
  if (typeof n !== "number" || !Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(n)));
}

export function truncate(str, max) {
  if (typeof str !== "string") return str;
  return str.length > max ? str.slice(0, max) : str;
}

export function bytesToHex(bytes) {
  let out = "";
  for (const b of bytes) out += b.toString(16).padStart(2, "0");
  return out;
}

export async function sha256Hex(input) {
  const data = typeof input === "string" ? new TextEncoder().encode(input) : input;
  const digest = await crypto.subtle.digest("SHA-256", data);
  return bytesToHex(new Uint8Array(digest));
}

export function base64url(bytes) {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function randomBytes(n) {
  const buf = new Uint8Array(n);
  crypto.getRandomValues(buf);
  return buf;
}

/** 32 random bytes => 43 chars of base64url. Prefix makes tokens recognisable. */
export function newToken() {
  return `hl_${base64url(randomBytes(32))}`;
}

/** 12 random bytes => 16 chars, ~96 bits of entropy for the public slug. */
export function newSlug() {
  return base64url(randomBytes(12));
}

export function tokenHint(token) {
  const body = token.replace(/^hl_/, "");
  return `${body.slice(0, 4)}…${body.slice(-4)}`;
}

export function escapeLike(value) {
  return String(value).replace(/[\\%_]/g, (m) => `\\${m}`);
}

const SENSITIVE_HEADER_RE =
  /(authorization|cookie|token|secret|api[-_]?key|apikey|password|passwd|signature|credential|session)/i;

export function isSensitiveHeader(name) {
  return SENSITIVE_HEADER_RE.test(name);
}

/**
 * Convert a Headers object into a stable [[name, value], ...] list.
 * Sensitive headers are redacted unless the endpoint explicitly opted in.
 */
export function headersToEntries(headers, { storeSensitive = false } = {}) {
  const entries = [];
  const redacted = [];
  for (const [name, value] of headers.entries()) {
    if (isSensitiveHeader(name)) {
      redacted.push(name.toLowerCase());
      entries.push([name, storeSensitive ? value : "[REDACTED]"]);
    } else {
      entries.push([name, value]);
    }
  }
  entries.sort((a, b) => (a[0] === b[0] ? 0 : a[0] < b[0] ? -1 : 1));
  return { entries, redacted };
}

const JSON_TYPES = /(^application\/json|^[a-z0-9.+-]+\/[a-z0-9.+-]*\+json)/i;
const FORM_TYPES = /^application\/x-www-form-urlencoded/i;
const TEXT_TYPES =
  /^(text\/|application\/(xml|xhtml\+xml|javascript|ecmascript|graphql|sql|yaml|x-yaml|ndjson)|image\/svg\+xml)/i;

const utf8Decoder = new TextDecoder("utf-8", { fatal: true });

/**
 * Classify a raw body without ever trusting it.
 * Returns { kind, text, base64, jsonValid }.
 */
export function analyzeBody(bytes, contentType) {
  if (!bytes || bytes.byteLength === 0) {
    return { kind: "empty", text: null, base64: null, jsonValid: false };
  }
  const ct = contentType || "";
  let text = null;
  let decodable = true;
  try {
    text = utf8Decoder.decode(bytes);
  } catch {
    decodable = false;
  }

  if (decodable && (JSON_TYPES.test(ct) || looksLikeJson(text))) {
    let jsonValid = false;
    try {
      JSON.parse(text);
      jsonValid = true;
    } catch {
      jsonValid = false;
    }
    if (jsonValid || JSON_TYPES.test(ct)) {
      return { kind: "json", text, base64: null, jsonValid };
    }
  }

  if (FORM_TYPES.test(ct)) {
    return { kind: "form", text: decodable ? text : null, base64: decodable ? null : toBase64(bytes), jsonValid: false };
  }

  if (TEXT_TYPES.test(ct) || (decodable && looksPrintable(text))) {
    return { kind: "text", text: decodable ? text : null, base64: decodable ? null : toBase64(bytes), jsonValid: false };
  }

  return { kind: "binary", text: null, base64: toBase64(bytes), jsonValid: false };
}

function looksLikeJson(text) {
  const t = text.trimStart();
  return t.startsWith("{") || t.startsWith("[");
}

function looksPrintable(text) {
  if (text.length === 0) return true;
  let printable = 0;
  const sample = text.length > 2000 ? text.slice(0, 2000) : text;
  for (const ch of sample) {
    const code = ch.codePointAt(0);
    if (code === 9 || code === 10 || code === 13 || (code >= 32 && code !== 127)) printable++;
  }
  return printable / sample.length > 0.95;
}

export function toBase64(bytes) {
  let bin = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
}

/**
 * Read a request body while enforcing a hard byte ceiling.
 * Never buffers more than `limit` bytes, even when Content-Length lies.
 */
export async function readBodyWithLimit(request, limit) {
  const declaredHeader = request.headers.get("content-length");
  const declared = declaredHeader ? Number(declaredHeader) : null;
  if (declared !== null && Number.isFinite(declared) && declared > limit) {
    return { tooLarge: true, declared, received: declared };
  }
  if (!request.body) {
    return { tooLarge: false, bytes: new Uint8Array(0), declared };
  }
  const reader = request.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > limit) {
        try {
          await reader.cancel();
        } catch {
          /* ignore */
        }
        return { tooLarge: true, declared, received: total };
      }
      chunks.push(value);
    }
  } catch {
    return { tooLarge: false, bytes: null, declared, readError: true };
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { tooLarge: false, bytes, declared };
}

export function clientIp(request) {
  return (
    request.headers.get("cf-connecting-ip") ||
    request.headers.get("x-real-ip") ||
    (request.headers.get("x-forwarded-for") || "").split(",")[0].trim() ||
    "unknown"
  );
}

/** Hash an IP so we can rate limit without storing personal data. */
export async function hashIp(ip, salt) {
  return (await sha256Hex(`${salt || "hooklab"}:${ip}`)).slice(0, 32);
}

export function safeName(raw, fallback = "Untitled endpoint") {
  if (typeof raw !== "string") return fallback;
  const cleaned = raw
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned) return fallback;
  return cleaned.slice(0, 60);
}

export function parseQueryEntries(searchParams) {
  const entries = [];
  for (const [k, v] of searchParams.entries()) entries.push([k, v]);
  return entries;
}

/** Atomic fixed-window counter backed by D1. Returns { allowed, count, resetAt }. */
export async function hitRateLimit(db, key, windowMs, limit, now = Date.now()) {
  const windowStart = Math.floor(now / windowMs) * windowMs;
  const resetAt = windowStart + windowMs;
  try {
    const row = await db
      .prepare(
        `INSERT INTO rate_limits (key, window_start, count) VALUES (?, ?, 1)
         ON CONFLICT(key) DO UPDATE SET
           count = CASE WHEN rate_limits.window_start = excluded.window_start
                        THEN rate_limits.count + 1 ELSE 1 END,
           window_start = excluded.window_start
         RETURNING count, window_start`,
      )
      .bind(key, windowStart)
      .first();
    const count = row?.count ?? 1;
    return { allowed: count <= limit, count, limit, resetAt };
  } catch {
    // Never fail closed on limiter infrastructure errors; the quota checks still apply.
    return { allowed: true, count: 0, limit, resetAt };
  }
}

export function isJsonRequest(request) {
  const ct = request.headers.get("content-type") || "";
  return ct.includes("application/json");
}

export async function readJsonBody(request, limit = 16 * 1024) {
  const { bytes, tooLarge, readError } = await readBodyWithLimit(request, limit);
  if (tooLarge) return { error: apiError("payload_too_large", "Request body is too large.", 413) };
  if (readError || !bytes) return { error: apiError("invalid_body", "Could not read request body.", 400) };
  if (bytes.byteLength === 0) return { value: {} };
  try {
    const text = new TextDecoder().decode(bytes);
    const value = JSON.parse(text);
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
      return { error: apiError("invalid_body", "JSON body must be an object.", 400) };
    }
    return { value };
  } catch {
    return { error: apiError("invalid_json", "Body is not valid JSON.", 400) };
  }
}
