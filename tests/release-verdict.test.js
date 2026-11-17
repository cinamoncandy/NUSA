"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { decide, main } = require("../scripts/release-verdict.js");

const S = "a".repeat(40);
const T = "b".repeat(40);
const ok = { sourceSha: S, backupJob: "success", releaseJob: "success", deploymentResult: "DEPLOYED", healthSha: S, healthOk: "true" };
const ctl = { activation: "controller", controllerOutcome: "DEPLOYED", controllerActiveSha: S, controllerRuntimeOk: "true" };

test("only a run where every fact agrees is a deployment", () => {
  assert.deepEqual(decide(ok), { deployed: true, result: "DEPLOYED", reason: "ALL_FACTS_AGREE" });
  assert.equal(decide({ ...ok, ...ctl }).deployed, true);
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
  for (const o of ["ROLLED_BACK", "STOPPED_SAFE", "REFUSED", "STOPPED_UNCONFIRMED"]) { const v = decide({ ...ok, ...ctl, controllerOutcome: o }); assert.deepEqual([v.deployed, v.result], [false, "FAILED"], o); }
  assert.equal(decide({ ...ok, ...ctl, controllerOutcome: "SUPERSEDED" }).result, "SUPERSEDED");
  assert.equal(decide({ ...ok, ...ctl, controllerOutcome: "DONE" }).deployed, false);
});

test("a malformed or missing source sha, or missing input, never deploys", () => {
  for (const sourceSha of [undefined, "", "xyz", "A".repeat(40)]) assert.equal(decide({ ...ok, sourceSha }).deployed, false);
  assert.equal(decide(undefined).deployed, false);
  assert.equal(decide(null).deployed, false);
});

test("exhaustive: of every combination of the facts, exactly the all-agree one deploys", () => {
  let deployed = 0;
  for (const backupJob of ["success", "failure"]) for (const releaseJob of ["success", "failure", "skipped"]) for (const deploymentResult of ["DEPLOYED", "FAILED", "SKIPPED_MAIN_MOVED", undefined]) for (const healthSha of [S, T, undefined]) for (const controllerOutcome of [undefined, "DEPLOYED", "ROLLED_BACK"]) {
    const v = decide({ sourceSha: S, backupJob, releaseJob, deploymentResult, healthSha, healthOk: "true", ...(controllerOutcome ? { ...ctl, controllerOutcome } : {}) });
    if (v.deployed) { deployed += 1; assert.deepEqual([backupJob, releaseJob, deploymentResult, healthSha], ["success", "success", "DEPLOYED", S]); assert.ok(controllerOutcome !== "ROLLED_BACK"); }
  }
  assert.equal(deployed, 2, "with and without a controller outcome");
});

test("the command-line text names the result and states NOT DEPLOYED for every non-deployment", () => {
  const good = main({ SOURCE_SHA: S, BACKUP_JOB: "success", RELEASE_JOB: "success", DEPLOYMENT_RESULT: "DEPLOYED", HEALTH_SHA: S, HEALTH_OK: "true" });
  assert.equal(good.v.deployed, true); assert.match(good.text, /^deploymentResult=DEPLOYED$/m); assert.doesNotMatch(good.text, /NOT DEPLOYED/);
  const moved = main({ SOURCE_SHA: S, BACKUP_JOB: "success", RELEASE_JOB: "success", DEPLOYMENT_RESULT: "SKIPPED_MAIN_MOVED", HEALTH_SHA: "" });
  assert.match(moved.text, /NOT DEPLOYED: SUPERSEDED \(PROTECTED_MAIN_MOVED\)/);
});

test("the public health must say ok:true as well, not only show the build", () => {
  for (const healthOk of ["false", "", undefined, null, "yes"]) assert.equal(decide({ ...ok, healthOk }).reason, "HEALTH_NOT_OK", String(healthOk));
});

test("controller mode needs ALL of: an outcome, the controller's own active build equal to the source, and its runtime verification", () => {
  assert.equal(decide({ ...ok, activation: "controller" }).reason, "CONTROLLER_OUTCOME_MISSING", "a missing outcome is a failure in controller mode");
  assert.equal(decide({ ...ok, activation: "controller", controllerOutcome: "" }).reason, "CONTROLLER_OUTCOME_MISSING");
  for (const [over, reason] of [[{ controllerActiveSha: undefined }, "CONTROLLER_ACTIVE_SHA_MISSING"], [{ controllerActiveSha: T }, "CONTROLLER_ACTIVE_SHA_MISMATCH"], [{ controllerRuntimeOk: "false" }, "CONTROLLER_RUNTIME_NOT_OK"], [{ controllerRuntimeOk: undefined }, "CONTROLLER_RUNTIME_NOT_OK"]]) {
    assert.equal(decide({ ...ok, ...ctl, ...over }).reason, reason, JSON.stringify(over));
  }
  // an outcome without controller mode is held to the same standard
  assert.equal(decide({ ...ok, controllerOutcome: "DEPLOYED" }).reason, "CONTROLLER_ACTIVE_SHA_MISSING");
  // helper mode needs none of it
  assert.equal(decide({ ...ok, activation: "helper" }).deployed, true);
  const cli = main({ SOURCE_SHA: S, BACKUP_JOB: "success", RELEASE_JOB: "success", DEPLOYMENT_RESULT: "DEPLOYED", HEALTH_SHA: S, HEALTH_OK: "true", ACTIVATION: "controller", CONTROLLER_OUTCOME: "DEPLOYED", CONTROLLER_ACTIVE_SHA: S, CONTROLLER_RUNTIME_OK: "true" });
  assert.equal(cli.v.deployed, true);
  assert.equal(main({ SOURCE_SHA: S, BACKUP_JOB: "success", RELEASE_JOB: "success", DEPLOYMENT_RESULT: "DEPLOYED", HEALTH_SHA: S, HEALTH_OK: "true", ACTIVATION: "controller" }).v.deployed, false);
});
