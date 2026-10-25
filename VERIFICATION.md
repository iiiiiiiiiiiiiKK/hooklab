# Verification report — HookLab

All results below were produced against the live deployment
**https://hooklab.852367856.dpdns.org** (Cloudflare Worker `hooklab` + D1 `hooklab-db`), not against a local
mock. Raw JSON evidence: [`screenshots/ui-verification.json`](screenshots/ui-verification.json) and the
suite source in [`tests/`](tests) / [`scripts/verify-ui.mjs`](scripts/verify-ui.mjs).

Date of run: 2026-10-25 · Worker version deployed from `main` · Compatibility date `2025-09-01`.

Continuous integration: [`.github/workflows/ci.yml`](.github/workflows/ci.yml) runs type check, unit tests,
production build and a worker dry-run bundle on every push to `main`. Latest run: **CI #2 — success**.

---

## 1. Build and static checks

| Check | Command | Result |
| --- | --- | --- |
| Dependency install | `npm install` | ✅ 101 packages, no audit errors |
| TypeScript strict build | `npx tsc -b` | ✅ 0 errors (strict, `noUnusedLocals`, `noUncheckedSideEffectImports`) |
| Production build | `npx vite build` | ✅ `dist/` 285.95 kB JS (86.25 kB gzip), 15.96 kB CSS (4.41 kB gzip) |
| Worker bundle | `wrangler deploy` | ✅ 79 KiB upload, 20.25 KiB gzip, 6 ms startup |

## 2. Unit tests (`node --test`)

**19/19 passing**, 0 failing.

| File | Covers |
| --- | --- |
| `tests/ssrf.test.mjs` | IPv4 parsing (dotted/decimal/hex/octal), IPv6 expansion incl. `::ffff:` and NAT64, blocked ranges, scheme/credential/port rejection, single-label hosts, `ALLOWED_REPLAY_HOSTS` |
| `tests/util.test.mjs` | Token & slug entropy (500 unique of each), SHA-256 hashing, sensitive-header redaction, body classification (json/form/text/binary/empty), base64 round-trip, streaming byte cap when `Content-Length` lies, name sanitising, integer clamping |

## 3. End-to-end API verification from a different network

Executed by a temporary Cloudflare Worker (`tests/probe`) so the client runs on Cloudflare's edge — not the
build machine, and not localhost. Four stages, because a single Worker invocation is capped at 50 subrequests.

| Stage | Focus | Result |
| --- | --- | --- |
| 1 | Creation, capture, limits, auth | **10/10** |
| 2 | SSRF / replay-target protection | **18/18** |
| 3 | Replay, export, labelling, deletion | **9/9** |
| 4 | Lifecycle: pause, timeout, redirects | **13/13** |

### 3.1 Capture pipeline (stage 1)

| Test | Observed |
| --- | --- |
| Create endpoint | `201`, `hl_…` token, 16-char slug, `ingestUrl` returned |
| JSON capture | `202` with `seq: 1`, `kind: json` |
| Form capture (`application/x-www-form-urlencoded`, with query string) | `202` |
| Empty-body `GET` | `202` |
| 140 KiB body | `413 payload_too_large` (rejected before buffering) |
| Listing | 3 rows, newest first |
| Header redaction | `authorization`, `cookie`, `x-api-key` → `[REDACTED]` |
| Wrong token | `401 unauthorized` |
| Ingest rate limit (6/min configured) | `429 rate_limited`, `x-ratelimit-remaining: 0` |

### 3.2 SSRF protection (stage 2) — 18/18 blocked

`127.0.0.1`, `localhost`, `[::1]`, `169.254.169.254`, `metadata.google.internal`, `10.0.0.5:8080`,
`192.168.1.1`, `172.16.0.1`, `100.64.0.1`, `0x7f.0.0.1`, `2130706433`, `app.internal`, `file://`,
`gopher://`, `https://user:pass@…`, `example.com:22`, `[::ffff:127.0.0.1]`, `[64:ff9b::7f00:1]` —
all rejected with `400 invalid_target`, `403 blocked_target` or `403 blocked_port`.

Additional redirect-level checks (stage 4):
- `https://httpbin.org/absolute-redirect/2` → `200`, **3 hops**, every hop re-validated.
- `https://httpbin.org/redirect-to?url=http://169.254.169.254/latest/meta-data/` → **`403 blocked_target`**
  (a 302 pointing at the metadata service is refused, not followed).

### 3.3 Replay, export and provenance (stage 3)

