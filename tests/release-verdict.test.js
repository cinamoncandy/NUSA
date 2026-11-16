"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { decide, main } = require("../scripts/release-verdict.js");

const S = "a".repeat(40);
const T = "b".repeat(40);
const ok = { sourceSha: S, backupJob: "success", releaseJob: "success", deploymentResult: "DEPLOYED", healthSha: S };

test("only a run where every fact agrees is a deployment", () => {
  assert.deepEqual(decide(ok), { deployed: true, result: "DEPLOYED", reason: "ALL_FACTS_AGREE" });
  assert.equal(decide({ ...ok, controllerOutcome: "DEPLOYED" }).deployed, true);
});

test("protected main moved: SUPERSEDED, never a deployment (the 2026-11-16 19:38 KST run)", () => {
  const v = decide({ ...ok, deploymentResult: "SKIPPED_MAIN_MOVED", healthSha: T });
  assert.deepEqual([v.deployed, v.result], [false, "SUPERSEDED"]);
});

test("a skipped or missing release job or backup is not a deployment", () => {
  for (const releaseJob of ["skipped", "", undefined, "weird"]) assert.equal(decide({ ...ok, releaseJob }).deployed, false, String(releaseJob));
  for (const backupJob of ["failure", "skipped", "cancelled", "", undefined]) assert.equal(decide({ ...ok, backupJob }).deployed, false, String(backupJob));
});

test("the receipt must say DEPLOYED: any other or missing word fails", () => {
  for (const deploymentResult of ["FAILED", "FAILED_ACTIVATION_IDENTITY", "", undefined, "deployed"]) assert.equal(decide({ ...ok, deploymentResult }).deployed, false, String(deploymentResult));
  assert.equal(decide({ ...ok, releaseJob: "failure" }).deployed, false);
  assert.equal(decide({ ...ok, releaseJob: "cancelled" }).deployed, false);
});

test("the public health must show exactly the released build", () => {
  assert.equal(decide({ ...ok, healthSha: T }).reason, "HEALTH_SHA_MISMATCH");
  for (const healthSha of ["", undefined, null, "abc", "A".repeat(40)]) assert.equal(decide({ ...ok, healthSha }).reason, "HEALTH_SHA_MISSING", String(healthSha));
});

test("when the controller reports an outcome only DEPLOYED counts; unknown words fail", () => {
  for (const o of ["ROLLED_BACK", "STOPPED_SAFE", "REFUSED", "STOPPED_UNCONFIRMED"]) { const v = decide({ ...ok, controllerOutcome: o }); assert.deepEqual([v.deployed, v.result], [false, "FAILED"], o); }
  assert.equal(decide({ ...ok, controllerOutcome: "SUPERSEDED" }).result, "SUPERSEDED");
  assert.equal(decide({ ...ok, controllerOutcome: "DONE" }).deployed, false);
});

test("a malformed or missing source sha, or missing input, never deploys", () => {
  for (const sourceSha of [undefined, "", "xyz", "A".repeat(40)]) assert.equal(decide({ ...ok, sourceSha }).deployed, false);
  assert.equal(decide(undefined).deployed, false);
  assert.equal(decide(null).deployed, false);
});

test("exhaustive: of every combination of the facts, exactly the all-agree one deploys", () => {
  let deployed = 0;
  for (const backupJob of ["success", "failure"]) for (const releaseJob of ["success", "failure", "skipped"]) for (const deploymentResult of ["DEPLOYED", "FAILED", "SKIPPED_MAIN_MOVED", undefined]) for (const healthSha of [S, T, undefined]) for (const controllerOutcome of [undefined, "DEPLOYED", "ROLLED_BACK"]) {
    const v = decide({ sourceSha: S, backupJob, releaseJob, deploymentResult, healthSha, controllerOutcome });
    if (v.deployed) { deployed += 1; assert.deepEqual([backupJob, releaseJob, deploymentResult, healthSha], ["success", "success", "DEPLOYED", S]); assert.ok(controllerOutcome !== "ROLLED_BACK"); }
  }
  assert.equal(deployed, 2, "with and without a controller outcome");
});

test("the command-line text names the result and states NOT DEPLOYED for every non-deployment", () => {
  const good = main({ SOURCE_SHA: S, BACKUP_JOB: "success", RELEASE_JOB: "success", DEPLOYMENT_RESULT: "DEPLOYED", HEALTH_SHA: S });
  assert.equal(good.v.deployed, true); assert.match(good.text, /^deploymentResult=DEPLOYED$/m); assert.doesNotMatch(good.text, /NOT DEPLOYED/);
  const moved = main({ SOURCE_SHA: S, BACKUP_JOB: "success", RELEASE_JOB: "success", DEPLOYMENT_RESULT: "SKIPPED_MAIN_MOVED", HEALTH_SHA: "" });
  assert.match(moved.text, /NOT DEPLOYED: SUPERSEDED \(PROTECTED_MAIN_MOVED\)/);
});

test("stage_only is reported as STAGED_ONLY: never a deployment, and the run does not fail", () => {
  const v = decide({ ...ok, deploymentResult: "STAGED_ONLY", healthSha: T });
  assert.deepEqual([v.deployed, v.result], [false, "STAGED_ONLY"]);
  assert.match(main({ SOURCE_SHA: S, BACKUP_JOB: "success", RELEASE_JOB: "success", DEPLOYMENT_RESULT: "STAGED_ONLY", HEALTH_SHA: "" }).text, /NOT DEPLOYED: STAGED_ONLY/);
  assert.equal(decide({ ...ok, deploymentResult: "STAGED_ONLY", releaseJob: "failure" }).result, "FAILED", "a staged-only receipt from a failed job is a failure");
});
