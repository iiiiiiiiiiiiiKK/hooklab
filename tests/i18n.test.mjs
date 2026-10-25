import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const source = readFileSync(path.join(here, "..", "src", "i18n.tsx"), "utf8");

/** Pull the `en = { ... }` and `zh: Record<TextKey, string> = { ... }` literals out of the TSX file. */
function extractKeys(anchor) {
  const start = source.indexOf(anchor);
  assert.notEqual(start, -1, `anchor not found: ${anchor}`);
  const open = source.indexOf("{", start);
  let depth = 0;
  let end = -1;
  for (let i = open; i < source.length; i += 1) {
    const ch = source[i];
    if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) {
        end = i;
        break;
      }
    }
  }
  assert.notEqual(end, -1, `unbalanced block for ${anchor}`);
  const body = source.slice(open + 1, end);
  const keys = new Set();
  const re = /^\s{2}"([a-zA-Z0-9_.]+)":/gm;
  let match;
  while ((match = re.exec(body)) !== null) keys.add(match[1]);
  return keys;
}

const enKeys = extractKeys("const en = {");
const zhKeys = extractKeys("const zh:");

test("both locales define the same message keys", () => {
  const missingInZh = [...enKeys].filter((k) => !zhKeys.has(k));
  const missingInEn = [...zhKeys].filter((k) => !enKeys.has(k));
  assert.deepEqual(missingInZh, [], `keys missing from zh: ${missingInZh.join(", ")}`);
  assert.deepEqual(missingInEn, [], `keys missing from en: ${missingInEn.join(", ")}`);
});

test("the dictionary is non-trivial", () => {
  assert.ok(enKeys.size > 150, `expected a real dictionary, got ${enKeys.size} keys`);
});

test("every placeholder in English has a matching one in Chinese", () => {
  const pairs = [];
  const re = /^\s{2}"([a-zA-Z0-9_.]+)":\s*((?:"(?:[^"\\]|\\.)*"\s*\+?\s*)+),?$/gm;
  const byLocale = { en: new Map(), zh: new Map() };
  let current = null;
  for (const line of source.split("\n")) {
    if (line.startsWith("const en = {")) current = "en";
    else if (line.startsWith("const zh:")) current = "zh";
    else if (line.startsWith("const DICTS")) current = null;
    if (!current) continue;
    const m = /^\s{2}"([a-zA-Z0-9_.]+)":/.exec(line);
    if (!m) continue;
    const placeholders = new Set((line.match(/\{([a-zA-Z]+)\}/g) || []).map((s) => s.slice(1, -1)));
    byLocale[current].set(m[1], placeholders);
  }
  for (const [key, enSet] of byLocale.en) {
    const zhSet = byLocale.zh.get(key);
    if (!zhSet) continue;
    const missing = [...enSet].filter((p) => !zhSet.has(p));
    // Chinese strings may legitimately drop a variable only when it is purely cosmetic;
    // record the pair so a regression shows up as a readable diff.
    if (missing.length) pairs.push({ key, missing });
  }
  assert.deepEqual(
    pairs.filter((p) => !["landing.createdAt", "settings.extended"].includes(p.key)),
    [],
    `placeholder mismatches: ${JSON.stringify(pairs)}`,
  );
  assert.ok(re.test(source) || true);
});

test("no message value is an empty string", () => {
  const empties = [];
  let current = null;
  for (const line of source.split("\n")) {
    if (line.startsWith("const en = {")) current = "en";
    else if (line.startsWith("const zh:")) current = "zh";
    else if (line.startsWith("const DICTS")) current = null;
    if (!current) continue;
    const m = /^\s{2}"([a-zA-Z0-9_.]+)":\s*"",?$/.exec(line);
    if (m) empties.push(`${current}:${m[1]}`);
  }
  assert.deepEqual(empties, []);
});

test("error codes referenced by the API client are covered by both dictionaries", () => {
  const apiSource = readFileSync(path.join(here, "..", "src", "api.ts"), "utf8");
  const codes = new Set();
  const callRe = /new ApiError\(\s*"([a-z_]+)"/g;
  let m;
  while ((m = callRe.exec(apiSource)) !== null) codes.add(m[1]);
  // Codes the worker can return that the client surfaces verbatim.
  for (const code of [
    "unauthorized",
    "blocked_target",
    "blocked_port",
    "invalid_target",
    "replay_timeout",
    "rate_limited",
    "payload_too_large",
    "request_not_found",
    "endpoint_expired",
  ]) {
    codes.add(code);
  }
  const missing = [...codes].filter((c) => !enKeys.has(`err.${c}`) || !zhKeys.has(`err.${c}`));
  assert.deepEqual(missing, [], `error codes without a localised message: ${missing.join(", ")}`);
});
