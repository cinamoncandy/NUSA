"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

// L2 pre-registration (docs/LEARNING_L2_PREREG_2026-11-20.md): the failure-cause classifier is record-only. No module under apps/cloud
// may import it yet (decision, gate, qualification, allocation, threshold or order paths included). A later wiring PR must change this test explicitly.
const root = path.resolve(__dirname, "..");
const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
  const full = path.join(dir, entry.name);
  if (entry.isDirectory()) return entry.name === "node_modules" || entry.name === "dist" ? [] : walk(full);
  return /\.(ts|tsx|js|cjs|mjs)$/.test(entry.name) ? [full] : [];
});

test("no apps/cloud module imports or names the failure-cause classifier", () => {
  const offenders = walk(path.join(root, "apps", "cloud")).filter((file) => /researchFailureCause|classifyFailureCause|RESEARCH_FAILURE_CAUSES/.test(fs.readFileSync(file, "utf8")));
  assert.deepEqual(offenders.map((file) => path.relative(root, file)), []);
});

test("researchMetaLearning* does not read the classifier", () => {
  const dir = path.join(root, "packages", "contracts", "src");
  const offenders = fs.readdirSync(dir).filter((name) => /^researchMetaLearning/.test(name) && /researchFailureCause|classifyFailureCause/.test(fs.readFileSync(path.join(dir, name), "utf8")));
  assert.deepEqual(offenders, []);
});

test("the classifier module has no IO, clock, randomness or imports", () => {
  const source = fs.readFileSync(path.join(root, "packages", "contracts", "src", "researchFailureCause.ts"), "utf8");
  assert.doesNotMatch(source, /^\s*import\s/m);
  assert.doesNotMatch(source, /\b(require|fetch|process\.|Date\.|Math\.random|crypto|setTimeout)\b/);
});

test("the classifier is named only by its module, its test, this pin and the documents: no app, script, test or barrel reaches it", () => {
  const dirs = ["apps", "packages", "scripts", "tests"].map((d) => path.join(root, d));
  const files = dirs.flatMap((d) => (fs.existsSync(d) ? walk(d) : [])).filter((file) => /researchFailureCause|classifyFailureCause|RESEARCH_FAILURE_CAUSES/.test(fs.readFileSync(file, "utf8")));
  assert.deepEqual(files.map((file) => path.relative(root, file)).sort(), [
    "packages/contracts/src/researchFailureCause.test.ts", "packages/contracts/src/researchFailureCause.ts", "tests/research-failure-cause-isolation.test.js"
  ]);
});

test("the contracts barrel does not re-export the classifier (a deep import is the only way to reach it)", () => {
  const index = fs.readFileSync(path.join(root, "packages", "contracts", "src", "index.ts"), "utf8");
  assert.doesNotMatch(index, /researchFailureCause/);
});

test("no dynamic access can reach it either: nothing builds the names from strings", () => {
  const dirs = ["apps", "packages", "scripts"].map((d) => path.join(root, d));
  const offenders = dirs.flatMap((d) => walk(d)).filter((file) => /["']classify["']\s*\+|["']Failure["']\s*\+\s*["']Cause|"classify"\s*\+\s*"FailureCause"/.test(fs.readFileSync(file, "utf8")));
  assert.deepEqual(offenders.map((file) => path.relative(root, file)), []);
});
