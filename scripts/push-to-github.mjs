/**
 * Push the current working tree to GitHub using the REST API (contents/tree/commit/ref).
 *
 * The build machine cannot always reach github.com over git+HTTPS, but the API is reachable,
 * so this script mirrors `git push` semantics: it uploads every tracked file as a blob,
 * builds a tree, commits it on top of the current branch head and moves the ref.
 *
 * Usage:
 *   GH_TOKEN=... REPO_ROOT=... GITHUB_REPO=owner/name BRANCH=main COMMIT_MESSAGE="..." \
 *     node scripts/push-to-github.mjs
 */

import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";

const TOKEN = process.env.GH_TOKEN;
const REPO = process.env.GITHUB_REPO || "iiiiiiiiiiiiiKK/hooklab";
const BRANCH = process.env.BRANCH || "main";
const ROOT = process.env.REPO_ROOT || process.cwd();
const MESSAGE = process.env.COMMIT_MESSAGE || "chore: update";

if (!TOKEN) {
  console.error("GH_TOKEN is required (a token with repo scope).");
  process.exit(1);
}

async function gh(p, opts = {}) {
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const res = await fetch(`https://api.github.com${p}`, {
        ...opts,
        headers: {
          Authorization: `Bearer ${TOKEN}`,
          "User-Agent": "hooklab-publisher",
          Accept: "application/vnd.github+json",
          "Content-Type": "application/json",
          ...(opts.headers || {}),
        },
      });
      const text = await res.text();
      let body;
      try {
        body = JSON.parse(text);
      } catch {
        body = text;
      }
      if (res.status >= 500 || res.status === 429) {
        await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
        continue;
      }
      return { status: res.status, body };
    } catch (err) {
      if (attempt === 4) throw err;
      await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
    }
  }
  throw new Error("unreachable");
}

const files = execFileSync("git", ["ls-files"], { cwd: ROOT, encoding: "utf8" })
  .trim()
  .split("\n")
  .filter(Boolean);

const head = await gh(`/repos/${REPO}/commits/${BRANCH}`);
if (head.status !== 200) {
  console.error(`cannot read ${BRANCH}: ${head.status}`);
  process.exit(1);
}

const entries = [];
for (const [index, file] of files.entries()) {
  const content = readFileSync(path.join(ROOT, file)).toString("base64");
  const blob = await gh(`/repos/${REPO}/git/blobs`, {
    method: "POST",
    body: JSON.stringify({ content, encoding: "base64" }),
  });
  if (blob.status !== 201) {
    console.error(`blob upload failed for ${file}: ${blob.status}`);
    process.exit(1);
  }
  entries.push({ path: file.replace(/\\/g, "/"), mode: "100644", type: "blob", sha: blob.body.sha });
  if ((index + 1) % 10 === 0 || index + 1 === files.length) console.log(`uploaded ${index + 1}/${files.length}`);
}

const tree = await gh(`/repos/${REPO}/git/trees`, {
  method: "POST",
  body: JSON.stringify({ tree: entries }),
});
if (tree.status !== 201) {
  console.error(`tree creation failed: ${tree.status}`);
  process.exit(1);
}

const commit = await gh(`/repos/${REPO}/git/commits`, {
  method: "POST",
  body: JSON.stringify({ message: MESSAGE, tree: tree.body.sha, parents: [head.body.sha] }),
});
if (commit.status !== 201) {
  console.error(`commit failed: ${commit.status}`);
  process.exit(1);
}

const ref = await gh(`/repos/${REPO}/git/refs/heads/${BRANCH}`, {
  method: "PATCH",
  body: JSON.stringify({ sha: commit.body.sha, force: false }),
});
if (ref.status !== 200) {
  console.error(`ref update failed: ${ref.status} ${JSON.stringify(ref.body).slice(0, 200)}`);
  process.exit(1);
}

console.log(`pushed ${files.length} files -> ${REPO}@${BRANCH} ${commit.body.sha.slice(0, 10)}`);
