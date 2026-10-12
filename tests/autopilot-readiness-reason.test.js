"use strict";

const assert = require("node:assert/strict");
const { mkdtempSync, writeFileSync, rmSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join } = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");
const { blockedFailureCode } = require("../scripts/autopilot-readiness.js");
const { freshState } = require("../scripts/autopilot-runtime.js");

const blocked = (reason, status = "BLOCKED") => ({ lastResult: { status, reason } });

test("blocked readiness names only allowlisted local failure codes", () => {
  for (const reason of ["AUTOPILOT_TICK_HTTP_401", "AUTOPILOT_TICK_HTTP_403", "AUTOPILOT_TICK_HTTP_429", "AUTOPILOT_TICK_HTTP_503", "AUTOPILOT_TICK_STATUS_UNSUPPORTED", "AUTOPILOT_TICK_RESPONSE_INVALID", "AUTOPILOT_RUNTIME_ENDPOINT_OR_TOKEN_REQUIRED", "AUTOPILOT_TICK_FAILED"]) {
    assert.equal(blockedFailureCode(blocked(reason)), reason);
  }
  assert.equal(blockedFailureCode(blocked("fetch failed")), "AUTOPILOT_TICK_FETCH_FAILED");
});

test("provider text and invalid last-result identities cannot reach readiness output", () => {
  for (const reason of ["authorization=example-placeholder", "https://example.invalid/?token=example", "AUTOPILOT_TICK_HTTP_403\nprivate", "AUTOPILOT_TICK_HTTP_200", "AUTOPILOT_TICK_HTTP_403 extra", null]) {
    assert.equal(blockedFailureCode(blocked(reason)), "REASON_UNAVAILABLE");
  }
  assert.equal(blockedFailureCode(blocked("AUTOPILOT_TICK_HTTP_403", "RUNNING")), "REASON_UNAVAILABLE");
});

test("validated BLOCKED state still fails closed with the bounded diagnostic", () => {
  const directory = mkdtempSync(join(tmpdir(), "nusa-readiness-reason-"));
  const filename = join(directory, "state.json");
  try {
    const state = { ...freshState(), status: "BLOCKED", lastResult: { status: "BLOCKED", reason: "AUTOPILOT_TICK_HTTP_403", headSha: null, workflowRunId: null } };
    writeFileSync(filename, JSON.stringify(state));
    const result = spawnSync(process.execPath, ["-e", 'try { require("./scripts/autopilot-readiness.js").readState(); process.exit(0); } catch (error) { console.log(error.message); process.exit(2); }'], {
      cwd: process.cwd(), env: { ...process.env, NUSA_AUTOPILOT_STATE_PATH: filename }, encoding: "utf8", timeout: 5_000,
    });
    assert.equal(result.status, 2, result.stderr);
    assert.equal(result.stdout.trim(), "AUTOPILOT_NOT_READY:BLOCKED:AUTOPILOT_TICK_HTTP_403");
    assert.equal(result.stderr, "");
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test("diagnostic reporting preserves stopped, corrupt, stale and unsafe rejection", () => {
  const directory = mkdtempSync(join(tmpdir(), "nusa-readiness-boundaries-"));
  const filename = join(directory, "state.json");
  try {
    const cases = [
      [{ status: "STOPPED" }, "AUTOPILOT_NOT_READY:STOPPED"],
      [{ stateRecovery: "CORRUPT" }, "AUTOPILOT_STATE_CORRUPT"],
      [{ lastHeartbeatAt: 0 }, "AUTOPILOT_HEARTBEAT_STALE"],
      [{ productionMutationAllowed: true }, "AUTOPILOT_STATE_INVALID:STATE_SAFETY_INVARIANT_INVALID"],
    ];
    for (const [override, expected] of cases) {
      writeFileSync(filename, JSON.stringify({ ...freshState(), ...override }));
      const result = spawnSync(process.execPath, ["-e", 'try { require("./scripts/autopilot-readiness.js").readState(); process.exit(0); } catch (error) { console.log(error.message); process.exit(2); }'], {
        cwd: process.cwd(), env: { ...process.env, NUSA_AUTOPILOT_STATE_PATH: filename }, encoding: "utf8", timeout: 5_000,
      });
      assert.equal(result.status, 2, result.stderr);
      assert.equal(result.stdout.trim(), expected);
      assert.equal(result.stderr, "");
    }
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
