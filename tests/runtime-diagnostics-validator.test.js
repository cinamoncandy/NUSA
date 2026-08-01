const test = require("node:test");
const assert = require("node:assert/strict");
const { mkdtempSync, rmSync, writeFileSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join } = require("node:path");
const { spawnSync } = require("node:child_process");

function run(value) {
  const directory = mkdtempSync(join(tmpdir(), "nusa-runtime-diagnostics-"));
  const input = join(directory, "diagnostics.json");
  writeFileSync(input, JSON.stringify({ snapshots: value }));
  const result = spawnSync(process.execPath, ["scripts/validate-runtime-diagnostics.js", "--input", input], { encoding: "utf8" });
  rmSync(directory, { recursive: true, force: true });
  return result;
}

const snapshot = (overrides = {}) => ({
  sessionId: "session-1", sessionState: "RUNNING", activeIntervalCount: 1, activeTimeoutCount: 0,
  marketListenerCount: 1, marketSubscriptionCount: 1, actualOrderCount: 0, actualFillCount: 0,
  cashMutationCount: 0, positionMutationCount: 0, brokerCallCount: 0, privateApiCallCount: 0,
  ...overrides
});

test("runtime diagnostics validator accepts stable safe snapshots", () => {
  const result = run([snapshot(), snapshot({ sessionState: "COMPLETED", activeIntervalCount: 0, marketListenerCount: 0, marketSubscriptionCount: 0 })]);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /"status": "PASS"/);
  assert.match(result.stdout, /"productionMutationAllowed": false/);
});

test("runtime diagnostics validator rejects mutation and resource growth", () => {
  const mutation = run([snapshot({ actualOrderCount: 1 })]);
  assert.notEqual(mutation.status, 0);
  const growth = run([snapshot({ marketListenerCount: 1 }), snapshot({ marketListenerCount: 2 })]);
  assert.notEqual(growth.status, 0);
});
