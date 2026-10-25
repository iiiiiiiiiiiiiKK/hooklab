import {
  json,
  apiError,
  CORS_HEADERS,
  MAX_BODY_BYTES,
  MAX_DETAIL_TEXT,
  analyzeBody,
  clampInt,
  clientIp,
  hashIp,
  headersToEntries,
  hitRateLimit,
  newSlug,
  newToken,
  nowMs,
  parseQueryEntries,
  readBodyWithLimit,
  readJsonBody,
  safeName,
  sha256Hex,
  tokenHint,
  truncate,
} from "./util.js";
import {
  PLAN,
  endpointPublicView,
  getRequest,
  listRequests,
  requireAuth,
  runReplay,
  sweepExpired,
} from "./store.js";

const SITE = "https://github.com/iiiiiiiiiiiiiKK/hooklab";

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;

    try {
      if (path.startsWith("/api/")) return await handleApi(request, env, url, ctx);
      if (path === "/h" || path.startsWith("/h/")) return await handleIngest(request, env, url, "captured", ctx);
      // Everything else is the static SPA.
      return await env.ASSETS.fetch(request);
    } catch (err) {
      // Never surface stack traces or user payloads in error output.
      const ref = crypto.randomUUID().slice(0, 8);
      console.error(`[hooklab] unhandled error ref=${ref} path=${path} type=${err?.name || "Error"}`);
      const debug = env.DEBUG_ERRORS === "1" ? { debug: String(err?.message || err).slice(0, 300) } : {};
      return apiError("internal_error", `Unexpected server error (ref ${ref}).`, 500, debug);
    }
  },

  /**
   * Cron cleanup (see triggers.crons in wrangler.jsonc).
   * Deletes expired request rows, retires expired endpoints and drops stale rate-limit windows
   * so idle deployments do not accumulate data between visits.
   */
  async scheduled(_event, env, ctx) {
    ctx.waitUntil(
      (async () => {
        try {
          await sweepExpired(env.DB);
        } catch (err) {
          console.error(`[hooklab] cron sweep failed type=${err?.name || "Error"}`);
        }
      })(),
    );
  },
};

/* ------------------------------------------------------------------ ingest */

