#!/usr/bin/env node
"use strict";
// Reproducible repository measurements used by docs/NUSA_REDESIGN_PROPOSAL_2026-11-15.md. Every number states its scope. Read-only; prints JSON.
// Run: node scripts/measure-repo-facts.js
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const SKIP_DIRS = new Set(["node_modules", ".git", "dist", "build", ".expo", "android", "ios", "coverage"]);

function walk(dir, visit) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) { if (!SKIP_DIRS.has(entry.name)) walk(full, visit); } else if (entry.isFile()) visit(full);
  }
}
const rel = (f) => path.relative(root, f).split(path.sep).join("/");
const lines = (f) => { const t = fs.readFileSync(f, "utf8"); return t.length === 0 ? 0 : t.split("\n").length - (t.endsWith("\n") ? 1 : 0); };
const isSource = (f) => /\.(ts|tsx)$/.test(f) && !/\.d\.ts$/.test(f) && !/\.(test|spec)\.(ts|tsx)$/.test(f);

function sourceLines(prefixes) {
  const perApp = {};
  let total = 0;
  for (const prefix of prefixes) {
    let sum = 0; let files = 0;
    walk(path.join(root, prefix), (f) => { if (isSource(f)) { sum += lines(f); files += 1; } });
    perApp[prefix] = { files, lines: sum };
    total += sum;
  }
  return { total, perApp };
}

const apps = fs.readdirSync(path.join(root, "apps")).map((d) => `apps/${d}`);
const packages = fs.readdirSync(path.join(root, "packages")).map((d) => `packages/${d}`);

const workflows = fs.readdirSync(path.join(root, ".github", "workflows")).filter((f) => /\.ya?ml$/.test(f)).length;

const nusaRefs = new Set();
let cloudSourceFiles = 0;
walk(path.join(root, "apps", "cloud", "src"), (f) => {
  if (!isSource(f)) return;
  cloudSourceFiles += 1;
  for (const m of fs.readFileSync(f, "utf8").matchAll(/\bNUSA_[A-Z0-9_]+\b/g)) nusaRefs.add(m[0]);
});

let woAll = 0; let woArchive = 0;
walk(path.join(root, ".aipos", "work-orders"), (f) => { if (/\.ya?ml$/.test(f)) { woAll += 1; if (rel(f).includes("/archive/")) woArchive += 1; } });

let testFilesAll = 0; let testFilesNamed = 0;
walk(path.join(root, "tests"), (f) => { testFilesAll += 1; if (/\.(test|spec)\.[cm]?[jt]sx?$/.test(f)) testFilesNamed += 1; });

const out = {
  scope: "origin/main working tree; node_modules, dist, build and generated platform folders excluded; .d.ts and *.test.ts(x)/*.spec.ts(x) excluded from source counts",
  workflows,
  typescriptSourceLines: { apps: sourceLines(apps), packages: sourceLines(packages), appsAndPackages: sourceLines([...apps, ...packages]).total },
  cloudSource: { files: cloudSourceFiles, distinctNusaReferences: nusaRefs.size },
  workOrders: { all: woAll, archive: woArchive, withoutArchive: woAll - woArchive },
  tests: { filesInTestsDir: testFilesAll, filesNamedTestOrSpec: testFilesNamed },
};
process.stdout.write(`${JSON.stringify(out, null, 2)}\n`);
