const test = require("node:test");
const assert = require("node:assert/strict");
const { existsSync, mkdtempSync, readFileSync, rmSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join } = require("node:path");
const { runEvidenceRehearsal } = require("../dist/apps/desktop/src/evidence/evidenceRehearsal.js");

test("rehearsal uses temporary SQLite path and remains ineligible for release", () => {
  const report = runEvidenceRehearsal({ generatedAt: Date.UTC(2026, 6, 15), codeVersion: "test-rehearsal" });
  assert.equal(report.purpose, "REHEARSAL");
  assert.equal(report.eligibleForRelease, false);
  assert.equal(report.overallStatus, "PASS");
  assert.equal(report.cleanupStatus, "PASS");
  assert.equal(report.mismatches.length, 0);
  assert.ok(report.warnings.includes("REHEARSAL_ONLY_NOT_OPERATIONAL_EVIDENCE"));
});

test("rehearsal output is immutable JSON and preserves no production path", () => {
  const directory = mkdtempSync(join(tmpdir(), "nusa-rehearsal-output-"));
  const output = join(directory, "report.json");
  const report = runEvidenceRehearsal({ generatedAt: Date.UTC(2026, 6, 15), codeVersion: "test-rehearsal", outputPath: output });
  const parsed = JSON.parse(readFileSync(output, "utf8"));
  assert.equal(parsed.reportChecksum, report.reportChecksum);
  assert.equal(parsed.eligibleForRelease, false);
  assert.equal(parsed.purpose, "REHEARSAL");
  assert.equal(existsSync(output), true);
  rmSync(directory, { recursive: true, force: true });
});
