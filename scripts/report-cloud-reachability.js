#!/usr/bin/env node
"use strict";

/**
 * Read-only: which top-level apps/cloud/src modules a static import closure reaches, for the phase 4 census
 * (docs/PROPOSAL_TARGET_ARCHITECTURE_2026-10.md). It follows import, export-from, import() and require of relative
 * paths. It does not follow dynamic module names, so an unreached module still needs a per-module check.
 *
 * Usage: node scripts/report-cloud-reachability.js [--markdown]
 */

const { execFileSync } = require("node:child_process");
const { existsSync, readdirSync, readFileSync, statSync } = require("node:fs");
const { dirname, join, relative, resolve } = require("node:path");

const ROOT = process.cwd();
const CLOUD = join(ROOT, "apps", "cloud", "src");
const SPEC = /(?:import|export)[^"'`]*?from\s*["']([^"']+)["']|import\(\s*["']([^"']+)["']\s*\)|require\(\s*["']([^"']+)["']\s*\)/g;
const isTest = (file) => /\.(test|spec|vitest)\.[cm]?[jt]sx?$/.test(file) || /(^|\/)tests?\//.test(file);

function resolveSpec(fromFile, spec) {
  if (!spec.startsWith(".")) return null;
  const base = resolve(dirname(fromFile), spec.replace(/[\\/]dist[\\/]/, "/").replace(/\.js$/, ""));
  for (const candidate of [`${base}.ts`, `${base}.tsx`, join(base, "index.ts"), base]) if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  return null;
}

function closure(starts) {
  const seen = new Set();
  const stack = [...starts];
  while (stack.length > 0) {
    const file = stack.pop();
    if (seen.has(file) || !existsSync(file)) continue;
    seen.add(file);
    const text = readFileSync(file, "utf8");
    for (const match of text.matchAll(SPEC)) {
      const target = resolveSpec(file, match[1] ?? match[2] ?? match[3]);
      if (target !== null && target.startsWith(CLOUD)) stack.push(target);
    }
  }
  return seen;
}

function referencedCloudFiles(paths) {
  const listed = execFileSync("git", ["ls-files", "--", ...paths], { cwd: ROOT, encoding: "utf8" }).split("\n").filter((file) => file && !isTest(file));
  const out = new Set();
  for (const file of listed) {
    const text = readFileSync(join(ROOT, file), "utf8");
    for (const match of text.matchAll(/apps\/cloud\/src\/([A-Za-z0-9_]+)\.(?:js|ts)/g)) out.add(join(CLOUD, `${match[1]}.ts`));
  }
  return out;
}

const modules = readdirSync(CLOUD).filter((name) => name.endsWith(".ts") && !isTest(name)).map((name) => join(CLOUD, name));
const hostEntries = [join(CLOUD, "closedLearningProductionRuntime.ts"), join(CLOUD, "runtime.ts"), ...referencedCloudFiles(["scripts", "deploy", ".github"])];
const productSources = execFileSync("git", ["ls-files", "--", "apps/desktop", "apps/mobile", "apps/autopilot", "packages"], { cwd: ROOT, encoding: "utf8" })
  .split("\n").filter((file) => /\.(ts|tsx|js|mjs|cjs)$/.test(file) && !isTest(file)).map((file) => join(ROOT, file));
const productEntries = [...hostEntries, ...referencedCloudFiles(["apps/desktop", "apps/mobile", "apps/autopilot", "packages"]), ...productSources];
const host = closure(hostEntries);
const product = closure(productEntries);
const rows = modules.map((file) => {
  const name = relative(CLOUD, file);
  const category = host.has(file) ? "HOST" : product.has(file) ? "PRODUCT_SURFACE_KEEP" : /^live/.test(name) ? "LIVE_BOUNDARY_KEEP" : "UNREACHED_CHECK";
  return { name, category };
});
const count = (category) => rows.filter((row) => row.category === category).length;
if (process.argv.includes("--markdown")) {
  for (const row of rows.filter((item) => item.category !== "HOST")) console.log(`| \`${row.name}\` | ${row.category} |`);
} else {
  console.log(JSON.stringify({ modules: modules.length, host: count("HOST"), productSurfaceKeep: count("PRODUCT_SURFACE_KEEP"), liveBoundaryKeep: count("LIVE_BOUNDARY_KEEP"), unreachedCheck: count("UNREACHED_CHECK") }));
}
