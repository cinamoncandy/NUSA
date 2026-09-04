"use strict";

// Regression tests for scripts/verify-dispatch-run-freshness.js (P1 flake fix).
// Deterministic fixtures only; no network, no credentials.

const test = require("node:test");
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { citedRunNeedsRepair } = require("../scripts/verify-dispatch-run-freshness.js");

const REPAIR = "gha:123:abc:failure";

test("still-failed, cancelled, and timed-out runs proceed to the worker", () => {
  for (const conclusion of ["failure", "cancelled", "timed_out"]) {
    const decision = citedRunNeedsRepair(REPAIR, { status: "completed", conclusion });
    assert.equal(decision.repair, true);
  }
});

test("retried-to-success and other terminal conclusions are suppressed", () => {
  for (const conclusion of ["success", "neutral", "skipped", "startup_failure", "stale", "action_required"]) {
    const decision = citedRunNeedsRepair(REPAIR, { status: "completed", conclusion });
    assert.equal(decision.repair, false, conclusion);
    assert.match(decision.reason, /run-no-longer-failed/);
  }
});

test("non-repair dispatches always proceed (worker verifies authoritatively)", () => {
  for (const reason of ["audit:pr:1:ci:2:abc", "continue-from:main_push", "pr-ci-success"]) {
    assert.equal(citedRunNeedsRepair(reason, { status: "completed", conclusion: "success" }).repair, true);
  }
});

test("unverifiable runs proceed — never silently skip repair (failure tests)", () => {
  assert.equal(citedRunNeedsRepair(REPAIR, null).repair, true);
  assert.equal(citedRunNeedsRepair(REPAIR, undefined).repair, true);
  assert.equal(citedRunNeedsRepair(REPAIR, { status: "in_progress", conclusion: null }).repair, true);
  assert.equal(citedRunNeedsRepair(REPAIR, { status: "completed", conclusion: null }).repair, true);
  assert.equal(citedRunNeedsRepair(REPAIR, "not-an-object").repair, true);
});

test("CLI writes a machine-readable decision for $GITHUB_OUTPUT", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nusa-freshness-"));
  try {
    const runFile = path.join(dir, "run.json");
    const outFile = path.join(dir, "decision.json");
    fs.writeFileSync(runFile, JSON.stringify({ status: "completed", conclusion: "success" }));
    const result = spawnSync("node", ["scripts/verify-dispatch-run-freshness.js", "--reason", REPAIR, "--run", runFile, "--out", outFile], { encoding: "utf8" });
    assert.equal(result.status, 0);
    assert.match(result.stdout.split("\n")[0], /^repair=false$/);
    assert.equal(JSON.parse(fs.readFileSync(outFile, "utf8")).repair, false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
