/**
 * SSRF protection for the replay feature.
 *
 * Strategy (defence in depth):
 *  1. Parse and normalise the URL ourselves (hex/octal/decimal IPv4 forms are handled).
 *  2. Block non-http(s) schemes, embedded credentials and unusual ports.
 *  3. Block private / loopback / link-local / CGNAT / multicast / reserved IPv4 & IPv6 ranges,
 *     including IPv4-mapped and NAT64-embedded addresses.
 *  4. Block cloud metadata hostnames and internal-only TLDs.
 *  5. Resolve the hostname through DNS-over-HTTPS and reject if *any* answer is non-public.
 *  6. Follow redirects manually (max 5) and re-validate every hop.
 *  7. Re-resolve after the request and flag a change, which catches DNS-rebinding attempts
 *     that happen between our pre-flight lookup and the platform's own resolution.
 */

const BLOCKED_HOSTNAMES = new Set([
  "localhost",
  "localhost.localdomain",
  "ip6-localhost",
  "ip6-loopback",
  "metadata",
  "metadata.google.internal",
  "metadata.goog",
  "instance-data",
  "kubernetes",
  "kubernetes.default",
]);

const BLOCKED_HOST_SUFFIXES = [
  ".localhost",
  ".local",
  ".localdomain",
  ".internal",
  ".intranet",
  ".lan",
  ".home",
  ".home.arpa",
  ".corp",
  ".onion",
  ".test",
  ".invalid",
  ".example",
  ".arpa",
];

const METADATA_HOST_PREFIXES = ["metadata.", "169.254.169.254", "100.100.100.200"];

const ALLOWED_SCHEMES = new Set(["http:", "https:"]);
const DEFAULT_ALLOWED_PORTS = new Set([80, 443, 8080, 8443]);

export const MAX_REDIRECTS = 5;
export const REPLAY_TIMEOUT_MS = 10_000;
export const MAX_REPLAY_RESPONSE_BYTES = 8 * 1024;

