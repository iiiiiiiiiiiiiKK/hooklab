/**
 * Temporary external verification client.
 *
 * Runs on Cloudflare's edge (a different network from the build machine) and exercises the
 * deployed HookLab API end-to-end. Split into stages because a single Worker invocation is
 * limited to 50 subrequests. Deleted after the verification run.
 *
 *   /?stage=1  capture, redaction, quotas, rate limit, auth
 *   /?stage=2  SSRF / replay-target protections
 *   /?stage=3  replay, export, synthetic labelling, cleanup
 */

export default {
  async fetch(request, env) {
    const stage = new URL(request.url).searchParams.get("stage") || "1";
    try {
      const results = await runStage(stage, env);
      const passed = results.filter((r) => r.ok).length;
      return new Response(
        JSON.stringify({ stage, ok: passed === results.length, passed, total: results.length, results }, null, 2),
        { headers: { "content-type": "application/json" } },
      );
    } catch (err) {
      return new Response(
        JSON.stringify({ stage, ok: false, fatal: String(err && err.stack ? err.stack : err) }, null, 2),
        { status: 500, headers: { "content-type": "application/json" } },
      );
    }
  },
};

function makeClient(env) {
  const base = env.HOOKLAB_BASE || "https://hooklab.852168.dpdns.org";
  async function api(path, { method = "GET", token, body } = {}) {
    const headers = {};
    if (token) headers["x-hooklab-token"] = token;
    if (body !== undefined) headers["content-type"] = "application/json";
    const r = await fetch(base + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await r.text();
    let json = null;
    try {
      json = JSON.parse(text);
    } catch {
      /* non-JSON (e.g. export download) */
    }
    return { status: r.status, json, text };
  }
  return { base, api };
}

async function createEndpoint(api, overrides = {}) {
  const res = await api("/api/endpoints", {
    method: "POST",
    body: { name: "edge-verification", ttlMinutes: 60, maxRequests: 60, retentionMinutes: 30, ...overrides },
  });
  if (res.status !== 201) throw new Error(`create failed: ${res.status} ${res.text.slice(0, 300)}`);
  return res.json;
}

async function runStage(stage, env) {
  const { api } = makeClient(env);
  const results = [];
  const log = (name, ok, detail) => results.push({ name, ok: !!ok, detail });

  if (stage === "1") {
    const { endpoint, token, ingestUrl } = await createEndpoint(api, { rateLimitPerMinute: 6 });
    log("create endpoint", !!endpoint?.id && token?.startsWith("hl_"), { id: endpoint.id, slug: endpoint.slug });

    const jsonPost = await fetch(ingestUrl, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: "Bearer super-secret-token",
        cookie: "sess=abc",
        "x-api-key": "sk_live_123",
      },
      body: JSON.stringify({ event: "order.paid", amount: 4999 }),
    });
    const jsonBody = await jsonPost.json();
    log("capture JSON → 202", jsonPost.status === 202 && jsonBody.ok && jsonBody.seq === 1, {
      status: jsonPost.status,
      seq: jsonBody.seq,
      kind: jsonBody.kind,
    });

    const formPost = await fetch(`${ingestUrl}?src=form&utm=test`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: "email=a%40b.com&plan=pro",
    });
    log("capture form body", formPost.status === 202, { status: formPost.status });

    const emptyGet = await fetch(ingestUrl, { method: "GET" });
    log("capture empty GET", emptyGet.status === 202, { status: emptyGet.status });

    const big = await fetch(ingestUrl, {
      method: "POST",
      headers: { "content-type": "text/plain" },
      body: "x".repeat(140 * 1024),
    });
    const bigJson = await big.json();
    log("oversized body rejected (413)", big.status === 413, { status: big.status, code: bigJson?.error?.code });

    const list = await api(`/api/endpoints/${endpoint.id}/requests`, { token });
    const jsonRow = list.json?.requests?.find((r) => r.kind === "json");
    log("list requests", list.status === 200 && (list.json?.requests?.length ?? 0) === 3, {
      count: list.json?.requests?.length,
    });

    const detail = jsonRow ? await api(`/api/endpoints/${endpoint.id}/requests/${jsonRow.id}`, { token }) : null;
    const hdrs = Object.fromEntries(detail?.json?.request?.headers ?? []);
    log(
      "sensitive headers redacted",
      hdrs.authorization === "[REDACTED]" && hdrs.cookie === "[REDACTED]" && hdrs["x-api-key"] === "[REDACTED]",
      { authorization: hdrs.authorization, cookie: hdrs.cookie, "x-api-key": hdrs["x-api-key"] },
    );
    log("json body prettified server-side", detail?.json?.request?.jsonValid === true && detail?.json?.request?.kind === "json", {
      kind: detail?.json?.request?.kind,
    });

    const wrong = await api(`/api/endpoints/${endpoint.id}/requests`, { token: "hl_wrong_token_value_1234567890abcdefghij" });
    log("wrong token rejected (401)", wrong.status === 401, { status: wrong.status });

    let limited = null;
    for (let i = 0; i < 4; i++) {
      const r = await fetch(ingestUrl, { method: "POST", headers: { "content-type": "text/plain" }, body: `burst-${i}` });
      if (r.status === 429) {
        limited = { status: r.status, code: (await r.json())?.error?.code, remaining: r.headers.get("x-ratelimit-remaining") };
        break;
      }
    }
    log("ingest rate limit enforced (429)", limited?.status === 429, limited);

    await api(`/api/endpoints/${endpoint.id}`, { method: "DELETE", token });
    return results;
  }

  if (stage === "2") {
    const { endpoint, token } = await createEndpoint(api, { name: "ssrf-verification" });
    const targets = [
      ["http://127.0.0.1/", "loopback v4"],
      ["http://localhost/", "loopback hostname"],
      ["http://[::1]/", "loopback v6"],
      ["http://169.254.169.254/latest/meta-data/", "aws metadata"],
      ["http://metadata.google.internal/computeMetadata/v1/", "gcp metadata"],
      ["http://10.0.0.5:8080/admin", "rfc1918 10/8"],
      ["http://192.168.1.1/", "rfc1918 192.168/16"],
      ["http://172.16.0.1/", "rfc1918 172.16/12"],
      ["http://100.64.0.1/", "cgnat"],
      ["http://0x7f.0.0.1/", "hex ipv4"],
      ["http://2130706433/", "decimal ipv4"],
      ["http://app.internal/", "internal zone"],
      ["file:///etc/passwd", "non-http scheme"],
      ["gopher://example.com/", "non-http scheme"],
      ["https://user:pass@example.com/", "credentialed url"],
      ["https://example.com:22/", "blocked port"],
      ["http://[::ffff:127.0.0.1]/", "ipv4-mapped v6"],
      ["http://[64:ff9b::7f00:1]/", "nat64 loopback"],
    ];
    for (const [target, label] of targets) {
      const r = await api(`/api/endpoints/${endpoint.id}/replay`, { method: "POST", token, body: { targetUrl: target } });
      log(`blocked: ${label}`, r.status >= 400 && r.status < 500 && !!r.json?.error?.code, {
        target,
        status: r.status,
        code: r.json?.error?.code,
      });
    }
    await api(`/api/endpoints/${endpoint.id}`, { method: "DELETE", token });
    return results;
  }

  // stage 3
  const { endpoint, token, ingestUrl } = await createEndpoint(api, { name: "replay-verification" });
  await fetch(ingestUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ event: "replay.me", nested: { ok: true } }),
  });
  const list = await api(`/api/endpoints/${endpoint.id}/requests`, { token });
  const source = list.json?.requests?.[0];
  log("source request captured", !!source?.id, { id: source?.id, seq: source?.seq });

  const replay = await api(`/api/endpoints/${endpoint.id}/replay`, {
    method: "POST",
    token,
    body: { targetUrl: "https://httpbin.org/post", requestId: source?.id },
  });
  log("legit replay reaches real target", replay.status === 200 && replay.json?.replay?.statusCode === 200, {
    status: replay.status,
    targetStatus: replay.json?.replay?.statusCode ?? null,
    ms: replay.json?.replay?.durationMs ?? null,
    hops: replay.json?.replay?.hops?.length ?? null,
    error: replay.json?.error?.code ?? null,
  });

  const bad = await api(`/api/endpoints/${endpoint.id}/replay`, {
    method: "POST",
    token,
    body: { targetUrl: "https://this-host-does-not-exist-hooklab.invalid/x", requestId: source?.id },
  });
  log("unresolvable / reserved target refused", bad.status >= 400 && !!bad.json?.error?.code, {
    status: bad.status,
    code: bad.json?.error?.code,
  });

  const synthetic = await api(`/api/endpoints/${endpoint.id}/test-request`, {
    method: "POST",
    token,
    body: { method: "POST", contentType: "application/json", body: '{"from":"test-request"}' },
  });
  const synthList = await api(`/api/endpoints/${endpoint.id}/requests?origin=synthetic`, { token });
  const realList = await api(`/api/endpoints/${endpoint.id}/requests?origin=captured`, { token });
  log(
    "synthetic vs captured kept distinct",
    synthetic.status === 200 && synthList.json?.requests?.length === 1 && realList.json?.requests?.length === 1,
    { synthetic: synthList.json?.requests?.length, captured: realList.json?.requests?.length },
  );

  const exp = await fetch(`${makeClient(env).base}/api/endpoints/${endpoint.id}/export?scope=summary`, {
    headers: { "x-hooklab-token": token },
  });
  const expText = await exp.text();
  log("sanitised export contains no live secrets", exp.status === 200 && !expText.includes("super-secret") && expText.includes("[REDACTED]"), {
    status: exp.status,
    bytes: expText.length,
  });

  const replays = await api(`/api/endpoints/${endpoint.id}/replays`, { token });
  log("replay history recorded", (replays.json?.replays?.length ?? 0) >= 1, { count: replays.json?.replays?.length });

  const del = await api(`/api/endpoints/${endpoint.id}`, { method: "DELETE", token });
  log("delete endpoint", del.status === 200, { status: del.status });

  const afterDelete = await fetch(ingestUrl, { method: "POST", body: "late" });
  log("ingest rejected after delete (404)", afterDelete.status === 404, { status: afterDelete.status });

  const stale = await api(`/api/endpoints/${endpoint.id}/requests`, { token });
  log("deleted endpoint no longer readable (401)", stale.status === 401, { status: stale.status });

  if (stage !== "4") return results;

  // stage 4: expiry, pause, replay timeout, redirect handling
  {
    const { endpoint, token, ingestUrl } = await createEndpoint(api, { name: "lifecycle-verification", ttlMinutes: 30 });

    // paused endpoint must stop accepting traffic
    await api(`/api/endpoints/${endpoint.id}`, { method: "PATCH", token, body: { status: "paused" } });
    const paused = await fetch(ingestUrl, { method: "POST", body: "while-paused" });
    log("paused endpoint rejects traffic", paused.status === 410 || paused.status === 409, { status: paused.status });
    await api(`/api/endpoints/${endpoint.id}`, { method: "PATCH", token, body: { status: "active" } });

    const replayToSlow = await api(`/api/endpoints/${endpoint.id}/replay`, {
      method: "POST",
      token,
      body: { targetUrl: "https://httpbin.org/delay/20" },
    });
    log("replay timeout enforced", replayToSlow.status === 504 && replayToSlow.json?.error?.code === "replay_timeout", {
      status: replayToSlow.status,
      code: replayToSlow.json?.error?.code,
    });

    const redirect = await api(`/api/endpoints/${endpoint.id}/replay`, {
      method: "POST",
      token,
      body: { targetUrl: "https://httpbin.org/absolute-redirect/2", method: "GET" },
    });
    log("redirect chain followed with per-hop validation", redirect.status === 200 && (redirect.json?.replay?.hops?.length ?? 0) === 3, {
      status: redirect.status,
      hops: redirect.json?.replay?.hops?.length ?? 0,
      finalUrl: redirect.json?.replay?.finalUrl ?? null,
    });

    const redirectToLoopback = await api(`/api/endpoints/${endpoint.id}/replay`, {
      method: "POST",
      token,
      body: {
        targetUrl: "https://httpbin.org/redirect-to?url=http://169.254.169.254/latest/meta-data/",
        method: "GET",
      },
    });
    log("redirect into metadata service blocked", redirectToLoopback.status >= 400 && !!redirectToLoopback.json?.error?.code, {
      status: redirectToLoopback.status,
      code: redirectToLoopback.json?.error?.code,
    });

    await api(`/api/endpoints/${endpoint.id}`, { method: "DELETE", token });
    return results;
  }
}
