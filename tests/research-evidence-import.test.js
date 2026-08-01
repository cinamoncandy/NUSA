const test = require("node:test");
const assert = require("node:assert/strict");
const { mkdtempSync, rmSync, writeFileSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join } = require("node:path");
const { spawnSync } = require("node:child_process");
const { createResearchRunManifest } = require("../dist/apps/cloud/src/researchRunValidation.js");

function fixture() {
  const manifest = createResearchRunManifest({
    runId: "cli-import-run", runType: "INTEGRITY_CHECK", strategyId: "strategy", strategyVersion: "1",
    parameterSet: { mode: "test" }, datasetId: "dataset", datasetChecksum: "a".repeat(64),
    datasetStart: "2026-01-01T00:00:00.000Z", datasetEnd: "2026-02-01T00:00:00.000Z",
    sampleCount: 10, createdAt: "2026-07-15T00:00:00.000Z", codeVersion: "sha",
    config: {}, result: { checked: true },
  });
  return { manifest, report: { runId: manifest.runId, runType: manifest.runType, status: "PASS", reasons: [], checkedAt: manifest.createdAt, resultChecksum: manifest.resultChecksum } };
}

test("research evidence import persists and verifies a supplied pair", () => {
  const directory = mkdtempSync(join(tmpdir(), "nusa-research-cli-"));
  const databasePath = join(directory, "paper.sqlite");
  const inputPath = join(directory, "evidence.json");
  writeFileSync(inputPath, JSON.stringify(fixture()));
  const result = spawnSync(process.execPath, ["scripts/import-research-evidence.js", "--db", databasePath, "--input", inputPath], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /"persisted": true/);
  assert.match(result.stdout, /"productionMutationAllowed": false/);
  const repeat = spawnSync(process.execPath, ["scripts/import-research-evidence.js", "--db", databasePath, "--input", inputPath], { encoding: "utf8" });
  assert.equal(repeat.status, 0, repeat.stderr);
  rmSync(directory, { recursive: true, force: true });
});

test("research evidence import rejects a mismatched pair without claiming persistence", () => {
  const directory = mkdtempSync(join(tmpdir(), "nusa-research-cli-invalid-"));
  const inputPath = join(directory, "invalid.json");
  const pair = fixture();
  pair.report = { ...pair.report, resultChecksum: "b".repeat(64) };
  writeFileSync(inputPath, JSON.stringify(pair));
  const result = spawnSync(process.execPath, ["scripts/import-research-evidence.js", "--db", join(directory, "paper.sqlite"), "--input", inputPath], { encoding: "utf8" });
  assert.notEqual(result.status, 0);
  assert.doesNotMatch(result.stdout, /"persisted": true/);
  rmSync(directory, { recursive: true, force: true });
});
