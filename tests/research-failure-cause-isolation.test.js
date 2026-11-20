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

test("the classifier is only imported by its test and the contracts index", () => {
  const files = [...walk(path.join(root, "packages")), ...walk(path.join(root, "scripts"))].filter((file) => /researchFailureCause|classifyFailureCause/.test(fs.readFileSync(file, "utf8")));
  assert.deepEqual(files.map((file) => path.relative(root, file)).sort(), ["packages/contracts/src/index.ts", "packages/contracts/src/researchFailureCause.test.ts", "packages/contracts/src/researchFailureCause.ts"]);
});
