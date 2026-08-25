const test = require("node:test");
const assert = require("node:assert/strict");
const { mkdtempSync, rmSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join } = require("node:path");
const { DatabaseSync } = require("node:sqlite");
const { DesktopPersistenceStore } = require("../dist/apps/desktop/src/persistence/desktopPersistenceStore.js");
const { createResearchRunManifest } = require("../dist/apps/cloud/src/researchRunValidation.js");

test("desktop SQLite persists immutable research manifests and reports", () => {
  const directory = mkdtempSync(join(tmpdir(), "nusa-research-"));
  const filename = join(directory, "paper.sqlite");
  const manifest = createResearchRunManifest({
    runId: "wf-persisted", runType: "WALK_FORWARD", strategyId: "strategy", strategyVersion: "1",
    parameterSet: { fast: 5 }, datasetId: "dataset", datasetChecksum: "a".repeat(64),
    datasetStart: "2026-01-01T00:00:00.000Z", datasetEnd: "2026-02-01T00:00:00.000Z",
    sampleCount: 10, createdAt: "2026-07-15T00:00:00.000Z", codeVersion: "sha",
    config: {}, result: {}
  });
  const report = Object.freeze({ runId: manifest.runId, runType: "WALK_FORWARD", status: "PASS", reasons: [], checkedAt: "2026-07-15T00:00:00.000Z", resultChecksum: manifest.resultChecksum });
  const first = new DesktopPersistenceStore(filename);
  first.appendResearchRunManifest(manifest);
  first.appendResearchValidationReport(report);
  assert.deepEqual(first.loadResearchRunManifests(), [manifest]);
  assert.deepEqual(first.loadResearchValidationReports(), [report]);
  first.close();
  const second = new DesktopPersistenceStore(filename);
  assert.deepEqual(second.loadResearchRunManifests(), [manifest]);
  assert.deepEqual(second.loadResearchValidationReports(), [report]);
  assert.throws(() => second.appendResearchRunManifest({ ...manifest, codeVersion: "different" }));
  assert.throws(() => second.appendResearchValidationReport({ ...report, runId: "missing" }), /manifest is missing/);
  assert.throws(() => second.appendResearchValidationReport({ ...report, resultChecksum: "b".repeat(64) }), /does not match manifest/);
  second.close();

  const db = new DatabaseSync(filename);
  db.prepare("UPDATE desktop_research_reports SET report_json = ? WHERE run_id = ?").run(JSON.stringify({ ...report, runId: "tampered" }), report.runId);
  db.close();
  const third = new DesktopPersistenceStore(filename);
  assert.throws(() => third.loadResearchValidationReports(), /does not match persisted manifest/);
  third.close();
  rmSync(directory, { recursive: true, force: true });
});
