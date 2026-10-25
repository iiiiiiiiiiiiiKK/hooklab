/**
 * Narrow-phone regression check (320 px wide, the smallest width still in real use).
 * Asserts the bilingual header does not overflow and every control remains tappable.
 *
 *   PLAYWRIGHT_PACKAGE=... HOOKLAB_BASE=... node scripts/check-narrow.mjs
 */
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_PACKAGE || "playwright");

const BASE = process.env.HOOKLAB_BASE || "https://hooklab.852367856.dpdns.org";
const results = [];
const log = (name, ok, detail) => {
  results.push({ name, ok: !!ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}`, detail === undefined ? "" : JSON.stringify(detail).slice(0, 300));
};

const browser = await chromium.launch();

for (const lang of ["en", "zh"]) {
  const context = await browser.newContext({
    baseURL: BASE,
    viewport: { width: 320, height: 720 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
  });
  await context.addInitScript((l) => localStorage.setItem("hooklab.lang", l), lang);
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));

  await page.goto("/", { waitUntil: "networkidle" });
  const metrics = await page.evaluate(() => {
    const header = document.querySelector(".topbar-inner");
    const nav = document.querySelector(".topnav");
    return {
      docWidth: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
      headerRight: header ? Math.round(header.getBoundingClientRect().right) : null,
      navRight: nav ? Math.round(nav.getBoundingClientRect().right) : null,
      navScrollWidth: nav ? nav.scrollWidth : null,
      navClientWidth: nav ? nav.clientWidth : null,
    };
  });
  log(`[${lang}] 320px landing has no document overflow`, metrics.scrollWidth <= metrics.docWidth + 1, metrics);
  log(`[${lang}] header stays inside the viewport`, metrics.headerRight !== null && metrics.headerRight <= metrics.docWidth + 1, {
    headerRight: metrics.headerRight,
    docWidth: metrics.docWidth,
  });
  log(`[${lang}] nav does not overflow its own box`, metrics.navScrollWidth <= metrics.navClientWidth + 1, {
    navScrollWidth: metrics.navScrollWidth,
    navClientWidth: metrics.navClientWidth,
  });

  const xVisible = await page.locator("a.x-link").isVisible();
  log(`[${lang}] X link still visible at 320px`, xVisible);

  const smallTargets = await page.evaluate(() => {
    const small = [];
    for (const el of document.querySelectorAll("button, a, input, select")) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      if (r.height < 28) {
        small.push({
          tag: el.tagName.toLowerCase(),
          cls: (el.className || "").toString().slice(0, 40),
          h: Math.round(r.height),
        });
      }
    }
    return small.slice(0, 8);
  });
  log(`[${lang}] tap targets >= 28px at 320px`, smallTargets.length === 0, smallTargets);

  const zhApplied = await page.evaluate(() => document.documentElement.getAttribute("data-lang"));
  log(`[${lang}] data-lang is applied before first paint`, zhApplied === lang, { dataLang: zhApplied });
  log(`[${lang}] no page errors`, errors.length === 0, errors);

  await page.screenshot({ path: `screenshots/narrow-320-${lang}.png` });
  await context.close();
}

await browser.close();
const passed = results.filter((r) => r.ok).length;
console.log(`\n${passed}/${results.length} narrow-viewport checks passed`);
process.exit(passed === results.length ? 0 : 1);