export class SsrfError extends Error {
  constructor(code, message, status = 400) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

/** Parse an IPv4 literal in dotted, decimal, hex or octal notation. Returns octets or null. */
export function parseIpv4(input) {
  const host = String(input).trim();
  if (!host) return null;
  const parts = host.split(".");
  if (parts.length > 4) return null;
  const nums = [];
  for (const rawPart of parts) {
    if (rawPart === "") return null;
    let part = rawPart;
    let value;
    if (/^0x[0-9a-f]+$/i.test(part)) value = Number.parseInt(part.slice(2), 16);
    else if (/^0[0-7]+$/.test(part)) value = Number.parseInt(part.slice(1), 8);
    else if (/^\d+$/.test(part)) value = Number.parseInt(part, 10);
    else return null;
    if (!Number.isFinite(value) || value < 0) return null;
    nums.push(value);
  }
  // Legacy "a.b" / "a" short forms are treated as the lowest-order parts.
  if (nums.length === 1) {
    const v = nums[0];
    if (v > 0xffffffff) return null;
    return [(v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255];
  }
  if (nums.length === 2) {
    if (nums[0] > 255 || nums[1] > 0xffffff) return null;
    return [nums[0], (nums[1] >>> 16) & 255, (nums[1] >>> 8) & 255, nums[1] & 255];
  }
  if (nums.length === 3) {
    if (nums[0] > 255 || nums[1] > 255 || nums[2] > 0xffff) return null;
    return [nums[0], nums[1], (nums[2] >>> 8) & 255, nums[2] & 255];
  }
  if (nums.some((n) => n > 255)) return null;
  return nums;
}

/** Expand an IPv6 literal into 8 groups of 16 bits. Returns null when unparsable. */
export function parseIpv6(input) {
  let text = String(input).trim().replace(/^\[|\]$/g, "");
  if (!text.includes(":")) return null;
  const zone = text.indexOf("%");
  if (zone !== -1) text = text.slice(0, zone);

  // Optional trailing dotted IPv4 (e.g. ::ffff:127.0.0.1)
  let tail = [];
  const lastColon = text.lastIndexOf(":");
  const lastPart = text.slice(lastColon + 1);
  if (lastPart.includes(".")) {
    const v4 = parseIpv4(lastPart);
    if (!v4) return null;
    tail = [(v4[0] << 8) | v4[1], (v4[2] << 8) | v4[3]];
    text = text.slice(0, lastColon + 1);
    if (text.endsWith("::")) {
      // keep the "::" marker intact ("::ffff:" -> "::ffff")
      text = text.slice(0, -1);
    } else if (text.endsWith(":")) {
      text = text.slice(0, -1);
    }
  }

  const toGroups = (chunk) => {
    if (chunk === "") return [];
    const out = [];
    for (const g of chunk.split(":")) {
      if (!/^[0-9a-f]{1,4}$/i.test(g)) throw new Error("bad group");
      out.push(Number.parseInt(g, 16));
    }
    return out;
  };

  const halves = text.split("::");
  if (halves.length > 2) return null;

  let head;
  let rest;
  try {
    head = toGroups(halves[0] ?? "");
    rest = halves.length === 2 ? toGroups(halves[1] ?? "") : [];
  } catch {
    return null;
  }

  if (halves.length === 1) {
    const groups = [...head, ...tail];
    return groups.length === 8 ? groups : null;
  }
  const fill = 8 - head.length - rest.length - tail.length;
  if (fill < 1) return null;
  return [...head, ...new Array(fill).fill(0), ...rest, ...tail];
}

function isBlockedIpv4([a, b, c, d]) {
  if (a === 0) return true; // 0.0.0.0/8
  if (a === 10) return true; // private
  if (a === 127) return true; // loopback
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT 100.64/10
  if (a === 169 && b === 254) return true; // link-local + cloud metadata
  if (a === 172 && b >= 16 && b <= 31) return true; // private
  if (a === 192 && b === 0 && (c === 0 || c === 2)) return true; // IETF / TEST-NET-1
  if (a === 192 && b === 88 && c === 99) return true; // 6to4 relay anycast
  if (a === 192 && b === 168) return true; // private
  if (a === 198 && (b === 18 || b === 19)) return true; // benchmarking
  if (a === 198 && b === 51 && c === 100) return true; // TEST-NET-2
  if (a === 203 && b === 0 && c === 113) return true; // TEST-NET-3
  if (a === 192 && b === 0 && c === 0) return true;
  if (a === 192 && b === 31 && c === 196) return true; // AS112
  if (a === 192 && b === 52 && c === 193) return true;
  if (a === 192 && b === 175 && c === 48) return true;
  if (a >= 224) return true; // multicast, reserved, broadcast
  if (a === 255 && b === 255 && c === 255 && d === 255) return true;
  return false;
}

function isBlockedIpv6(groups) {
  const [g0, g1, g2, g3, g4, g5, g6, g7] = groups;
  const allZero = groups.every((g) => g === 0);
  if (allZero) return true; // ::
  if (g0 === 0 && g1 === 0 && g2 === 0 && g3 === 0 && g4 === 0 && g5 === 0 && g6 === 0 && g7 === 1) return true; // ::1
  if ((g0 & 0xfe00) === 0xfc00) return true; // fc00::/7 ULA
  if ((g0 & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local
  if ((g0 & 0xff00) === 0xff00) return true; // ff00::/8 multicast
  if (g0 === 0x0064 && g1 === 0xff9b) return true; // NAT64 64:ff9b::/96
  if (g0 === 0x2002) return true; // 6to4
  if (g0 === 0x2001 && (g1 === 0x0db8 || g1 === 0x0000)) return true; // documentation / Teredo
  // IPv4-mapped (::ffff:a.b.c.d) and IPv4-compatible
  const v4Mapped =
    g0 === 0 && g1 === 0 && g2 === 0 && g3 === 0 && g4 === 0 && (g5 === 0xffff || g5 === 0);
  if (v4Mapped) {
    const octets = [(g6 >> 8) & 255, g6 & 255, (g7 >> 8) & 255, g7 & 255];
    if (isBlockedIpv4(octets)) return true;
  }
  return false;
}

/** True when the literal IP must never be contacted by the replay feature. */
export function isBlockedIp(ip) {
  const v4 = parseIpv4(ip);
  if (v4) return isBlockedIpv4(v4);
  const v6 = parseIpv6(ip);
  if (v6) return isBlockedIpv6(v6);
  return true; // unparsable => treat as unsafe
}

function normaliseHost(hostname) {
  return hostname.trim().toLowerCase().replace(/\.$/, "");
}

function assertHostAllowed(hostname, env) {
  const host = normaliseHost(hostname);
  if (!host) throw new SsrfError("invalid_target", "Target host is empty.");
  if (BLOCKED_HOSTNAMES.has(host)) {
    throw new SsrfError("blocked_target", `Target host "${host}" is not allowed.`, 403);
  }
  for (const suffix of BLOCKED_HOST_SUFFIXES) {
    if (host.endsWith(suffix)) {
      throw new SsrfError("blocked_target", `Target host "${host}" resolves to a private or reserved zone.`, 403);
    }
  }
  for (const prefix of METADATA_HOST_PREFIXES) {
    if (host === prefix || host.startsWith(prefix)) {
      throw new SsrfError("blocked_target", "Cloud metadata endpoints are blocked.", 403);
    }
  }
  const isIpLiteral = Boolean(parseIpv4(host) || parseIpv6(host));
  if (isIpLiteral && isBlockedIp(host)) {
    throw new SsrfError("blocked_target", `Target host "${host}" is a private, loopback or reserved address.`, 403);
  }
  if (!isIpLiteral && !host.includes(".")) {
    throw new SsrfError("blocked_target", "Single-label hostnames are not allowed for replay.", 403);
  }

  const allowList = (env?.ALLOWED_REPLAY_HOSTS || "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  if (allowList.length > 0) {
    const allowed = allowList.some((entry) => host === entry || host.endsWith(`.${entry}`));
    if (!allowed) {
      throw new SsrfError(
        "host_not_allowlisted",
        `Replay is restricted to allow-listed hosts. "${host}" is not in ALLOWED_REPLAY_HOSTS.`,
        403,
      );
    }
  }
}

function allowedPorts(env) {
  const extra = (env?.ALLOWED_REPLAY_PORTS || "")
    .split(",")
    .map((s) => Number.parseInt(s.trim(), 10))
    .filter((n) => Number.isInteger(n) && n > 0 && n < 65536);
  return extra.length ? new Set([...DEFAULT_ALLOWED_PORTS, ...extra]) : DEFAULT_ALLOWED_PORTS;
}

/** Structural validation that needs no network access. */
export function validateReplayTarget(rawUrl, env) {
  let url;
  try {
    url = new URL(String(rawUrl).trim());
  } catch {
    throw new SsrfError("invalid_target", "Target must be an absolute http(s) URL.");
  }
  if (!ALLOWED_SCHEMES.has(url.protocol)) {
    throw new SsrfError("invalid_target", "Only http and https targets are supported.");
  }
  if (url.username || url.password) {
    throw new SsrfError("invalid_target", "Credentials in the target URL are not allowed.");
  }
  const ports = allowedPorts(env);
  const port = url.port ? Number.parseInt(url.port, 10) : url.protocol === "https:" ? 443 : 80;
  if (!ports.has(port)) {
    throw new SsrfError(
      "blocked_port",
      `Port ${port} is not allowed. Allowed ports: ${[...ports].sort((a, b) => a - b).join(", ")}.`,
      403,
    );
  }
  if (url.href.length > 2048) {
    throw new SsrfError("invalid_target", "Target URL is too long (max 2048 characters).");
  }
  assertHostAllowed(url.hostname, env);
  return url;
}

async function resolveViaDoH(hostname, type) {
  const resolvers = [
    { url: "https://cloudflare-dns.com/dns-query", accept: "application/dns-json" },
    { url: "https://dns.google/resolve", accept: "application/dns-json" },
    { url: "https://1.1.1.1/dns-query", accept: "application/dns-json" },
  ];
  let lastError = null;
  for (const resolver of resolvers) {
    const url = new URL(resolver.url);
    url.searchParams.set("name", hostname);
    url.searchParams.set("type", type);
    try {
      const res = await fetch(url.toString(), {
        headers: { accept: resolver.accept },
        signal: AbortSignal.timeout(4000),
      });
      if (!res.ok) {
        lastError = new SsrfError("dns_lookup_failed", `DNS lookup failed (${res.status}).`, 502);
        continue;
      }
      const body = await res.json();
      const answers = Array.isArray(body.Answer) ? body.Answer : [];
      return answers.filter((a) => a.type === 1 || a.type === 28).map((a) => a.data);
    } catch (err) {
      lastError = err;
    }
  }
  if (lastError instanceof SsrfError) throw lastError;
  throw new SsrfError("dns_lookup_failed", "Could not reach a DNS-over-HTTPS resolver for the target host.", 502);
}

/**
 * Full validation including DNS resolution.
 * Returns { url, host, addresses } — addresses are the public IPs we approved.
 */
export async function validateReplayTargetWithDns(rawUrl, env) {
  const url = validateReplayTarget(rawUrl, env);
  const host = normaliseHost(url.hostname);
  const isIpLiteral = Boolean(parseIpv4(host) || parseIpv6(host));
  if (!isIpLiteral) {
    // hostname, not a literal — resolve it and vet every answer
    let addresses;
    try {
      const [v4, v6] = await Promise.all([resolveViaDoH(host, "A"), resolveViaDoH(host, "AAAA")]);
      addresses = [...v4, ...v6];
    } catch (err) {
      if (err instanceof SsrfError) throw err;
      throw new SsrfError("dns_lookup_failed", "Could not resolve the target hostname.", 502);
    }
    if (addresses.length === 0) {
      throw new SsrfError("dns_lookup_failed", `Target host "${host}" did not resolve to any address.`, 400);
    }
    const blocked = addresses.filter((addr) => isBlockedIp(addr));
    if (blocked.length > 0) {
      throw new SsrfError(
        "blocked_target",
        `Target host "${host}" resolves to a blocked address (${blocked[0]}). Private, loopback and metadata ranges are not allowed.`,
        403,
      );
    }
    return { url, host, addresses };
  }
  return { url, host, addresses: [host] };
}

async function recheckDns(host, expected) {
  if (parseIpv4(host) || parseIpv6(host)) return { stable: true };
  try {
    const [v4, v6] = await Promise.all([resolveViaDoH(host, "A"), resolveViaDoH(host, "AAAA")]);
    const now = new Set([...v4, ...v6]);
    const before = new Set(expected);
    const added = [...now].filter((ip) => !before.has(ip));
    if (added.length > 0 && added.some((ip) => isBlockedIp(ip))) {
      return { stable: false, reason: "dns_rebinding_suspected" };
    }
    return { stable: true };
  } catch {
    return { stable: true, unknown: true };
  }
}

/**
 * Perform the replay request with manual redirect handling.
 * Every redirect hop is re-validated end-to-end.
 */
export async function safeFetch(urlString, { method = "POST", headers = [], body = null, env } = {}) {
  const hops = [];
  let current = String(urlString);
  let currentMethod = method;
  let currentBody = body;

  for (let i = 0; i <= MAX_REDIRECTS; i++) {
    const { url, host, addresses } = await validateReplayTargetWithDns(current, env);
    hops.push(url.href);

    const res = await fetch(url.href, {
      method: currentMethod,
      headers,
      body: currentBody == null ? undefined : currentBody,
      redirect: "manual",
      signal: AbortSignal.timeout(REPLAY_TIMEOUT_MS),
    });

    if (res.status >= 300 && res.status < 400 && res.headers.get("location")) {
      if (i === MAX_REDIRECTS) {
        throw new SsrfError("too_many_redirects", `More than ${MAX_REDIRECTS} redirects.`, 400);
      }
      const next = new URL(res.headers.get("location"), url).href;
      // A redirect to another host must pass the same checks.
      validateReplayTarget(next, env);
      await res.body?.cancel();
      if (res.status === 303 || ((res.status === 301 || res.status === 302) && currentMethod !== "GET")) {
        currentMethod = "GET";
        currentBody = null;
      }
      current = next;
      continue;
    }

    const rebind = await recheckDns(host, addresses);
    return { response: res, finalUrl: url.href, hops, rebind };
  }
  throw new SsrfError("too_many_redirects", `More than ${MAX_REDIRECTS} redirects.`, 400);
}
