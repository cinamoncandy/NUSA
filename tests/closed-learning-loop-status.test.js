"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { ClosedLearningLoopStatusTracker } = require("../dist/apps/cloud/src/closedLearningLoopStatus.js");

test("the loop status records bootstrap and rollover steps as codes and counts evaluated cycles and deployments", () => {
  const t = new ClosedLearningLoopStatusTracker();
  assert.equal(t.snapshot(), null, "nothing before the first tick");
  t.observeBootstrap({ status: "WAITING_RESEARCH_SNAPSHOT" });
  t.observeRollover({ status: "WAITING_FOR_REALIZED_FILL", periodId: "period-secret-id" }, 1000);
  assert.deepEqual(t.snapshot(), { lastTickAt: 1000, ticks: 1, bootstrap: "WAITING_RESEARCH_SNAPSHOT", rollover: "WAITING_FOR_REALIZED_FILL", cyclesEvaluated: 0, deployments: 0 });
  t.observeRollover({ status: "CLOSED_AND_EVALUATED", cycle: { status: "EXECUTED", record: { decision: { outcome: "REJECTED" } } } }, 2000);
  t.observeRollover({ status: "CLOSED_AND_EVALUATED", cycle: { status: "EXECUTED", record: { decision: { outcome: "QUALIFIED_FOR_LEAGUE" }, paperDeployment: { deploymentId: "d" } } } }, 3000);
  t.observeRollover({ status: "BLOCKED", reason: "MULTIPLE_OPEN_PAPER_PERIODS" }, 4000);
  const s = t.snapshot();
  assert.equal(s.ticks, 4);
  assert.equal(s.cyclesEvaluated, 2);
  assert.equal(s.deployments, 1);
  assert.equal(s.rollover, "BLOCKED");
  assert.equal(s.rolloverReason, "MULTIPLE_OPEN_PAPER_PERIODS");
  assert.equal(s.lastCycleOutcome, "QUALIFIED_FOR_LEAGUE", "the last evaluated outcome is kept across waiting ticks");
  assert.doesNotMatch(JSON.stringify(s), /period-secret-id|deploymentId/);
});

test("free-text reasons are reduced to their leading code or dropped, and an error tick keeps the counts", () => {
  const t = new ClosedLearningLoopStatusTracker();
  t.observeRollover({ status: "ACCOUNT_REPLACED_PERIOD_REOPENED", reason: "retired:paper-period-123" }, 1);
  assert.equal(t.snapshot().rolloverReason, undefined, "lower-case free text is not a code");
  t.observeRollover({ status: "BLOCKED", reason: "PAPER_ACCOUNT_REPLACED_RETIREMENT_UNAVAILABLE:detail" }, 2);
  assert.equal(t.snapshot().rolloverReason, "PAPER_ACCOUNT_REPLACED_RETIREMENT_UNAVAILABLE");
  t.observeError(3);
  assert.equal(t.snapshot().rollover, "ERROR");
  assert.equal(t.snapshot().ticks, 3);
  assert.equal(t.snapshot().cyclesEvaluated, 0);
});

test("the production composition feeds every loop tick into the status and hands it to the runtime", () => {
  const src = fs.readFileSync(path.join(__dirname, "..", "apps", "cloud", "src", "closedLearningProductionRuntime.ts"), "utf8");
  assert.match(src, /loopStatus\.observeBootstrap\(bootstrap\)/);
  assert.match(src, /loopStatus\.observeRollover\(await runClosedLearningRolloverAsync\(\), Date\.now\(\)\)/);
  assert.match(src, /loopStatus\.observeError\(Date\.now\(\)\); throw error;/);
  assert.match(src, /\(\) => loopStatus\.snapshot\(\),\r?\n\s*\);/);
});
