const test = require("node:test");
const assert = require("node:assert/strict");
const { mkdtempSync, rmSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join } = require("node:path");
const { spawnSync } = require("node:child_process");
const { DesktopPersistenceStore } = require("../dist/apps/desktop/src/persistence/desktopPersistenceStore.js");

test("research evidence status is read-only and blocks when no reports exist", () => {
  const directory = mkdtempSync(join(tmpdir(), "nusa-research-status-"));
  const databasePath = join(directory, "paper.sqlite");
  new DesktopPersistenceStore(databasePath).close();
  const result = spawnSync(process.execPath, ["scripts/research-evidence-status.js", "--db", databasePath], { encoding: "utf8" });
  assert.notEqual(result.status, 0);
  assert.match(result.stdout, /"status": "BLOCKED"/);
  assert.match(result.stdout, /"availability": "UNAVAILABLE"/);
  assert.match(result.stdout, /"productionMutationAllowed": false/);
  rmSync(directory, { recursive: true, force: true });
});
