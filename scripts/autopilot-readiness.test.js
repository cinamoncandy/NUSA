"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");

const READY = {
  schemaVersion: 1,
  status: "IDLE",
  iteration: 1,
  queueDepth: 0,
  completedCount: 0,
  failureCount: 0,
  retryCount: 0,
  blockedCount: 0,
  currentTask: null,
  lastSuccessfulWorkAt: Date.now(),
  lastHeartbeatAt: Date.now(),
  lastCycleAt: Date.now(),
  nextCycleAt: Date.now() + 60_000,
  lastResult: { status: "ABSTAINED", reason: "QUEUE_EMPTY", headSha: null, workflowRunId: null },
  stateRecovery: "RESTORED",
  liveAuthority: "NONE",
  productionMutationAllowed: false,
  aiAuthority: "ZERO_AUTHORITY",
};

function run(state) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "nusa-autopilot-readiness-"));
  const statePath = path.join(root, "runtime-state.json");
  fs.writeFileSync(statePath, JSON.stringify(state), "utf8");
  return spawnSync(process.execPath, [path.join(__dirname, "autopilot-readiness.js")], {
    env: { ...process.env, NUSA_AUTOPILOT_STATE_PATH: statePath, NUSA_AUTOPILOT_READY_TIMEOUT_MS: "1000", NUSA_AUTOPILOT_READY_POLL_MS: "100" },
    encoding: "utf8",
  });
}

test("accepts a fresh safe runtime heartbeat", () => {
  const result = run(READY);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /"status":"PASS"/);
});

test("fails closed on blocked runtime state", () => {
  const result = run({ ...READY, status: "BLOCKED" });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /AUTOPILOT_NOT_READY:BLOCKED/);
});

test("fails closed on an unsafe runtime state", () => {
  const result = run({ ...READY, productionMutationAllowed: true });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /AUTOPILOT_STATE_INVALID|AUTOPILOT_SAFETY_INVARIANT_INVALID/);
});
