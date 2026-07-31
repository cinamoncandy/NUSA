const test = require("node:test");
const assert = require("node:assert/strict");
const { mkdtempSync, statSync, writeFileSync, rmSync } = require("node:fs");
const { join } = require("node:path");
const { tmpdir } = require("node:os");
const { spawnSync } = require("node:child_process");
const { DatabaseSync } = require("node:sqlite");

function withoutKnownRuntimeWarnings(stderr) {
  return stderr.replace(/^\(node:\d+\) ExperimentalWarning: SQLite is an experimental feature and might change at any time\r?\n?/gm, "");
}

function assertNoUnexpectedStderr(stderr) {
  assert.equal(withoutKnownRuntimeWarnings(stderr), "");
}

test("evidence status is safe and not evaluated without an explicit database", () => {
  const result = spawnSync(process.execPath, ["scripts/evidence-cli.js", "status"], { encoding: "utf8" });
  assert.equal(result.status, 0);
  assert.match(result.stdout, /"database": "not evaluated"/);
  assert.match(result.stdout, /"releaseStatus": "BLOCKED"/);
  assert.doesNotMatch(result.stdout, /process|username|hostname/i);
  assertNoUnexpectedStderr(result.stderr);
});

test("status reads a database without mutating it and fails closed for an incomplete schema", () => {
  const root = mkdtempSync(join(tmpdir(), "nusa-evidence-cli-"));
  const dbPath = join(root, "evidence.db");
  const db = new DatabaseSync(dbPath);
  db.exec("CREATE TABLE unrelated (id INTEGER PRIMARY KEY)");
  db.close();
  const before = statSync(dbPath).size;
  const result = spawnSync(process.execPath, ["scripts/evidence-cli.js", "status", "--db", dbPath], { encoding: "utf8" });
  const after = statSync(dbPath).size;
  assert.equal(result.status, 0);
  assert.match(result.stdout, /"database": "not evaluated"/);
  assert.equal(after, before);
  rmSync(root, { recursive: true, force: true });
});

test("export and verify commands reject missing required arguments without a stack trace", () => {
  const root = mkdtempSync(join(tmpdir(), "nusa-evidence-cli-"));
  const outputPath = join(root, "bundle.json");
  writeFileSync(outputPath, "{}\n", "utf8");
  const exportResult = spawnSync(process.execPath, ["scripts/evidence-cli.js", "export", "--output", outputPath], { encoding: "utf8" });
  assert.equal(exportResult.status, 1);
  assert.equal(withoutKnownRuntimeWarnings(exportResult.stderr), "evidence command failed\n");
  const verifyResult = spawnSync(process.execPath, ["scripts/evidence-cli.js", "verify", "--bundle", join(root, "missing.json")], { encoding: "utf8" });
  assert.equal(verifyResult.status, 1);
  assert.equal(withoutKnownRuntimeWarnings(verifyResult.stderr), "evidence command failed\n");
  rmSync(root, { recursive: true, force: true });
});
