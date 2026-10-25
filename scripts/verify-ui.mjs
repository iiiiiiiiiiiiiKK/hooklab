/**
 * Browser verification + screenshots for the live HookLab deployment.
 *
 * Usage (from the repo root, with Playwright installed somewhere on the machine):
 *   PLAYWRIGHT_PATH=C:/path/to/node_modules/playwright node scripts/verify-ui.mjs
 *
 * Checks desktop (1440x900) and iPhone (390x844, DPR 3, touch) for:
 *   - horizontal overflow / elements wider than the viewport
 *   - tap-target sizes and nav collapse
 *   - real capture → inbox → detail → replay flows through the public API
 * and writes screenshots into ./screenshots/.
 */
import { createRequire } from "node:module";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const require = createRequire(import.meta.url);
const playwrightPath =
  process.env.PLAYWRIGHT_PATH || path.join(process.env.LOCALAPPDATA || "", "ms-playwright");
let chromium;
try {
  ({ chromium } = require(process.env.PLAYWRIGHT_PACKAGE || "playwright"));
} catch {
  console.error("Playwright not resolvable. Set PLAYWRIGHT_PACKAGE to the playwright package path.");
  process.exit(1);
}

const BASE = process.env.HOOKLAB_BASE || "https://hooklab.852367856.dpdns.org";
const OUT = "screenshots";
const results = [];
const log = (name, ok, detail) => {
  results.push({ name, ok: !!ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}`, detail === undefined ? "" : JSON.stringify(detail).slice(0, 400));
};

await mkdir(OUT, { recursive: true });

async function api(pathname, { method = "GET", token, body } = {}) {
  const headers = {};
  if (token) headers["x-hooklab-token"] = token;
  if (body !== undefined) headers["content-type"] = "application/json";
  const res = await fetch(BASE + pathname, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* ignore */
  }
  return { status: res.status, json, text };
}

// ---------------------------------------------------------------- seed data
async function seedEndpoint(label) {
  const created = await api("/api/endpoints", {
    method: "POST",
    body: { name: `Stripe checkout staging (${label})`, ttlMinutes: 1440, maxRequests: 200, retentionMinutes: 60 },
  });
  if (created.status !== 201) throw new Error(`seed failed: ${created.status} ${created.text.slice(0, 200)}`);
  const { endpoint, token, ingestUrl } = created.json;

  await fetch(ingestUrl, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: "Bearer sk_live_do_not_leak", "x-api-key": "pk_test_abc" },
    body: JSON.stringify(
      { id: "evt_1P9", type: "checkout.session.completed", data: { object: { amount_total: 4999, currency: "usd" } } },
      null,
      2,
    ),
  });
  await fetch(`${ingestUrl}?source=dashboard&retry=0`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: "event=invoice.paid&amount=1299&customer=cus_H8",
  });
  await fetch(ingestUrl, { method: "GET", headers: { "user-agent": "Stripe/1.0 (health ping)" } });
  await api(`/api/endpoints/${endpoint.id}/test-request`, {
    method: "POST",
    token,
    body: { method: "POST", contentType: "application/json", body: '{"event":"hooklab.test"}' },
  });
  const list = await api(`/api/endpoints/${endpoint.id}/requests`, { token });
  const jsonRow = list.json?.requests?.find((r) => r.kind === "json" && r.origin === "captured");
  log(`[${label}] seed data captured`, (list.json?.requests?.length ?? 0) === 4, { count: list.json?.requests?.length });
  return { endpoint, token, ingestUrl, jsonRow };
}

// ------------------------------------------------------------------ browser
const browser = await chromium.launch();

async function newPage(contextOptions, seed) {
  const { endpoint, token } = seed;
  const context = await browser.newContext({ baseURL: BASE, ...contextOptions });
  // Pre-seed the local session exactly like the app does after creation.
  await context.addInitScript(
    ([id, tok, name]) => {
      localStorage.setItem(
        "hooklab.sessions.v1",
        JSON.stringify({ [id]: { id, token: tok, name, ingestUrl: `${location.origin}/h/${id}`, createdAt: Date.now() } }),
      );
    },
    [endpoint.id, token, endpoint.name],
  );
  const page = await context.newPage();
  const consoleErrors = [];
  const expected = { blockedRequests: 0 };
  page.on("console", (msg) => {
    if (msg.type() !== "error") return;
    const text = msg.text();
    // A deliberate blocked replay produces an expected 403 from our own API;
    // the browser logs it as a failed resource load.
    if (expected.blockedRequests > 0 && /Failed to load resource.*40[0-9]/.test(text)) {
      expected.blockedRequests -= 1;
      return;
    }
    consoleErrors.push(text);
  });
  page.on("pageerror", (err) => consoleErrors.push(`pageerror: ${err.message}`));
  return { context, page, consoleErrors, expected };
}

async function overflowCheck(page) {
  return page.evaluate(() => {
    const docWidth = document.documentElement.clientWidth;
    const inScrollBox = (el) => {
      let node = el.parentElement;
      while (node && node !== document.body) {
        const s = getComputedStyle(node);
        if (/(auto|scroll|hidden)/.test(`${s.overflowX}${s.overflow}`)) return true;
        node = node.parentElement;
      }
      return false;
    };
    const bad = [];
    for (const el of document.querySelectorAll("body *")) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) continue;
      if (r.right > docWidth + 1.5 || r.left < -1.5) {
        const style = getComputedStyle(el);
        if (style.position === "fixed") continue;
        if (inScrollBox(el)) continue;
        bad.push({
          tag: el.tagName.toLowerCase(),
          cls: (el.className || "").toString().slice(0, 60),
          right: Math.round(r.right),
          left: Math.round(r.left),
        });
      }
    }
    return {
      docWidth,
      scrollWidth: document.documentElement.scrollWidth,
      bodyScrollWidth: document.body.scrollWidth,
      offenders: bad.slice(0, 8),
    };
  });
}

const viewports = [
  { label: "desktop", options: { viewport: { width: 1440, height: 900 } } },
  {
    label: "iphone",
    options: {
      viewport: { width: 390, height: 844 },
      deviceScaleFactor: 3,
      isMobile: true,
      hasTouch: true,
      userAgent:
        "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1",
    },
  },
];

for (const vp of viewports) {
  const seed = await seedEndpoint(vp.label);
  const { endpoint, token, jsonRow } = seed;
  const { context, page, consoleErrors, expected } = await newPage(vp.options, seed);

  await page.goto("/", { waitUntil: "networkidle" });
  const home = await overflowCheck(page);
  log(`[${vp.label}] landing has no horizontal overflow`, home.scrollWidth <= home.docWidth + 1, home);
  await page.screenshot({ path: `${OUT}/${vp.label}-1-landing.png`, fullPage: false });

  const xLink = await page.getAttribute("a.x-link", "href");
  log(`[${vp.label}] X author link present in header`, xLink === "https://x.com/0xkillcoin", { href: xLink });

  await page.goto(`/e/${endpoint.id}`, { waitUntil: "networkidle" });
  await page.waitForSelector(".inbox-row", { timeout: 15000 });
  const inbox = await overflowCheck(page);
  log(`[${vp.label}] inbox has no horizontal overflow`, inbox.scrollWidth <= inbox.docWidth + 1, inbox);
  const rowCount = await page.locator(".inbox-row").count();
  log(`[${vp.label}] inbox renders captured requests`, rowCount >= 3, { rowCount });
  const capturedChip = await page.locator(".chip-captured").count();
  const syntheticChip = await page.locator(".chip-synthetic").count();
  log(`[${vp.label}] captured vs synthetic labelled`, capturedChip >= 1 && syntheticChip >= 1, { capturedChip, syntheticChip });
  await page.screenshot({ path: `${OUT}/${vp.label}-2-inbox.png`, fullPage: false });

  // open the JSON request detail
  await page.goto(`/e/${endpoint.id}/r/${jsonRow.id}`, { waitUntil: "networkidle" });
  await page.waitForSelector(".kv", { timeout: 15000 });
  const detail = await overflowCheck(page);
  log(`[${vp.label}] request detail has no horizontal overflow`, detail.scrollWidth <= detail.docWidth + 1, detail);
  const redactedVisible = await page.locator("text=[REDACTED]").count();
  log(`[${vp.label}] redacted header is visible in the UI`, redactedVisible >= 1, { redactedVisible });
  const bodyText = await page.locator("pre.code-block").first().innerText();
  log(`[${vp.label}] JSON body rendered formatted`, bodyText.includes("checkout.session.completed"), {
    chars: bodyText.length,
  });
  await page.screenshot({ path: `${OUT}/${vp.label}-3-request-detail.png`, fullPage: false });

  // replay page: SSRF rejection in the real UI
  await page.goto(`/e/${endpoint.id}/replay/${jsonRow.id}`, { waitUntil: "networkidle" });
  await page.fill('input[type="url"]', "http://127.0.0.1:8080/admin");
  expected.blockedRequests += 1;
  await page.click('button[type="submit"]');
  await page.waitForSelector(".banner-error", { timeout: 20000 });
  const ssrfBanner = await page.locator(".banner-error").first().innerText();
  log(`[${vp.label}] SSRF target rejected in the UI`, /blocked|private|loopback/i.test(ssrfBanner), {
    banner: ssrfBanner.slice(0, 160),
  });
  const replayOverflow = await overflowCheck(page);
  log(`[${vp.label}] replay page has no horizontal overflow`, replayOverflow.scrollWidth <= replayOverflow.docWidth + 1, replayOverflow);
  await page.screenshot({ path: `${OUT}/${vp.label}-4-replay.png`, fullPage: false });

  // a real replay through the UI against a public echo service
  await page.fill('input[type="url"]', "https://httpbin.org/post");
  await page.click('button[type="submit"]');
  await page.waitForSelector("text=Response headers", { timeout: 40000 }).catch(() => {});
  const hasResult = await page.locator(".chip.tone-ok, .chip.tone-bad").count();
  log(`[${vp.label}] replay result rendered`, hasResult >= 1, { hasResult });
  await page.screenshot({ path: `${OUT}/${vp.label}-5-replay-result.png`, fullPage: false });

  await page.goto(`/e/${endpoint.id}/settings`, { waitUntil: "networkidle" });
  const settingsOverflow = await overflowCheck(page);
  log(`[${vp.label}] settings has no horizontal overflow`, settingsOverflow.scrollWidth <= settingsOverflow.docWidth + 1, settingsOverflow);
  // Never publish a real token in a screenshot, even a throwaway one.
  await page.evaluate(() => {
    for (const el of document.querySelectorAll(".code-block")) {
      if (el.textContent && el.textContent.trim().startsWith("hl_")) {
        el.textContent = "hl_•••••••••••••••••••••••••••••••••••••••••••";
      }
    }
  });
  await page.screenshot({ path: `${OUT}/${vp.label}-6-settings.png`, fullPage: false });

  // mobile-only: tap target and nav checks
  if (vp.label === "iphone") {
    const tapTargets = await page.evaluate(() => {
      const small = [];
      for (const el of document.querySelectorAll("button, a, input, select")) {
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) continue;
        if (r.height < 28 || r.width < 24) {
          small.push({ tag: el.tagName.toLowerCase(), cls: (el.className || "").toString().slice(0, 40), h: Math.round(r.height), w: Math.round(r.width) });
        }
      }
      return small.slice(0, 10);
    });
    log(`[${vp.label}] all tap targets >= 28px tall`, tapTargets.length === 0, tapTargets);

    const navLabelsHidden = await page.evaluate(() => {
      const label = document.querySelector(".topnav .nav-label");
      if (!label) return true;
      return getComputedStyle(label).display === "none";
    });
    log(`[${vp.label}] top nav collapses to icons`, navLabelsHidden);

    // Long body collapses instead of overflowing the phone viewport.
    await page.goto(`/e/${endpoint.id}/r/${jsonRow.id}`, { waitUntil: "networkidle" });
    const codeBox = await page.evaluate(() => {
      const el = document.querySelector("pre.code-block");
      if (!el) return null;
      const s = getComputedStyle(el);
      return { maxHeight: s.maxHeight, overflowY: s.overflowY, scrolls: el.scrollHeight > el.clientHeight + 2 };
    });
    log(`[${vp.label}] long bodies are scroll-contained`, !!codeBox && codeBox.overflowY === "auto", codeBox);
  }

  // shared interaction checks (latency from CN to the edge is non-trivial, so poll instead of sleeping)
  await page.goto(`/e/${endpoint.id}`, { waitUntil: "networkidle" });
  await page.waitForSelector(".inbox-row", { timeout: 15000 });
  const beforeSearch = await page.locator(".inbox-row").count();

  await page.fill('input[type="search"]', "checkout.session");
  const searchSettled = await page
    .waitForFunction((before) => document.querySelectorAll(".inbox-row").length < before, beforeSearch, { timeout: 20000 })
    .then(() => true)
    .catch(() => false);
  const afterSearch = await page.locator(".inbox-row").count();
  log(`[${vp.label}] inbox search filters the list`, searchSettled && afterSearch >= 1, { beforeSearch, afterSearch });

  await page.fill('input[type="search"]', "zzz-no-such-payload");
  const emptyShown = await page
    .waitForSelector(".empty h3", { timeout: 20000 })
    .then((h) => h.innerText())
    .catch(() => "");
  log(`[${vp.label}] empty search state shown`, /no requests match/i.test(emptyShown), { emptyShown });

  await page.fill('input[type="search"]', "");
  await page.waitForFunction(() => document.querySelectorAll(".inbox-row").length > 0, null, { timeout: 20000 }).catch(() => {});

  const originSelect = page.locator('select[aria-label="Filter by origin"]');
  await originSelect.selectOption("synthetic");
  const originSettled = await page
    .waitForFunction(() => document.querySelectorAll(".inbox-row").length === 1, null, { timeout: 20000 })
    .then(() => true)
    .catch(() => false);
  const synthRows = await page.locator(".inbox-row").count();
  const synthOnly = await page.locator(".chip-synthetic").count();
  log(`[${vp.label}] origin filter isolates synthetic requests`, originSettled && synthRows === 1 && synthOnly === 1, {
    synthRows,
    synthOnly,
  });
  await originSelect.selectOption("");
  await page.waitForFunction(() => document.querySelectorAll(".inbox-row").length > 1, null, { timeout: 20000 }).catch(() => {});

  // copy button
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]).catch(() => {});
  const copyBtn = page.locator('button[aria-label="Copy URL"], button:has-text("Copy URL")').first();
  await copyBtn.click();
  const copyLabel = await page
    .waitForFunction(
      () => {
        const btn = [...document.querySelectorAll("button")].find((b) => /copy url/i.test(b.getAttribute("aria-label") || ""));
        return btn && /copied|failed/i.test(btn.innerText) ? btn.innerText : null;
      },
      null,
      { timeout: 5000 },
    )
    .then((h) => h.jsonValue())
    .catch(() => copyBtn.innerText());
  log(`[${vp.label}] copy URL gives feedback`, /copied|failed/i.test(copyLabel), { copyLabel });
  const clipboard = await page.evaluate(() => navigator.clipboard.readText().catch(() => "")).catch(() => "");
  log(`[${vp.label}] copied value is the ingest URL`, typeof clipboard === "string" && clipboard.includes("/h/"), {
    sample: String(clipboard).slice(0, 48),
  });

  // delete a request through the UI
  await page.goto(`/e/${endpoint.id}/r/${jsonRow.id}`, { waitUntil: "networkidle" });
  await page.click('button:has-text("Delete")');
  await page.waitForSelector(".modal", { timeout: 8000 });
  await page.click('button:has-text("Delete request")');
  await page.waitForTimeout(1800);
  const urlAfterDelete = page.url();
  log(`[${vp.label}] deleting a request returns to the inbox`, /\/e\/[^/]+$/.test(new URL(urlAfterDelete).pathname), {
    path: new URL(urlAfterDelete).pathname,
  });
  const listAfterDelete = await api(`/api/endpoints/${endpoint.id}/requests`, { token });
  log(`[${vp.label}] deleted request is gone server-side`, !listAfterDelete.json.requests.some((r) => r.id === jsonRow.id), {
    remaining: listAfterDelete.json.requests.length,
  });

  log(`[${vp.label}] no console errors`, consoleErrors.length === 0, consoleErrors.slice(0, 4));
  await context.close();
  await api(`/api/endpoints/${endpoint.id}`, { method: "DELETE", token });
}

await browser.close();

const passed = results.filter((r) => r.ok).length;
await writeFile(`${OUT}/ui-verification.json`, JSON.stringify({ base: BASE, passed, total: results.length, results }, null, 2));
console.log(`\n${passed}/${results.length} UI checks passed`);
process.exit(passed === results.length ? 0 : 1);
