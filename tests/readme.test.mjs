import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, "..");

const read = (file) => readFileSync(path.join(root, file), "utf8");

const en = read("README.md");
const zh = read("README.zh-CN.md");

/** Collect level-2 headings, ignoring fenced code blocks. */
function h2s(markdown) {
  const out = [];
  let fenced = false;
  for (const line of markdown.split("\n")) {
    if (line.trimStart().startsWith("```")) {
      fenced = !fenced;
      continue;
    }
    if (fenced) continue;
    const match = /^##\s+(.+?)\s*$/.exec(line);
    if (match) out.push(match[1].trim());
  }
  return out;
}

/** Count the rows of a markdown table that follows a given heading. */
function tableRowsAfter(markdown, heading) {
  const lines = markdown.split("\n");
  const start = lines.findIndex((l) => l.trim() === `## ${heading}`);
  if (start === -1) return -1;
  let rows = 0;
  let inTable = false;
  for (let i = start + 1; i < lines.length; i += 1) {
    const line = lines[i];
    if (/^##\s/.test(line)) break;
    if (line.trim().startsWith("|")) {
      inTable = true;
      if (!/^\|[\s|:-]+\|$/.test(line.trim())) rows += 1;
    } else if (inTable && line.trim() === "") {
      break;
    }
  }
  return rows; // includes the header row
}

test("README has a Chinese counterpart and both cross-link", () => {
  assert.match(en, /README\.zh-CN\.md/, "English README must link to the Chinese one");
  assert.match(zh, /README\.md/, "Chinese README must link back to the English one");
  assert.ok(en.slice(0, 400).includes("简体中文"), "language switch must sit above the title");
  assert.ok(zh.slice(0, 400).includes("English"), "language switch must sit above the title");
});

test("both READMEs document the same top-level sections", () => {
  const enSections = h2s(en);
  const zhSections = h2s(zh);
  assert.equal(
    enSections.length,
    zhSections.length,
    `section count differs — en: ${enSections.join(" | ")} // zh: ${zhSections.join(" | ")}`,
  );
  // Order must match too, so the documents read as parallel translations.
  assert.deepEqual(
    enSections.map((_, i) => i),
    zhSections.map((_, i) => i),
  );
});

test("the English section list matches the table of contents", () => {
  const sections = h2s(en).map((s) => s.toLowerCase());
  const toc = en
    .split("\n")
    .filter((l) => /^- \[.+\]\(#.+\)$/.test(l))
    .map((l) => l.replace(/^- \[(.+)\]\(#.+\)$/, "$1").toLowerCase());
  for (const entry of toc) {
    assert.ok(sections.includes(entry), `TOC entry "${entry}" has no matching ## heading`);
  }
});

test("the Chinese section list matches its table of contents", () => {
  const sections = h2s(zh).map((s) => s.toLowerCase());
  const toc = zh
    .split("\n")
    .filter((l) => /^- \[.+\]\(#.+\)$/.test(l))
    .map((l) => l.replace(/^- \[(.+)\]\(#.+\)$/, "$1").toLowerCase());
  for (const entry of toc) {
    assert.ok(sections.includes(entry), `中文目录项 "${entry}" 没有对应的 ## 标题`);
  }
});

test("both READMEs carry the live URL, the X author link and the MIT license", () => {
  for (const [label, text] of [
    ["en", en],
    ["zh", zh],
  ]) {
    assert.match(text, /https:\/\/hooklab\.852367856\.dpdns\.org/, `${label}: live URL missing`);
    assert.match(text, /https:\/\/x\.com\/0xkillcoin/, `${label}: author X link missing`);
    assert.match(text, /MIT/, `${label}: license missing`);
    assert.match(text, /\/h\/:slug/, `${label}: ingest route missing`);
  }
});

test("retention and security tables are the same size in both languages", () => {
  for (const [enHeading, zhHeading] of [
    ["Data retention rules", "数据保留规则"],
    ["Security model", "安全模型"],
  ]) {
    const enRows = tableRowsAfter(en, enHeading);
    const zhRows = tableRowsAfter(zh, zhHeading);
    assert.ok(enRows > 3, `${enHeading} table looks empty (${enRows} rows)`);
    assert.equal(zhRows, enRows, `${zhHeading} table has ${zhRows} rows, ${enHeading} has ${enRows}`);
  }
});

test("screenshots referenced by either README exist on disk", () => {
  for (const [label, text] of [
    ["en", en],
    ["zh", zh],
  ]) {
    const refs = [...text.matchAll(/\]\((screenshots\/[^)]+)\)/g)].map((m) => m[1]);
    assert.ok(refs.length >= 6, `${label}: expected several screenshot references, found ${refs.length}`);
    for (const ref of refs) {
      assert.doesNotThrow(() => readFileSync(path.join(root, ref)), `${label}: missing ${ref}`);
    }
  }
});

test("every file named in the project-structure block exists", () => {
  const block = en.split("```")[en.split("```").findIndex((chunk) => chunk.includes("hooklab/\n├── src/"))];
  assert.ok(block, "project structure block not found");
  const entries = block
    .split("\n")
    .map((line) => line.replace(/^[│├└─\s]+/, "").trim())
    .filter((line) => line && !line.startsWith("hooklab/") && line.includes("/") === false)
    .map((line) => line.split(/\s+#/)[0].trim())
    .filter((line) => /^[\w.-]+$/.test(line) || /^[\w.-]+\/?$/.test(line));
  const mustExist = entries.filter((e) => e.includes(".") || e.endsWith("/"));
  for (const entry of mustExist) {
    const clean = entry.replace(/\/$/, "");
    const candidates = [clean, path.join("src", clean), path.join("worker", clean), path.join("scripts", clean), path.join("tests", clean)];
    const found = candidates.some((c) => {
      try {
        readFileSync(path.join(root, c));
        return true;
      } catch {
        return false;
      }
    });
    assert.ok(found, `project structure lists "${entry}" but no such file exists`);
  }
});

test("documented environment variables are real", () => {
  const code = ["worker/index.js", "worker/store.js", "worker/ssrf.js", "worker/util.js"]
    .map((f) => read(f))
    .join("\n") + read("wrangler.jsonc");
  const envSection = en.split("## Environment variables")[1].split("\n## ")[0];
  const names = [...envSection.matchAll(/^\|\s*`([A-Z][A-Z0-9_]+)`\s*\|/gm)].map((m) => m[1]);
  assert.ok(names.length >= 4, `expected several documented env vars, found ${names.length}`);
  for (const name of names) {
    assert.ok(code.includes(name), `environment variable ${name} is documented but never read`);
  }
});

test("the Chinese README documents the same environment variables", () => {
  const pick = (text) => {
    const block = text.split(/^## (?:Environment variables|环境变量)$/m)[1] ?? "";
    return [...block.matchAll(/^\|\s*`([A-Z][A-Z0-9_]+)`\s*\|/gm)].map((m) => m[1]).sort();
  };
  assert.deepEqual(pick(zh), pick(en));
});

