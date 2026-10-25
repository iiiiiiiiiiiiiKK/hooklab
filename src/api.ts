export interface EndpointView {
  id: string;
  slug: string;
  name: string;
  status: "active" | "paused" | "expired";
  createdAt: number;
  expiresAt: number;
  maxRequests: number;
  requestCount: number;
  retentionMinutes: number;
  rateLimitPerMinute: number;
  storeSensitiveHeaders: boolean;
  totalBytes: number;
  lastRequestAt: number | null;
  tokenHint: string;
  ingestPath: string;
}

export interface RequestSummary {
  id: string;
  seq: number;
  receivedAt: number;
  method: string;
  path: string;
  contentType: string | null;
  kind: "json" | "form" | "text" | "binary" | "empty";
  bodySize: number;
  origin: "captured" | "synthetic";
  userAgent: string | null;
  clientCountry: string | null;
  jsonValid: boolean;
  bodyPreview: string;
  expiresAt: number;
}

export interface RequestDetail extends Omit<RequestSummary, "bodyPreview"> {
  query: [string, string][];
  headers: [string, string][];
  redactedHeaders: string[];
  bodyText: string | null;
  bodyBase64: string | null;
  bodyEncoding: "utf8" | "base64" | "none";
  bodySha256: string | null;
  replays: ReplaySummary[];
}

export interface ReplaySummary {
  id: string;
  createdAt: number;
  targetHost?: string;
  targetUrl?: string;
  method: string;
  statusCode: number | null;
  durationMs: number | null;
  ok: boolean;
  errorCode: string | null;
  responsePreview?: string | null;
}

export interface ReplayResult {
  id: string;
  targetUrl: string;
  finalUrl: string;
  method: string;
  statusCode: number;
  statusText: string;
  durationMs: number;
  ok: boolean;
  hops: string[];
  dnsRebindingSuspected: boolean;
  truncated: boolean;
  bodyPreview: string;
  responseHeaders: [string, string][];
  bytes: number;
}

export interface EndpointLimits {
  maxEndpointsPerIpPerDay: number;
  maxRequestsPerEndpoint: number;
  maxStoredBytesPerEndpoint: number;
  maxReplaysPerMinute: number;
  maxReplaysPerDay: number;
  ingestPerMinuteCeiling: number;
  minTtlMinutes: number;
  maxTtlMinutes: number;
  minRetentionMinutes: number;
  maxRetentionMinutes: number;
}

export class ApiError extends Error {
  code: string;
  status: number;
  retryAfterSeconds?: number;
  constructor(code: string, message: string, status: number, retryAfterSeconds?: number) {
    super(message);
    this.code = code;
    this.status = status;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

const BASE = "/api";

async function call<T>(path: string, options: { method?: string; token?: string; body?: unknown; signal?: AbortSignal } = {}): Promise<T> {
  const headers: Record<string, string> = { accept: "application/json" };
  if (options.token) headers["x-hooklab-token"] = options.token;
  if (options.body !== undefined) headers["content-type"] = "application/json";

  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, {
      method: options.method || "GET",
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: options.signal,
    });
  } catch (err) {
    if ((err as Error).name === "AbortError") throw err;
    throw new ApiError("network_error", "Network request failed. Check your connection and retry.", 0);
  }

  const text = await res.text();
  let payload: unknown = null;
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = null;
    }
  }

  if (!res.ok) {
    const err = (payload as { error?: { code?: string; message?: string; retryAfterSeconds?: number } } | null)?.error;
    throw new ApiError(
      err?.code || `http_${res.status}`,
      err?.message || `Request failed with status ${res.status}.`,
      res.status,
      err?.retryAfterSeconds,
    );
  }
  return payload as T;
}

export const api = {
  createEndpoint(input: {
    name?: string;
    ttlMinutes?: number;
    retentionMinutes?: number;
    maxRequests?: number;
    rateLimitPerMinute?: number;
    storeSensitiveHeaders?: boolean;
  }) {
    return call<{ endpoint: EndpointView; token: string; ingestUrl: string; warnings: string[] }>("/endpoints", {
      method: "POST",
      body: input,
    });
  },

  getEndpoint(id: string, token: string) {
    return call<{ endpoint: EndpointView; stats: { storedRequests: number; replays: number; storedBytes: number; quotaBytes: number }; limits: EndpointLimits }>(
      `/endpoints/${id}`,
      { token },
    );
  },

  updateEndpoint(id: string, token: string, patch: Record<string, unknown>) {
    return call<{ endpoint: EndpointView }>(`/endpoints/${id}`, { method: "PATCH", token, body: patch });
  },

  deleteEndpoint(id: string, token: string) {
    return call<{ ok: boolean }>(`/endpoints/${id}`, { method: "DELETE", token });
  },

  rotateToken(id: string, token: string) {
    return call<{ ok: boolean; token: string; tokenHint: string }>(`/endpoints/${id}/rotate-token`, {
      method: "POST",
      token,
    });
  },

  listRequests(
    id: string,
    token: string,
    params: { since?: number; q?: string; method?: string; origin?: string; limit?: number } = {},
    signal?: AbortSignal,
  ) {
    const qs = new URLSearchParams();
    if (params.since) qs.set("since", String(params.since));
    if (params.q) qs.set("q", params.q);
    if (params.method) qs.set("method", params.method);
    if (params.origin) qs.set("origin", params.origin);
    if (params.limit) qs.set("limit", String(params.limit));
    const suffix = qs.toString() ? `?${qs.toString()}` : "";
    return call<{ requests: RequestSummary[]; endpoint: EndpointView; serverTime: number }>(`/endpoints/${id}/requests${suffix}`, {
      token,
      signal,
    });
  },

  getRequest(id: string, token: string, requestId: string) {
    return call<{ request: RequestDetail }>(`/endpoints/${id}/requests/${requestId}`, { token });
  },

  deleteRequest(id: string, token: string, requestId: string) {
    return call<{ ok: boolean }>(`/endpoints/${id}/requests/${requestId}`, { method: "DELETE", token });
  },

  purgeRequests(id: string, token: string) {
    return call<{ ok: boolean; deleted: number | null }>(`/endpoints/${id}/requests`, { method: "DELETE", token });
  },

  replay(
    id: string,
    token: string,
    input: { targetUrl: string; requestId?: string; method?: string; headers?: [string, string][]; includeBody?: boolean },
  ) {
    return call<{ replay: ReplayResult }>(`/endpoints/${id}/replay`, { method: "POST", token, body: input });
  },

  listReplays(id: string, token: string) {
    return call<{ replays: ReplaySummary[] }>(`/endpoints/${id}/replays`, { token });
  },

  sendTestRequest(
    id: string,
    token: string,
    input: { method?: string; contentType?: string; body?: string; headers?: [string, string][]; query?: [string, string][] },
  ) {
    return call<{ ok: boolean; request: { id: string; seq: number } }>(`/endpoints/${id}/test-request`, {
      method: "POST",
      token,
      body: input,
    });
  },
};
