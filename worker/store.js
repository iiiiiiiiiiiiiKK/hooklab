import { json, apiError, sha256Hex, hitRateLimit, nowMs } from "./util.js";
import { validateReplayTarget, safeFetch, SsrfError } from "./ssrf.js";

const PLAN = {
  maxEndpointsPerIpPerDay: 20,
  maxRequestsPerEndpoint: 500,
  maxStoredBytesPerEndpoint: 4 * 1024 * 1024,
  maxReplaysPerMinute: 20,
  maxReplaysPerDay: 200,
  ingestPerMinuteCeiling: 240,
  minTtlMinutes: 10,
  maxTtlMinutes: 60 * 24 * 30,
  minRetentionMinutes: 5,
  maxRetentionMinutes: 60 * 24 * 7,
};

export { PLAN };

export async function authenticate(request, db, endpointId) {
  const header = request.headers.get("x-hooklab-token") || "";
  let token = header;
  if (!token) {
    const auth = request.headers.get("authorization") || "";
    if (/^bearer\s+/i.test(auth)) token = auth.replace(/^bearer\s+/i, "").trim();
  }
  if (token) {
    const hash = await sha256Hex(token);
    const row = await db.prepare("SELECT * FROM endpoints WHERE id = ? AND token_hash = ?").bind(endpointId, hash).first();
    if (row) return row;
  }
  return null;
}

export async function requireAuth(request, env) {
  const url = new URL(request.url);
  const parts = url.pathname.split("/").filter(Boolean); // api, endpoints, :id, ...
  const endpointId = parts[2];
  if (!endpointId) return { error: apiError("missing_endpoint", "Endpoint id missing.", 400) };
  const row = await authenticate(request, env.DB, endpointId);
  if (!row) {
    return { error: apiError("unauthorized", "A valid endpoint token is required for this operation.", 401) };
  }
  return { endpoint: row };
}

export function endpointPublicView(row, now = nowMs()) {
  const expired = row.status === "expired" || row.expires_at <= now;
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    status: expired ? "expired" : row.status,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    maxRequests: row.max_requests,
    requestCount: row.request_count,
    retentionMinutes: row.retention_minutes,
    rateLimitPerMinute: row.rate_limit_per_minute,
    storeSensitiveHeaders: !!row.store_sensitive_headers,
    totalBytes: row.total_bytes,
    lastRequestAt: row.last_request_at,
    tokenHint: row.token_hint,
    ingestPath: `/h/${row.slug}`,
  };
}

/** Opportunistic cleanup so free-plan storage never silently fills up. */
export async function sweepExpired(db, now = nowMs()) {
  try {
    await db
      .prepare(
        `DELETE FROM requests WHERE id IN (
           SELECT id FROM requests WHERE expires_at <= ?1 LIMIT 100
         )`,
      )
      .bind(now)
      .run();
    await db
      .prepare(
        `UPDATE endpoints SET status = 'expired'
         WHERE status = 'active' AND expires_at <= ?1`,
      )
      .bind(now)
      .run();
    await db
      .prepare(
        `DELETE FROM requests WHERE endpoint_id IN (
           SELECT id FROM endpoints WHERE status = 'expired' AND expires_at <= ?1
         )`,
      )
      .bind(now - 24 * 60 * 60 * 1000)
      .run();
    await db.prepare("DELETE FROM rate_limits WHERE window_start < ?1").bind(now - 6 * 60 * 60 * 1000).run();
  } catch {
    /* cleanup is best-effort; never fail a user request because of it */
  }
}

export function effectiveExpiry(endpoint, now, retentionMinutes) {
  const retentionCap = now + retentionMinutes * 60 * 1000;
  return Math.min(endpoint.expires_at, retentionCap);
}

