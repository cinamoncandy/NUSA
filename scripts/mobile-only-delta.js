#!/usr/bin/env node
"use strict";
/**
 * Classifies a set of changed files as MOBILE_ONLY (the running PAPER server cannot have changed
 * behaviour) or SERVER_AFFECTING. Fail closed: anything not positively known to be presentation-only
 * is SERVER_AFFECTING.
 *
 * Some server code imports files that live under apps/mobile/src (capital allocation and withdrawal
 * protection). Those files, and everything they import, are server code and are never MOBILE_ONLY.
 * They are found by tracing relative imports from every non-mobile source file, so a new server import
 * of a mobile file is picked up automatically.
 *
 * Usage: node scripts/mobile-only-delta.js [--root DIR] < changed-files.txt   (one path per line)
 * Prints MOBILE_ONLY or SERVER_AFFECTING (plus the first offending paths) and exits 0 either way.
 */
const fs = require("node:fs");
const path = require("node:path");

const SOURCE = /\.(?:ts|tsx|js|mjs|cjs)$/;
const IMPORT = /(?:from\s+|import\s*\(\s*|require\s*\(\s*|import\s+)["']([^"']+)["']/g;
const SKIP_DIRS = new Set(["node_modules", ".git", "dist", "build", "android", "ios", ".expo"]);
// Presentation-only or non-shipping paths. Everything else is SERVER_AFFECTING.
const NON_SERVER = [/^apps\/mobile\//, /^tests\/(?:mobile|uiux)[^/]*\.test\.js$/, /^\.aipos\//, /^docs\//];

function walk(dir, root, out) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    if (SKIP_DIRS.has(e.name)) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full, root, out);
    else if (SOURCE.test(e.name)) out.push(path.relative(root, full).split(path.sep).join("/"));
  }
  return out;
}

function resolveImport(fromRel, spec, root) {
  if (!spec.startsWith(".")) return null;
  const base = path.posix.normalize(path.posix.join(path.posix.dirname(fromRel), spec));
  for (const cand of [base, `${base}.ts`, `${base}.tsx`, `${base}.js`, `${base}.mjs`, `${base}/index.ts`, `${base}/index.tsx`, `${base}/index.js`]) {
    if (fs.existsSync(path.join(root, cand)) && fs.statSync(path.join(root, cand)).isFile()) return cand;
  }
  return null;
}

function importsOf(rel, root) {
  let text;
  try { text = fs.readFileSync(path.join(root, rel), "utf8"); } catch { return []; }
  const found = [];
  for (const m of text.matchAll(IMPORT)) { const r = resolveImport(rel, m[1], root); if (r) found.push(r); }
  // A script or server file may load the compiled copy (dist/apps/mobile/...js); that depends on the mobile source file.
  for (const m of text.matchAll(/dist\/apps\/mobile\/([^"'`\s]+?)\.js/g)) {
    for (const ext of [".ts", ".tsx"]) if (fs.existsSync(path.join(root, "apps/mobile", `${m[1]}${ext}`))) found.push(`apps/mobile/${m[1]}${ext}`);
  }
  return found;
}

/** Files under apps/mobile that non-mobile code reaches through relative imports (transitively). */
function serverReachableMobileFiles(root) {
  const all = ["apps", "scripts", "deploy"].flatMap((d) => walk(path.join(root, d), root, []));
  const reached = new Set();
  const queue = [];
  for (const f of all) {
    if (f.startsWith("apps/mobile/")) continue;
    for (const dep of importsOf(f, root)) if (dep.startsWith("apps/mobile/") && !reached.has(dep)) { reached.add(dep); queue.push(dep); }
  }
  while (queue.length) {
    const f = queue.pop();
    for (const dep of importsOf(f, root)) if (!reached.has(dep)) { reached.add(dep); queue.push(dep); }
  }
  return reached;
}

function classifyChangedFiles(files, root) {
  const reachable = serverReachableMobileFiles(root);
  const offending = [];
  for (const raw of files) {
    const f = String(raw).trim().replace(/^\.\//, "");
    if (f === "") continue;
    const nonServer = NON_SERVER.some((re) => re.test(f)) && !f.includes("..") && !reachable.has(f);
    if (!nonServer) offending.push(f);
  }
  return { status: offending.length === 0 && files.some((f) => String(f).trim() !== "") ? "MOBILE_ONLY" : "SERVER_AFFECTING", offending };
}

module.exports = { classifyChangedFiles, serverReachableMobileFiles };

if (require.main === module) {
  const args = process.argv.slice(2);
  const root = path.resolve(args[args.indexOf("--root") + 1] || ".");
  const files = fs.readFileSync(0, "utf8").split("\n");
  const { status, offending } = classifyChangedFiles(files, args.includes("--root") ? root : path.resolve("."));
  console.log(status);
  for (const f of offending.slice(0, 10)) console.log(`  ${f}`);
}