async function handleIngest(request, env, url, origin, ctx) {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  const slug = url.pathname.replace(/^\/h\/?/, "").split("/")[0];
  if (!slug) {
    return ingestError("missing_slug", "Provide an endpoint id: POST /h/<endpoint-id>", 400);
  }

  const endpoint = await env.DB.prepare("SELECT * FROM endpoints WHERE slug = ?").bind(slug).first();
  if (!endpoint) {
    return ingestError("endpoint_not_found", "This endpoint does not exist. It may have expired and been deleted.", 404);
  }

  const now = nowMs();
  if (endpoint.expires_at <= now || endpoint.status === "expired") {
    scheduleSweep(env, ctx, now);
    return ingestError("endpoint_expired", "This endpoint has expired and no longer accepts requests.", 410);
  }
  if (endpoint.status === "paused") {
    return ingestError("endpoint_paused", "This endpoint is paused and is not capturing requests.", 409);
  }

  const ip = clientIp(request);
  const ipHash = await hashIp(ip, env.IP_HASH_SECRET || "hooklab");
  const limit = await rateLimit(env, `ingest:ip:${endpoint.id}:${ipHash}`, endpoint.rate_limit_per_minute);
  const headersWithLimit = {
    ...CORS_HEADERS,
    "x-ratelimit-limit": String(limit.limit),
    "x-ratelimit-remaining": String(Math.max(0, limit.limit - limit.count)),
    "x-ratelimit-reset": String(Math.ceil(limit.resetAt / 1000)),
  };
  if (!limit.allowed) {
    return ingestError("rate_limited", `Too many requests for this endpoint (limit ${limit.limit}/minute).`, 429, {
      retryAfterSeconds: Math.max(1, Math.ceil((limit.resetAt - now) / 1000)),
    }, headersWithLimit);
  }
  const ceiling = await rateLimit(env, `ingest:ep:${endpoint.id}`, PLAN.ingestPerMinuteCeiling);
  if (!ceiling.allowed) {
    return ingestError("endpoint_rate_limited", "This endpoint is receiving too much traffic right now.", 429, {
      retryAfterSeconds: Math.max(1, Math.ceil((ceiling.resetAt - now) / 1000)),
    }, headersWithLimit);
  }

  if (endpoint.request_count >= endpoint.max_requests) {
    return ingestError(
      "request_quota_exceeded",
      `This endpoint already stored ${endpoint.max_requests} requests (its limit). Create a new endpoint.`,
      429,
      { maxRequests: endpoint.max_requests },
      headersWithLimit,
    );
  }

  const read = await readBodyWithLimit(request, MAX_BODY_BYTES);
  if (read.tooLarge) {
    return ingestError(
      "payload_too_large",
      `Request body is larger than the ${MAX_BODY_BYTES} byte limit and was rejected.`,
      413,
      { limitBytes: MAX_BODY_BYTES },
      headersWithLimit,
    );
  }
  if (read.readError || !read.bytes) {
    return ingestError("body_read_error", "Could not read the request body.", 400, {}, headersWithLimit);
  }

  const contentType = request.headers.get("content-type") || "";
  const body = analyzeBody(read.bytes, contentType);
  const storeSensitive = !!endpoint.store_sensitive_headers;
  const { entries: headerEntries, redacted } = headersToEntries(request.headers, { storeSensitive });
  const queryEntries = parseQueryEntries(url.searchParams);

  const bodySize = read.bytes.byteLength;
  const projectedBytes = endpoint.total_bytes + bodySize + 512;
  if (projectedBytes > PLAN.maxStoredBytesPerEndpoint) {
    scheduleSweep(env, ctx, now);
    return ingestError(
      "storage_quota_exceeded",
      "This endpoint has reached its storage quota. Delete old requests or create a new endpoint.",
      507,
      { quotaBytes: PLAN.maxStoredBytesPerEndpoint },
      headersWithLimit,
    );
  }

  const seq = await nextSeq(env, endpoint.id);
  if (seq === null) {
    return ingestError("request_quota_exceeded", "This endpoint is no longer accepting requests.", 429, {}, headersWithLimit);
  }

  const id = crypto.randomUUID();
  const receivedAt = now;
  const expiresAt = Math.min(receivedAt + endpoint.retention_minutes * 60 * 1000, endpoint.expires_at);
  const bodySha = bodySize > 0 ? await sha256Hex(read.bytes) : null;

  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO requests (id, endpoint_id, seq, received_at, expires_at, method, path, query_json, headers_json,
        redacted_json, content_type, kind, body_text, body_base64, body_encoding, body_size, body_sha256, json_valid,
        origin, user_agent, ip_hash, client_country)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    ).bind(
      id,
      endpoint.id,
      seq,
      receivedAt,
      expiresAt,
      request.method,
      truncate(url.pathname, 512),
      JSON.stringify(queryEntries),
      JSON.stringify(headerEntries),
      JSON.stringify(redacted),
      truncate(contentType, 200),
      body.kind,
      truncate(body.text, MAX_DETAIL_TEXT),
      body.base64,
      body.kind === "binary" || (body.text === null && body.base64) ? "base64" : body.kind === "empty" ? "none" : "utf8",
      bodySize,
      bodySha,
      body.jsonValid ? 1 : 0,
      origin,
      truncate(request.headers.get("user-agent") || "", 300),
      ipHash,
      request.headers.get("cf-ipcountry") || null,
    ),
    env.DB.prepare("UPDATE endpoints SET total_bytes = total_bytes + ?, last_request_at = ? WHERE id = ?").bind(
      bodySize + 512,
      receivedAt,
      endpoint.id,
    ),
  ]);

  const payload = {
    ok: true,
    id,
    seq,
    receivedAt,
    expiresAt,
    origin,
    kind: body.kind,
    bodySize,
    redactedHeaders: redacted,
    endpoint: { id: endpoint.id, name: endpoint.name },
    note: "Captured. Open the HookLab console to inspect this request.",
  };
  const body_ = request.method === "HEAD" ? null : JSON.stringify(payload);
  return new Response(body_, { status: 202, headers: { ...headersWithLimit, "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });
}

async function nextSeq(env, endpointId) {
  const row = await env.DB.prepare(
    `UPDATE endpoints SET request_count = request_count + 1
     WHERE id = ? AND request_count < max_requests
     RETURNING request_count`,
  )
    .bind(endpointId)
    .first();
  return row ? row.request_count : null;
}

function rateLimit(env, key, limit) {
  return hitRateLimit(env.DB, key, 60_000, limit);
}

/**
 * Run the expiry sweep without blocking the response.
 * Uses `ctx.waitUntil` when available so the work survives the response being sent;
 * falls back to a detached promise (still safe: the sweep is best-effort and idempotent).
 */
function scheduleSweep(env, ctx, now = nowMs()) {
  const work = sweepExpired(env.DB, now);
  if (ctx && typeof ctx.waitUntil === "function") ctx.waitUntil(work.catch(() => {}));
  else void work.catch(() => {});
}

function ingestError(code, message, status, extra = {}, headers = CORS_HEADERS) {
  return new Response(JSON.stringify({ ok: false, error: { code, message, ...extra } }), {
    status,
    headers: { ...headers, "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}

/* --------------------------------------------------------------------- api */

async function handleApi(request, env, url, ctx) {
  const path = url.pathname;
  const parts = path.split("/").filter(Boolean); // ["api", ...]

  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS_HEADERS });

  if (parts[1] === "health") {
    return json({ ok: true, service: "hooklab", time: nowMs(), limits: PLAN });
  }

  if (parts[1] === "endpoints" && parts.length === 2) {
    if (request.method === "POST") return createEndpoint(request, env, ctx);
    return apiError("method_not_allowed", "Use POST to create an endpoint.", 405);
  }

  if (parts[1] === "endpoints" && parts.length >= 3) {
    const endpointId = parts[2];
    const authed = await requireAuth(request, env);
    if (authed.error) return authed.error;
    const endpoint = authed.endpoint;
    const sub = parts[3];

    if (!sub) {
      if (request.method === "GET") {
        const stats = await endpointStats(env, endpoint);
        return json({ endpoint: endpointPublicView(endpoint), stats, limits: PLAN });
      }
      if (request.method === "PATCH") return updateEndpoint(request, env, endpoint);
      if (request.method === "DELETE") return deleteEndpoint(env, endpoint);
      return apiError("method_not_allowed", "Supported: GET, PATCH, DELETE.", 405);
    }

    if (sub === "requests" && parts.length === 4) {
      if (request.method === "GET") {
        const requests = await listRequests(env, endpoint, {
          since: Number(url.searchParams.get("since") || 0),
          search: url.searchParams.get("q") || "",
          method: url.searchParams.get("method") || "",
          origin: url.searchParams.get("origin") || "",
          limit: Number(url.searchParams.get("limit") || 50),
        });
        return json({
          requests,
          endpoint: endpointPublicView(endpoint),
          serverTime: nowMs(),
        });
      }
      if (request.method === "DELETE") return purgeRequests(env, endpoint);
      return apiError("method_not_allowed", "Supported: GET, DELETE.", 405);
    }

    if (sub === "requests" && parts.length === 5) {
      const requestId = parts[4];
      if (request.method === "GET") {
        const detail = await getRequest(env, endpoint, requestId);
        if (!detail) return apiError("request_not_found", "That request does not exist or has expired.", 404);
        return json({ request: detail });
      }
      if (request.method === "DELETE") return deleteRequest(env, endpoint, requestId);
      return apiError("method_not_allowed", "Supported: GET, DELETE.", 405);
    }

    if (sub === "replay" && parts.length === 4 && request.method === "POST") return replayHandler(request, env, endpoint);
    if (sub === "replays" && parts.length === 4 && request.method === "GET") return listReplays(env, endpoint);
    if (sub === "test-request" && parts.length === 4 && request.method === "POST") {
      return syntheticRequest(request, env, endpoint);
    }
    if (sub === "export" && parts.length === 4 && request.method === "GET") return exportReport(env, endpoint, request);
    if (sub === "rotate-token" && parts.length === 4 && request.method === "POST") {
      return rotateToken(env, endpoint);
    }

    return apiError("not_found", "Unknown API route.", 404);
  }

  return apiError("not_found", "Unknown API route.", 404);
}

async function createEndpoint(request, env, ctx) {
  const ip = clientIp(request);
  const ipHash = await hashIp(ip, env.IP_HASH_SECRET || "hooklab");
  const creationLimit = await hitRateLimit(env.DB, `create:day:${ipHash}`, 24 * 60 * 60 * 1000, PLAN.maxEndpointsPerIpPerDay);
  if (!creationLimit.allowed) {
    return apiError("creation_rate_limited", "Daily endpoint creation limit reached for your network (20/day).", 429);
  }

  const parsed = await readJsonBody(request, 8192);
  if (parsed.error) return parsed.error;
  const input = parsed.value || {};

  const now = nowMs();
  const ttlMinutes = clampInt(input.ttlMinutes, PLAN.minTtlMinutes, PLAN.maxTtlMinutes, 60 * 24);
  const retentionMinutes = Math.min(ttlMinutes, clampInt(input.retentionMinutes, PLAN.minRetentionMinutes, PLAN.maxRetentionMinutes, ttlMinutes));
  const maxRequests = clampInt(input.maxRequests, 1, PLAN.maxRequestsPerEndpoint, 100);
  const rateLimitPerMinute = clampInt(input.rateLimitPerMinute, 1, 300, 60);
  const name = safeName(input.name, `Endpoint ${new Date(now).toISOString().slice(11, 16)} UTC`);

  const token = newToken();
  const tokenHash = await sha256Hex(token);
  const slug = newSlug();
  const id = crypto.randomUUID();

  await env.DB.prepare(
    `INSERT INTO endpoints (id, slug, token_hash, token_hint, name, status, created_at, expires_at, max_requests,
      request_count, retention_minutes, rate_limit_per_minute, store_sensitive_headers, total_bytes)
     VALUES (?,?,?,?,?,'active',?,?,?,0,?,?,?,0)`,
  )
    .bind(
      id,
      slug,
      tokenHash,
      tokenHint(token),
      name,
      now,
      now + ttlMinutes * 60 * 1000,
      maxRequests,
      retentionMinutes,
      rateLimitPerMinute,
      input.storeSensitiveHeaders ? 1 : 0,
    )
    .run();

  const row = await env.DB.prepare("SELECT * FROM endpoints WHERE id = ?").bind(id).first();
  scheduleSweep(env, ctx, now);

  return json(
    {
      endpoint: endpointPublicView(row),
      // Returned exactly once; only the SHA-256 hash is stored server-side.
      token,
      ingestUrl: `${new URL(request.url).origin}/h/${slug}`,
      warnings: [
        "Store this token now — HookLab keeps only a hash and cannot show it again.",
        "Sensitive headers (Authorization, Cookie, API keys) are redacted by default.",
      ],
    },
    201,
  );
}

async function updateEndpoint(request, env, endpoint) {
  const parsed = await readJsonBody(request, 8192);
  if (parsed.error) return parsed.error;
  const input = parsed.value || {};
  const updates = [];
  const params = [];

  if (typeof input.name === "string") {
    updates.push("name = ?");
    params.push(safeName(input.name, endpoint.name));
  }
  if (typeof input.status === "string" && ["active", "paused"].includes(input.status)) {
    updates.push("status = ?");
    params.push(input.status);
  }
  if (input.rateLimitPerMinute !== undefined) {
    updates.push("rate_limit_per_minute = ?");
    params.push(clampInt(input.rateLimitPerMinute, 1, 300, endpoint.rate_limit_per_minute));
  }
  if (input.maxRequests !== undefined) {
    const next = clampInt(input.maxRequests, 1, PLAN.maxRequestsPerEndpoint, endpoint.max_requests);
    updates.push("max_requests = ?");
    params.push(Math.max(next, endpoint.request_count));
  }
  if (input.extendMinutes !== undefined) {
    const extend = clampInt(input.extendMinutes, 0, PLAN.maxTtlMinutes, 0);
    updates.push("expires_at = ?");
    params.push(Math.min(endpoint.expires_at + extend * 60 * 1000, nowMs() + PLAN.maxTtlMinutes * 60 * 1000));
  }
  if (typeof input.storeSensitiveHeaders === "boolean") {
    updates.push("store_sensitive_headers = ?");
    params.push(input.storeSensitiveHeaders ? 1 : 0);
  }
  if (updates.length === 0) return apiError("nothing_to_update", "No supported fields supplied.", 400);

  params.push(endpoint.id);
  await env.DB.prepare(`UPDATE endpoints SET ${updates.join(", ")} WHERE id = ?`).bind(...params).run();
  const row = await env.DB.prepare("SELECT * FROM endpoints WHERE id = ?").bind(endpoint.id).first();
  return json({ endpoint: endpointPublicView(row) });
}

async function deleteEndpoint(env, endpoint) {
  await env.DB.batch([
    env.DB.prepare("DELETE FROM requests WHERE endpoint_id = ?").bind(endpoint.id),
    env.DB.prepare("DELETE FROM replays WHERE endpoint_id = ?").bind(endpoint.id),
    env.DB.prepare("DELETE FROM endpoints WHERE id = ?").bind(endpoint.id),
  ]);
  return json({ ok: true, deleted: endpoint.id });
}

async function purgeRequests(env, endpoint) {
  const info = await env.DB.prepare("DELETE FROM requests WHERE endpoint_id = ?").bind(endpoint.id).run();
  await env.DB.prepare("UPDATE endpoints SET total_bytes = 0, request_count = 0 WHERE id = ?").bind(endpoint.id).run();
  return json({ ok: true, deleted: info?.meta?.changes ?? null });
}

async function deleteRequest(env, endpoint, requestId) {
  const row = await env.DB.prepare("SELECT body_size FROM requests WHERE id = ? AND endpoint_id = ?")
    .bind(requestId, endpoint.id)
    .first();
  if (!row) return apiError("request_not_found", "That request does not exist or has expired.", 404);
  await env.DB.prepare("DELETE FROM requests WHERE id = ? AND endpoint_id = ?").bind(requestId, endpoint.id).run();
  await env.DB.prepare("UPDATE endpoints SET total_bytes = max(0, total_bytes - ?) WHERE id = ?")
    .bind(row.body_size + 512, endpoint.id)
    .run();
  return json({ ok: true, deleted: requestId });
}

async function replayHandler(request, env, endpoint) {
  const parsed = await readJsonBody(request, 32 * 1024);
  if (parsed.error) return parsed.error;
  const input = parsed.value || {};
  const targetUrl = typeof input.targetUrl === "string" ? input.targetUrl.trim() : "";
  if (!targetUrl) return apiError("missing_target", "targetUrl is required — HookLab never replays to an implicit target.", 400);

  let sourceRequest = null;
  if (input.requestId) {
    sourceRequest = await env.DB.prepare("SELECT * FROM requests WHERE id = ? AND endpoint_id = ? AND expires_at > ?")
      .bind(String(input.requestId), endpoint.id, nowMs())
      .first();
    if (!sourceRequest) return apiError("request_not_found", "The request you tried to replay no longer exists.", 404);
  }

  const method = typeof input.method === "string" ? input.method.toUpperCase() : sourceRequest?.method || "POST";
  if (!/^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)$/.test(method)) {
    return apiError("invalid_method", "Unsupported HTTP method for replay.", 400);
  }

  const extraHeaders = Array.isArray(input.headers)
    ? input.headers
        .filter((h) => Array.isArray(h) && typeof h[0] === "string" && typeof h[1] === "string")
        .slice(0, 30)
    : [];

  const result = await runReplay(env, endpoint, sourceRequest, {
    targetUrl,
    method,
    extraHeaders,
    includeBody: input.includeBody !== false,
  });
  if (result.error) return result.error;
  return json(result);
}

async function listReplays(env, endpoint) {
  const { results } = await env.DB.prepare(
    `SELECT id, created_at, target_url, target_host, method, status_code, duration_ms, ok, error_code, response_preview
     FROM replays WHERE endpoint_id = ? ORDER BY created_at DESC LIMIT 50`,
  )
    .bind(endpoint.id)
    .all();
  return json({
    replays: (results || []).map((r) => ({
      id: r.id,
      createdAt: r.created_at,
      targetUrl: r.target_url,
      targetHost: r.target_host,
      method: r.method,
      statusCode: r.status_code,
      durationMs: r.duration_ms,
      ok: !!r.ok,
      errorCode: r.error_code,
      responsePreview: r.response_preview,
    })),
  });
}

async function syntheticRequest(request, env, endpoint) {
  const parsed = await readJsonBody(request, 64 * 1024);
  if (parsed.error) return parsed.error;
  const input = parsed.value || {};
  const method = (typeof input.method === "string" ? input.method : "POST").toUpperCase();
  if (!/^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)$/.test(method)) {
    return apiError("invalid_method", "Unsupported HTTP method.", 400);
  }
  const contentType = typeof input.contentType === "string" ? input.contentType : "application/json";
  const rawBody = typeof input.body === "string" ? input.body : "";
  if (rawBody.length > MAX_BODY_BYTES) {
    return apiError("payload_too_large", `Test body must be under ${MAX_BODY_BYTES} bytes.`, 413);
  }

  const url = new URL(`http://hooklab.local/h/${endpoint.slug}`);
  for (const [k, v] of Array.isArray(input.query) ? input.query.slice(0, 20) : []) {
    if (typeof k === "string" && typeof v === "string") url.searchParams.append(k, v);
  }

  const headers = new Headers();
  headers.set("content-type", contentType);
  headers.set("user-agent", `HookLab-TestRequest/1.0 (+${SITE})`);
  headers.set("x-hooklab-synthetic", "1");
  for (const [k, v] of Array.isArray(input.headers) ? input.headers.slice(0, 20) : []) {
    if (typeof k === "string" && typeof v === "string") headers.set(k, v);
  }

  const synthetic = new Request(url.toString(), {
    method,
    headers,
    body: method === "GET" || method === "HEAD" ? undefined : rawBody,
  });

  const response = await handleIngest(synthetic, env, url, "synthetic");
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    return json({ ok: false, error: payload.error || { code: "test_request_failed", message: "Test request failed." } }, response.status);
  }
  return json({ ok: true, request: payload, endpoint: endpointPublicView(endpoint) });
}

async function exportReport(env, endpoint, request) {
  const scope = new URL(request.url).searchParams.get("scope") === "all" ? "all" : "summary";
  const { results } = await env.DB.prepare(
    `SELECT id, seq, received_at, method, path, content_type, kind, body_size, origin, user_agent, body_text, body_encoding, json_valid, headers_json, redacted_json
     FROM requests WHERE endpoint_id = ? AND expires_at > ? ORDER BY seq ASC LIMIT 500`,
  )
    .bind(endpoint.id, nowMs())
    .all();

  const report = {
    generatedAt: new Date().toISOString(),
    generator: "HookLab (sanitised debug report)",
    endpoint: endpointPublicView(endpoint),
    retention: { retentionMinutes: endpoint.retention_minutes, note: "Rows past expiry are deleted automatically." },
    redaction: {
      default: "authorization, cookie, *token*, *secret*, *api-key*, password and signature headers are replaced with [REDACTED]",
      storedSensitiveHeaders: !!endpoint.store_sensitive_headers,
    },
    requestCount: results?.length ?? 0,
    requests: (results || []).map((r) => ({
      id: r.id,
      seq: r.seq,
      receivedAt: new Date(r.received_at).toISOString(),
      method: r.method,
      path: r.path,
      contentType: r.content_type,
      kind: r.kind,
      bodySize: r.body_size,
      origin: r.origin,
      userAgent: r.user_agent,
      headers: JSON.parse(r.headers_json || "[]"),
      redactedHeaders: JSON.parse(r.redacted_json || "[]"),
      body:
        scope === "all"
          ? r.body_encoding === "utf8"
            ? truncate(r.body_text, MAX_DETAIL_TEXT)
            : "[binary body omitted from export]"
          : undefined,
    })),
  };

  return new Response(JSON.stringify(report, null, 2), {
    headers: {
      "content-type": "application/json; charset=utf-8",
      "content-disposition": `attachment; filename="hooklab-report-${endpoint.slug}.json"`,
      "cache-control": "no-store",
    },
  });
}

async function rotateToken(env, endpoint) {
  const token = newToken();
  const tokenHash = await sha256Hex(token);
  await env.DB.prepare("UPDATE endpoints SET token_hash = ?, token_hint = ? WHERE id = ?")
    .bind(tokenHash, tokenHint(token), endpoint.id)
    .run();
  return json({ ok: true, token, tokenHint: tokenHint(token) });
}

async function endpointStats(env, endpoint) {
  const live = nowMs();
  const [requests, replays, bytes] = await Promise.all([
    env.DB.prepare("SELECT count(*) AS c FROM requests WHERE endpoint_id = ? AND expires_at > ?").bind(endpoint.id, live).first(),
    env.DB.prepare("SELECT count(*) AS c FROM replays WHERE endpoint_id = ?").bind(endpoint.id).first(),
    env.DB.prepare("SELECT coalesce(sum(body_size),0) AS b FROM requests WHERE endpoint_id = ? AND expires_at > ?")
      .bind(endpoint.id, live)
      .first(),
  ]);
  return {
    storedRequests: requests?.c ?? 0,
    replays: replays?.c ?? 0,
    storedBytes: bytes?.b ?? 0,
    quotaBytes: PLAN.maxStoredBytesPerEndpoint,
  };
}