export async function runReplay(env, endpoint, request, { targetUrl, method, extraHeaders, includeBody }) {
  const limit = await hitRateLimit(env.DB, `replay:ep:${endpoint.id}`, 60_000, PLAN.maxReplaysPerMinute);
  if (!limit.allowed) {
    return {
      error: apiError(
        "replay_rate_limited",
        `Replay rate limit reached (${limit.limit}/minute). Retry at ${new Date(limit.resetAt).toISOString()}.`,
        429,
        { retryAfterSeconds: Math.ceil((limit.resetAt - nowMs()) / 1000) },
      ),
    };
  }
  const daily = await hitRateLimit(env.DB, `replay:day:${endpoint.id}`, 24 * 60 * 60 * 1000, PLAN.maxReplaysPerDay);
  if (!daily.allowed) {
    return { error: apiError("replay_quota_exceeded", "Daily replay quota reached for this endpoint.", 429) };
  }

  // Structural validation first (fast fail, no DNS).
  let preflight;
  try {
    preflight = validateReplayTarget(targetUrl, env);
  } catch (err) {
    if (err instanceof SsrfError) {
      return { error: apiError(err.code, err.message, err.status) };
    }
    throw err;
  }

  const started = nowMs();
  const headers = new Headers();
  headers.set("user-agent", "HookLab-Replay/1.0 (+https://github.com/iiiiiiiiiiiiiKK/hooklab)");
  headers.set("x-hooklab-replay", "1");
  if (request?.content_type) headers.set("content-type", request.content_type);
  for (const [k, v] of extraHeaders || []) {
    if (typeof k !== "string" || typeof v !== "string") continue;
    const lower = k.toLowerCase();
    if (["host", "content-length", "connection", "x-hooklab-replay"].includes(lower)) continue;
    if (lower === "content-type" && request?.content_type) continue;
    headers.set(k, v);
  }

  let body;
  if (includeBody !== false && request) {
    if (request.body_encoding === "utf8" && typeof request.body_text === "string") body = request.body_text;
    else if (request.body_encoding === "base64" && request.body_base64) {
      body = Uint8Array.from(atob(request.body_base64), (c) => c.charCodeAt(0));
    }
  }

  let result;
  try {
    result = await safeFetch(preflight.href, {
      method: method || request?.method || "POST",
      headers,
      body,
      env,
    });
  } catch (err) {
    const duration = nowMs() - started;
    if (err instanceof SsrfError) {
      await recordReplay(env.DB, {
        endpointId: endpoint.id,
        requestId: request?.id ?? null,
        targetUrl: String(targetUrl),
        method: method || request?.method || "POST",
        statusCode: null,
        durationMs: duration,
        ok: false,
        errorCode: err.code,
        preview: err.message,
        redact: true,
      });
      return { error: apiError(err.code, err.message, err.status) };
    }
    const code = err?.name === "TimeoutError" ? "replay_timeout" : "replay_failed";
    const message =
      code === "replay_timeout"
        ? `Target did not respond within ${10} seconds.`
        : "Target request failed (network error, TLS failure or unreachable host).";
    await recordReplay(env.DB, {
      endpointId: endpoint.id,
      requestId: request?.id ?? null,
      targetUrl: String(targetUrl),
      method: method || request?.method || "POST",
      statusCode: null,
      durationMs: duration,
      ok: false,
      errorCode: code,
      preview: message,
      redact: true,
    });
    return { error: apiError(code, message, code === "replay_timeout" ? 504 : 502) };
  }

  const { response, finalUrl, hops, rebind } = result;
  const duration = nowMs() - started;
  const read = await readLimited(response, 8 * 1024);
  const responseHeaders = [...response.headers.entries()]
    .filter(([name]) => !/(set-cookie|authorization)/i.test(name))
    .slice(0, 40);

  const ok = response.status < 400 && (!rebind || rebind.stable !== false);
  const record = await recordReplay(env.DB, {
    endpointId: endpoint.id,
    requestId: request?.id ?? null,
    targetUrl: String(targetUrl),
    method: method || request?.method || "POST",
    statusCode: response.status,
    durationMs: duration,
    ok,
    errorCode: rebind && rebind.stable === false ? "dns_rebinding_suspected" : null,
    preview: read.preview,
    headers: responseHeaders,
    bytes: read.bytes,
    truncated: read.truncated,
    hops,
    redact: true,
  });

  return {
    replay: {
      id: record.id,
      targetUrl: String(targetUrl),
      finalUrl,
      method: method || request?.method || "POST",
      statusCode: response.status,
      statusText: response.statusText,
      durationMs: duration,
      ok,
      hops,
      dnsRebindingSuspected: rebind?.stable === false,
      truncated: read.truncated,
      bodyPreview: read.preview,
      responseHeaders,
      bytes: read.bytes,
    },
  };
}

async function readLimited(response, limit) {
  if (!response.body) return { preview: "", truncated: false, bytes: 0 };
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  let truncated = false;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > limit) {
        chunks.push(value.subarray(0, Math.max(0, limit - (total - value.byteLength))));
        truncated = true;
        try {
          await reader.cancel();
        } catch {
          /* ignore */
        }
        break;
      }
      chunks.push(value);
    }
  } catch {
    truncated = true;
  }
  const merged = new Uint8Array(Math.min(total, limit));
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  let preview;
  try {
    preview = new TextDecoder("utf-8", { fatal: true }).decode(merged);
  } catch {
    preview = `[binary response, ${merged.byteLength} bytes captured]`;
  }
  return { preview, truncated, bytes: total };
}

