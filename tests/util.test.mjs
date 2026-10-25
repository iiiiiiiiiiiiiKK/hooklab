import test from "node:test";
import assert from "node:assert/strict";

import {
  analyzeBody,
  headersToEntries,
  isSensitiveHeader,
  newSlug,
  newToken,
  readBodyWithLimit,
  safeName,
  sha256Hex,
  tokenHint,
  toBase64,
  clampInt,
} from "../worker/util.js";

test("newToken produces high-entropy, prefixed tokens", () => {
  const tokens = new Set();
  for (let i = 0; i < 500; i++) {
    const t = newToken();
    assert.match(t, /^hl_[A-Za-z0-9_-]{43}$/);
    tokens.add(t);
  }
  assert.equal(tokens.size, 500);
});

test("newSlug is URL safe and unpredictable", () => {
  const slugs = new Set();
  for (let i = 0; i < 500; i++) {
    const s = newSlug();
    assert.match(s, /^[A-Za-z0-9_-]{16}$/);
    slugs.add(s);
  }
  assert.equal(slugs.size, 500);
});

test("tokenHint never leaks the full secret", () => {
  const token = newToken();
  const hint = tokenHint(token);
  assert.ok(hint.includes("…"));
  assert.ok(!hint.includes(token.slice(6, 20)));
});

test("sha256Hex is stable and does not equal the input", async () => {
  const token = "hl_abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG";
  const hash = await sha256Hex(token);
  assert.equal(hash.length, 64);
  assert.match(hash, /^[0-9a-f]{64}$/);
  assert.notEqual(hash, token);
  assert.equal(hash, await sha256Hex(token));
});

test("sensitive headers are detected and redacted by default", () => {
  const names = ["authorization", "Cookie", "x-api-key", "X-Auth-Token", "stripe-signature", "set-cookie", "password"];
  for (const name of names) assert.equal(isSensitiveHeader(name), true, `${name} should be sensitive`);
  for (const name of ["content-type", "user-agent", "accept-language"]) {
    assert.equal(isSensitiveHeader(name), false, `${name} should not be sensitive`);
  }

  const headers = new Headers({
    authorization: "Bearer super-secret",
    cookie: "session=abc123",
    "x-api-key": "sk_live_999",
    "content-type": "application/json",
  });
  const { entries, redacted } = headersToEntries(headers);
  const map = Object.fromEntries(entries);
  assert.equal(map.authorization, "[REDACTED]");
  assert.equal(map.cookie, "[REDACTED]");
  assert.equal(map["x-api-key"], "[REDACTED]");
  assert.equal(map["content-type"], "application/json");
  assert.deepEqual([...redacted].sort(), ["authorization", "cookie", "x-api-key"]);
});

test("headersToEntries keeps values only with explicit opt-in", () => {
  const headers = new Headers({ authorization: "Bearer super-secret" });
  const { entries } = headersToEntries(headers, { storeSensitive: true });
  assert.equal(Object.fromEntries(entries).authorization, "Bearer super-secret");
});

test("analyzeBody classifies JSON, form, text, binary and empty bodies", () => {
  const enc = new TextEncoder();

  const json = analyzeBody(enc.encode('{"a":1}'), "application/json");
  assert.equal(json.kind, "json");
  assert.equal(json.jsonValid, true);

  const brokenJson = analyzeBody(enc.encode("{oops"), "application/json");
  assert.equal(brokenJson.kind, "json");
  assert.equal(brokenJson.jsonValid, false);

  const jsonSniffed = analyzeBody(enc.encode('{"a":1}'), "text/plain");
  assert.equal(jsonSniffed.kind, "json");

  const form = analyzeBody(enc.encode("a=1&b=2"), "application/x-www-form-urlencoded");
  assert.equal(form.kind, "form");
  assert.equal(form.text, "a=1&b=2");

  const text = analyzeBody(enc.encode("hello world"), "text/plain");
  assert.equal(text.kind, "text");

  const binary = analyzeBody(new Uint8Array([0, 159, 146, 150, 255, 0]), "application/octet-stream");
  assert.equal(binary.kind, "binary");
  assert.ok(binary.base64 && binary.base64.length > 0);
  assert.equal(binary.text, null);

  const empty = analyzeBody(new Uint8Array(0), "application/json");
  assert.equal(empty.kind, "empty");
});

test("toBase64 round-trips arbitrary bytes", () => {
  const bytes = new Uint8Array([0, 1, 2, 253, 254, 255]);
  const b64 = toBase64(bytes);
  const decoded = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  assert.deepEqual([...decoded], [...bytes]);
});

test("readBodyWithLimit enforces the byte ceiling even when Content-Length lies", async () => {
  const limit = 10;
  const big = new Request("https://x.test/h/a", { method: "POST", body: "0123456789ABCDEF" });
  const result = await readBodyWithLimit(big, limit);
  assert.equal(result.tooLarge, true);

  const small = new Request("https://x.test/h/a", { method: "POST", body: "12345" });
  const ok = await readBodyWithLimit(small, limit);
  assert.equal(ok.tooLarge, false);
  assert.equal(new TextDecoder().decode(ok.bytes), "12345");
});

test("safeName strips control characters and clamps length", () => {
  assert.equal(safeName("  Stripe \u0000 test  "), "Stripe test");
  assert.equal(safeName(""), "Untitled endpoint");
  assert.equal(safeName(undefined), "Untitled endpoint");
  assert.ok(safeName("x".repeat(200)).length <= 60);
});

test("clampInt keeps configuration inside the allowed band", () => {
  assert.equal(clampInt("15", 10, 100, 50), 15);
  assert.equal(clampInt(5, 10, 100, 50), 10);
  assert.equal(clampInt(500, 10, 100, 50), 100);
  assert.equal(clampInt("abc", 10, 100, 50), 50);
  assert.equal(clampInt(undefined, 10, 100, 50), 50);
});