| Test | Observed |
| --- | --- |
| Replay to `https://httpbin.org/post` | `200`, target `200`, ~374 ms, 1 hop |
| Unresolvable host | `403 blocked_target` |
| Synthetic request labelled | `origin=synthetic` count 1 vs `origin=captured` count 1 |
| Sanitised export | `200`, 2 910 bytes, contains `[REDACTED]`, contains no plaintext secret |
| Replay history | recorded |
| Delete endpoint | `200`, then ingest `404`, then reads `401` |

### 3.4 Lifecycle (stage 4)

| Test | Observed |
| --- | --- |
| Pause endpoint → ingest | `410 endpoint_expired` (traffic refused while paused) |
| Replay to `https://httpbin.org/delay/20` | `504 replay_timeout` after the 10 s cap |
| Expiry (forced `expires_at` in the past) | ingest `410 endpoint_expired`, list returns **0** rows, endpoint status reported `expired`, and the sweep deleted the row (DB row count `1 → 0`) |

## 4. Browser verification (Playwright, production)

**45/45 checks passing.** Two viewports per run: desktop 1440×900 and iPhone 390×844 (DPR 3, touch, iOS UA).

| Area | Checks | Result |
| --- | --- | --- |
| Layout | No horizontal overflow on landing, inbox, detail, replay, settings — desktop **and** iPhone | ✅ |
| Navigation | Header carries the 𝕏 author link → `https://x.com/0xkillcoin`; mobile nav collapses to icons | ✅ |
| Tap targets | Every `button/a/input/select` ≥ 28 px tall on iPhone | ✅ |
| Inbox | Rows render, `● real request` / `◇ test request` chips both present | ✅ |
| Search | Query narrows the list (4 → 1 row) | ✅ |
| Empty state | "No requests match these filters" | ✅ |
| Filtering | Origin filter isolates the synthetic request (1 row, 1 chip) | ✅ |
| Detail | Redacted header visible (`[REDACTED]`), JSON body prettified (152 chars) | ✅ |
| Copy | Button flips to "Copied" and clipboard contains the `/h/…` URL | ✅ |
| Replay UI | `127.0.0.1:8080` shows `blocked_target` banner; real replay renders a status chip | ✅ |
| Delete | Modal → request removed from the inbox and from the server | ✅ |
| Mobile bodies | Long bodies are scroll-contained (`max-height: 320px`, `overflow-y: auto`) | ✅ |
| Console | Zero console/page errors at both viewports | ✅ |

Screenshots in [`screenshots/`](screenshots) are produced by this run. The settings screenshot has the live
token masked in the DOM before capture.

## 5. Security review

| Item | Status | Evidence |
| --- | --- | --- |
| Token storage | SHA-256 only; 256-bit random; shown once | `worker/util.js`, `worker/store.js` |
| Unauthenticated reads | All endpoint routes require the token | stage 1 "wrong token rejected" |
| Sensitive header redaction | 3/3 redacted in the stored record | stage 1 |
| Redaction in export | `[REDACTED]`, no plaintext secret | stage 3 |
| XSS | React escaping only, no `dangerouslySetInnerHTML`, binaries as base64, `nosniff` | code review of `src/**`, `worker/util.js` |
| Log hygiene | Logs contain only error refs/route/type — no payloads or tokens | `worker/index.js` |
| SSRF matrix | 18 blocked vectors + redirect-to-metadata | stage 2, stage 4 |
| Rate limits | Ingest, replay, creation | stage 1, plus unit-level window tests |
| Body/size quotas | 128 KiB body, 4 MiB/endpoint, request caps | stage 1 |
| Credential handling | No secrets in repo; `.env.example` names only; token masked in screenshots | repo scan |

**Repository secret scan:** `git grep` for `ghp_`, `cfat_`, `AKIA`, `sk_live`, `password=` in tracked files
returns no matches outside the intentional redaction tests and README examples.

## 6. What is *not* verified / known gaps

- The scheduled Cron Trigger (`schedule: 17 */6 * * *`) is registered on the Worker and shares the exact sweep
  function that is exercised inline, but the cron firing itself has not been observed yet (it fires a few times a
  day). Sweep behaviour was verified deterministically by forcing `expires_at` into the past: reads returned 0
  rows, status reported `expired`, and the DB row count went `1 → 0`.
- No load test beyond the rate-limit burst (≈70 requests). Cloudflare free-plan ceiling (100k req/day, 10 ms CPU)
  was not saturated.
- Binary upload is verified by classification and base64 storage in unit tests, not by a browser upload flow.
- WebSocket/SSE is not implemented (polling is the documented design), so no long-connection tests exist.
- Email/notification features do not exist, so nothing to verify there.