async function recordReplay(db, r) {
  const id = crypto.randomUUID();
  const headersJson = r.redact || !r.headers ? JSON.stringify(r.headers || []) : JSON.stringify(r.headers);
  await db
    .prepare(
      `INSERT INTO replays (id, endpoint_id, request_id, created_at, target_url, target_host, method,
        status_code, duration_ms, ok, error_code, response_headers, response_preview, response_bytes, truncated, redirects)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    )
    .bind(
      id,
      r.endpointId,
      r.requestId,
      nowMs(),
      r.targetUrl,
      safeHost(r.targetUrl),
      r.method,
      r.statusCode ?? null,
      r.durationMs ?? null,
      r.ok ? 1 : 0,
      r.errorCode ?? null,
      headersJson,
      typeof r.preview === "string" ? r.preview.slice(0, 8 * 1024) : null,
      r.bytes ?? null,
      r.truncated ? 1 : 0,
      JSON.stringify(r.hops || []),
    )
    .run();
  return { id };
}

function safeHost(targetUrl) {
  try {
    return new URL(targetUrl).hostname;
  } catch {
    return "invalid";
  }
}

export async function listRequests(env, endpoint, { since = 0, search = "", method = "", origin = "", limit = 50 }) {
  const limitClamped = Math.min(200, Math.max(1, Number(limit) || 50));
  // Expired rows are hidden immediately, even before the sweep removes them.
  const now = nowMs();
  const params = [endpoint.id, now];
  let sql = `SELECT id, seq, received_at, method, path, content_type, kind, body_size, origin, user_agent, ip_hash, client_country, json_valid, body_text, body_base64, body_encoding, redacted_json
             FROM requests WHERE endpoint_id = ? AND expires_at > ?`;
  if (since) {
    sql += " AND seq > ?";
    params.push(Number(since));
  }
  if (method) {
    sql += " AND upper(method) = ?";
    params.push(String(method).toUpperCase());
  }
  if (origin === "captured" || origin === "synthetic") {
    sql += " AND origin = ?";
    params.push(origin);
  }
  if (search) {
    sql += " AND (lower(path) LIKE ? ESCAPE '\\' OR lower(coalesce(body_text,'')) LIKE ? ESCAPE '\\' OR lower(coalesce(user_agent,'')) LIKE ? ESCAPE '\\')";
    const like = `%${String(search).toLowerCase().replace(/[\\%_]/g, (m) => `\\${m}`)}%`;
    params.push(like, like, like);
  }
  sql += " ORDER BY seq DESC LIMIT ?";
  params.push(limitClamped);
  const { results } = await env.DB.prepare(sql).bind(...params).all();
  return (results || []).map((row) => ({
    id: row.id,
    seq: row.seq,
    receivedAt: row.received_at,
    method: row.method,
    path: row.path,
    contentType: row.content_type,
    kind: row.kind,
    bodySize: row.body_size,
    origin: row.origin,
    userAgent: row.user_agent,
    clientCountry: row.client_country,
    jsonValid: !!row.json_valid,
    bodyPreview: previewOf(row),
    expiresAt: Math.min(row.received_at + (endpoint.retention_minutes || 60) * 60 * 1000, endpoint.expires_at),
  }));
}

function previewOf(row) {
  if (row.kind === "empty" || row.body_size === 0) return "";
  if (row.body_encoding === "utf8" && typeof row.body_text === "string") {
    return row.body_text.length > 400 ? `${row.body_text.slice(0, 400)}…` : row.body_text;
  }
  return `[${row.body_size} bytes binary body]`;
}

export async function getRequest(env, endpoint, requestId) {
  const row = await env.DB.prepare("SELECT * FROM requests WHERE id = ? AND endpoint_id = ? AND expires_at > ?")
    .bind(requestId, endpoint.id, nowMs())
    .first();
  if (!row) return null;
  const replayRows = await env.DB.prepare(
    "SELECT id, created_at, target_host, method, status_code, duration_ms, ok, error_code FROM replays WHERE endpoint_id = ? AND request_id = ? ORDER BY created_at DESC LIMIT 10",
  )
    .bind(endpoint.id, requestId)
    .all();
  return {
    id: row.id,
    seq: row.seq,
    receivedAt: row.received_at,
    method: row.method,
    path: row.path,
    query: safeJson(row.query_json, []),
    headers: safeJson(row.headers_json, []),
    redactedHeaders: safeJson(row.redacted_json, []),
    contentType: row.content_type,
    kind: row.kind,
    bodySize: row.body_size,
    bodyText: row.body_text,
    bodyBase64: row.body_base64,
    bodyEncoding: row.body_encoding,
    bodySha256: row.body_sha256,
    jsonValid: !!row.json_valid,
    origin: row.origin,
    userAgent: row.user_agent,
    clientCountry: row.client_country,
    expiresAt: row.expires_at,
    replays: (replayRows.results || []).map((r) => ({
      id: r.id,
      createdAt: r.created_at,
      targetHost: r.target_host,
      method: r.method,
      statusCode: r.status_code,
      durationMs: r.duration_ms,
      ok: !!r.ok,
      errorCode: r.error_code,
    })),
  };
}

function safeJson(value, fallback) {
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

export { json };
