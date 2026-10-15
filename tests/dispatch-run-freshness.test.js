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

test("only a failure conclusion is dispatched, matching the Worker contract", () => {
  // codingRunner.ts: `const allowedConclusions = failureRepair ? ["failure"] : ["success"]`.
  // A cited cancelled/timed_out run is parsed by the reason regex and then always rejected with
  // CODING_RUNNER_FAILURE_EVIDENCE_INVALID (409), so dispatching it only burns a consumer run.
  assert.equal(citedRunNeedsRepair(REPAIR, { status: "completed", conclusion: "failure" }).repair, true);
  for (const conclusion of ["cancelled", "timed_out"]) {
    const decision = citedRunNeedsRepair(REPAIR, { status: "completed", conclusion });
    assert.equal(decision.repair, false, conclusion);
    assert.equal(decision.reason, `run-not-repairable:${conclusion}`);
  }
});

test("the observed cancelled-run repair loop is suppressed", () => {
  // Observed 2026-10-13: Android Stable Release Watchdog run 38337326294 was cancelled on
  // 9e1dee48, and the repair dispatch citing it failed closed with 409 EVIDENCE_INVALID on every
  // attempt (02:13, 02:25, 02:32 ...).
  const decision = citedRunNeedsRepair(
    "gha:38337326294:9e1dee48e457df03a593fa88448cc0c12ede8381:cancelled",
    { status: "completed", conclusion: "cancelled", workflow_id: 1, head_sha: "9e1dee48e457df03a593fa88448cc0c12ede8381", run_number: 7, run_attempt: 1 },
  );
  assert.equal(decision.repair, false);
  assert.equal(decision.reason, "run-not-repairable:cancelled");
});

test("an unrepairable conclusion still never overrides unverifiable evidence", () => {
  // Suppression requires a terminal, readable conclusion; anything unverifiable still proceeds.
  assert.equal(citedRunNeedsRepair(REPAIR, { status: "in_progress", conclusion: null }).repair, true);
  assert.equal(citedRunNeedsRepair(REPAIR, { status: "completed", conclusion: null }).repair, true);
  assert.equal(citedRunNeedsRepair(REPAIR, null).repair, true);
  // And a non-repair dispatch is still the Worker's call, not this gate's.
  assert.equal(citedRunNeedsRepair("audit:pr:1", { status: "completed", conclusion: "cancelled" }).repair, true);
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

// Observed 2026-10-12: Android Stable Release Trigger run 38210957471 (n=1343) failed on
// bfc11b75 and run 38211405732 (n=1344) succeeded on the same head 6 minutes later, yet repair
// dispatches citing the immutable n=1343 failure kept firing (and failing closed) ~55 minutes on.
const CITED_FAILURE = Object.freeze({
  id: 38210957471, workflow_id: 349030154, head_sha: "BFC11B758957E19D486AB7CAA27E338D9680B916",
  status: "completed", conclusion: "failure", run_number: 1343, run_attempt: 1,
});
const SUPERSEDING_SUCCESS = Object.freeze({
  id: 38211405732, workflow_id: 349030154, head_sha: "bfc11b758957e19d486ab7caa27e338d9680b916",
  status: "completed", conclusion: "success", run_number: 1344, run_attempt: 1,
});

test("a strictly newer success on the same workflow and head suppresses the repair", () => {
  const decision = citedRunNeedsRepair(REPAIR, CITED_FAILURE, [SUPERSEDING_SUCCESS, CITED_FAILURE]);
  assert.equal(decision.repair, false);
  assert.equal(decision.reason, "superseded-by-success:38211405732");
  assert.equal(decision.supersededBy.runNumber, 1344);
});

test("a newer successful ATTEMPT of the same run number also suppresses the repair", () => {
  const retried = { ...SUPERSEDING_SUCCESS, id: 38210957471, run_number: 1343, run_attempt: 2 };
  assert.equal(citedRunNeedsRepair(REPAIR, CITED_FAILURE, [retried]).repair, false);
});

test("successor evidence that is not positive proof leaves the repair path untouched", () => {
  const cases = [
    ["older success", [{ ...SUPERSEDING_SUCCESS, run_number: 1342 }]],
    ["same ordinal", [{ ...SUPERSEDING_SUCCESS, run_number: 1343, run_attempt: 1 }]],
    ["different workflow", [{ ...SUPERSEDING_SUCCESS, workflow_id: 111 }]],
    ["different head", [{ ...SUPERSEDING_SUCCESS, head_sha: "a".repeat(40) }]],
    ["newer but still failing", [{ ...SUPERSEDING_SUCCESS, conclusion: "failure" }]],
    ["newer but still running", [{ ...SUPERSEDING_SUCCESS, status: "in_progress", conclusion: null }]],
    ["empty listing", []],
    ["missing listing", undefined],
    ["malformed listing", "not-an-array"],
    ["malformed entries", [null, "x", 7, { workflow_id: 349030154 }]],
  ];
  for (const [label, successors] of cases) {
    const decision = citedRunNeedsRepair(REPAIR, CITED_FAILURE, successors);
    assert.equal(decision.repair, true, label);
    assert.equal(decision.reason, "run-still-failure", label);
  }
});

test("successor evidence can never resurrect a non-repair dispatch or an unverifiable run", () => {
  assert.equal(citedRunNeedsRepair("audit:pr:1", CITED_FAILURE, [SUPERSEDING_SUCCESS]).repair, true);
  assert.equal(citedRunNeedsRepair(REPAIR, null, [SUPERSEDING_SUCCESS]).repair, true);
  assert.equal(citedRunNeedsRepair(REPAIR, { status: "in_progress", conclusion: null }, [SUPERSEDING_SUCCESS]).repair, true);
});

test("CLI suppresses a superseded repair and records the proof", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nusa-freshness-superseded-"));
  try {
    const runFile = path.join(dir, "run.json");
    const successorFile = path.join(dir, "runs.json");
    const outFile = path.join(dir, "decision.json");
    fs.writeFileSync(runFile, JSON.stringify(CITED_FAILURE));
    fs.writeFileSync(successorFile, JSON.stringify({ workflow_runs: [SUPERSEDING_SUCCESS, CITED_FAILURE] }));
    const result = spawnSync("node", ["scripts/verify-dispatch-run-freshness.js", "--reason", REPAIR, "--run", runFile, "--successors", successorFile, "--out", outFile], { encoding: "utf8" });
    assert.equal(result.status, 0);
    assert.match(result.stdout.trim(), /^repair=false$/);
    const record = JSON.parse(fs.readFileSync(outFile, "utf8"));
    assert.equal(record.repair, false);
    assert.equal(record.supersededBy.id, 38211405732);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("CLI ignores an unreadable successor listing instead of failing the job", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nusa-freshness-bad-successors-"));
  try {
    const runFile = path.join(dir, "run.json");
    const successorFile = path.join(dir, "runs.json");
    const outFile = path.join(dir, "decision.json");
    fs.writeFileSync(runFile, JSON.stringify(CITED_FAILURE));
    fs.writeFileSync(successorFile, "{ not json");
    const result = spawnSync("node", ["scripts/verify-dispatch-run-freshness.js", "--reason", REPAIR, "--run", runFile, "--successors", successorFile, "--out", outFile], { encoding: "utf8" });
    assert.equal(result.status, 0);
    assert.match(result.stdout.trim(), /^repair=true$/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
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
