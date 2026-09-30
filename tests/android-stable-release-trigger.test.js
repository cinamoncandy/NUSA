import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const workflow = fs.readFileSync(".github/workflows/android-stable-release-trigger.yml", "utf8");
const watchdog = fs.readFileSync(".github/workflows/android-stable-release-watchdog.yml", "utf8");
const deploymentWatchdog = fs.readFileSync(".github/workflows/deployment-convergence-watchdog.yml", "utf8");

test("Android stable trigger only no-ops after exact-main stable convergence", () => {
  assert.match(workflow, /RELEASE_TARGET=.*nusa-android/);
  assert.match(workflow, /if \[ "\$RELEASE_TARGET" = "\$MAIN_SHA" \]/);
  assert.match(workflow, /Android stable converged to exact main/);
  assert.match(workflow, /Waiting for Android Stable Release run .* on exact main before re-checking the stable target/);
  assert.doesNotMatch(workflow, /git diff --quiet/);
  assert.doesNotMatch(workflow, /No Android release-relevant changes since stable source/);
});

test("Android stable trigger preserves exact-main CI, bounded dedupe, and stale-main guards", () => {
  assert.match(workflow, /actions\/workflows\/ci\.yml\/runs\?head_sha=\$MAIN_SHA/);
  assert.match(workflow, /CI_CONCLUSION.*success/);
  assert.match(workflow, /ACTIVE_ID=.*workflow_runs/);
  assert.match(workflow, /Main changed before dispatch; refusing stale promotion/);
  assert.match(workflow, /refusing an unbounded redispatch loop/);
  assert.match(workflow, /actions\/workflows\/android-stable-release\.yml\/dispatches/);
  assert.match(workflow, /inputs\[source_sha\]=\$MAIN_SHA/);
});

test("successful Android release gets bounded target propagation time without redispatch", () => {
  const settle = workflow.indexOf('if [ "$LATEST_CONCLUSION" = "success" ] && [ "$release_settle_checks" -lt 6 ]');
  const fail = workflow.indexOf('refusing an unbounded redispatch loop', settle);
  const dispatch = workflow.indexOf('gh api --method POST', settle);
  assert.ok(settle > 0 && fail > settle && dispatch > fail);
  assert.match(workflow.slice(settle, fail), /sleep 10\s+continue/);
  assert.doesNotMatch(workflow.slice(settle - 180, settle), /dispatched.*true/);
});

test("trigger treats any-controller success by publish evidence, not by event", () => {
  assert.match(workflow, /select\(\.head_sha == \$sha and \.status == "completed"\)\] \| sort_by\(\.updated_at\)/);
  assert.doesNotMatch(workflow, /MANUAL_COMPLETED/);
  assert.doesNotMatch(workflow, /\.event == "workflow_dispatch" and \.status == "completed"/);
  assert.match(workflow, /select\(\.name \| test\("publish"; "i"\)\)/);
  assert.match(workflow, /published but stable target remains/);
  assert.match(workflow, /concluded without publishing \(no-op\); proceeding to a single deterministic dispatch/);
});

test("both watchdogs recognize a successful exact-main publisher before redispatch", () => {
  assert.ok(watchdog.indexOf('LATEST_SUCCESS=') < watchdog.indexOf('FAILED_ID='));
  assert.doesNotMatch(watchdog, /SUCCESSFUL_MANUAL_ID/);
  assert.match(watchdog, /select\(\.name \| test\("publish"; "i"\)\)/);
  assert.match(watchdog, /refusing a duplicate publisher dispatch/);
  assert.match(watchdog, /concluded without publishing \(no-op\); continuing to fresh dispatch evaluation/);
  const guard = deploymentWatchdog.indexOf('PUBLISHED_RUN=');
  const dispatch = deploymentWatchdog.indexOf('android-stable-release-trigger.yml/dispatches', guard);
  assert.ok(guard > 0 && dispatch > guard);
  assert.doesNotMatch(deploymentWatchdog, /\.event == "workflow_dispatch" and \.status == "completed" and \.conclusion == "success"/);
});

test("Android stable watchdog always converges a stale stable target to exact main", () => {
  assert.match(watchdog, /RELEASE_TARGET=.*nusa-android/);
  assert.match(watchdog, /if \[ "\$RELEASE_TARGET" = "\$MAIN_SHA" \]/);
  assert.match(watchdog, /exact-main convergence is required/);
  assert.match(watchdog, /actions\/workflows\/android-stable-release\.yml\/dispatches/);
  assert.match(watchdog, /inputs\[source_sha\]=\$MAIN_SHA/);
  assert.doesNotMatch(watchdog, /git diff --quiet/);
  assert.doesNotMatch(watchdog, /No Android release-relevant drift/);
});
