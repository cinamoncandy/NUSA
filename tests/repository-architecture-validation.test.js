const test = require("node:test");
const assert = require("node:assert/strict");
const { analyzeRepository } = require("../scripts/validate-architecture.js");

test("repository architecture has no unresolved imports, runtime cycles, or forbidden layer references", () => {
  const report = analyzeRepository(process.cwd());
  assert.deepEqual(report.unresolved, []);
  assert.deepEqual(report.runtimeCycles, []);
  assert.deepEqual(report.findings, []);
});

test("architecture graph distinguishes runtime and type-only edges", () => {
  const report = analyzeRepository(process.cwd());
  assert.ok(report.edges.some((edge) => edge.kind === "runtime"));
  assert.ok(report.edges.some((edge) => edge.kind === "type"));
});
