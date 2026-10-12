"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { ClosedLearningLoopStatusTracker } = require("../dist/apps/cloud/src/closedLearningLoopStatus.js");

test("replayed deployment receipts are history, not new deployments", () => {
  const tracker = new ClosedLearningLoopStatusTracker();
  const record = { paperDeployment: { deploymentId: "deployment-1" } };
  tracker.observeRollover({ status: "CLOSED_AND_EVALUATED", cycle: { status: "EXECUTED", record } }, 1);
  for (let at = 2; at < 6; at++) tracker.observeRollover({ status: "CLOSED_AND_EVALUATED", cycle: { status: "REPLAYED", record } }, at);
  assert.equal(tracker.snapshot().deployments, 1);
  assert.equal(tracker.snapshot().evidence.deploymentId, "deployment-1");
  tracker.observeRollover({ status: "CLOSED_AND_EVALUATED", cycle: { status: "RESUMED", record: { paperDeployment: { deploymentId: "deployment-2" } } } }, 6);
  assert.equal(tracker.snapshot().deployments, 2);
  tracker.observeRollover({ status: "CLOSED_AND_EVALUATED", cycle: { status: "WAITING_GOVERNANCE_APPROVAL", record } }, 7);
  assert.equal(tracker.snapshot().deployments, 2);
});

test("current block is cleared after recovery but historical failure remains", () => {
  const tracker = new ClosedLearningLoopStatusTracker();
  tracker.seedLastBlocked({ reason: "OLD_FAILURE", at: 1 });
  tracker.observeRollover({ status: "WAITING_FOR_KST_DAY_ROLLOVER" }, 2);
  assert.equal(tracker.snapshot().currentBlockedReason, undefined);
  tracker.observeRollover({ status: "BLOCKED", reason: "MISSING_EVIDENCE:private detail" }, 3);
  assert.equal(tracker.snapshot().currentBlockedReason, "MISSING_EVIDENCE");
  tracker.observeError(4);
  assert.equal(tracker.snapshot().currentBlockedReason, "TICK_ERROR");
  tracker.observeRollover({ status: "WAITING_FOR_REALIZED_FILL" }, 5);
  assert.equal(tracker.snapshot().currentBlockedReason, undefined);
  assert.equal(tracker.snapshot().lastBlockedReason, "TICK_ERROR");
  assert.doesNotMatch(JSON.stringify(tracker.snapshot()), /private detail/);
});

const now = Date.parse("2026-10-12T01:00:00Z");
const open = (start) => ({ periodId: "period-1", periodStartAt: start, candidateProvenance: [], observations: [] });
test("KST eligibility is the real next midnight and is withdrawn on state or period change", () => {
  const tracker = new ClosedLearningLoopStatusTracker();
  tracker.observeRollover({ status: "WAITING_FOR_KST_DAY_ROLLOVER" }, now);
  tracker.observePeriods(open(now - 1000), []);
  assert.equal(tracker.snapshot().nextEvaluationEligibleAt, Date.parse("2026-10-12T15:00:00Z"));
  tracker.observeRollover({ status: "BLOCKED", reason: "MISSING_EVIDENCE" }, now + 1);
  assert.equal(tracker.snapshot().nextEvaluationEligibleAt, undefined);
  tracker.observeRollover({ status: "WAITING_FOR_KST_DAY_ROLLOVER" }, now + 2);
  tracker.observePeriods(undefined, []);
  assert.equal(tracker.snapshot().nextEvaluationEligibleAt, undefined);
  assert.equal(tracker.snapshot().cyclesEvaluated, 0);
});

test("invalid, future and already elapsed period boundaries never promise an evaluation", () => {
  for (const start of [NaN, Infinity, -1, 1.5, Number.MAX_SAFE_INTEGER, now + 1, Date.parse("2026-10-10T01:00:00Z")]) {
    const tracker = new ClosedLearningLoopStatusTracker();
    tracker.observeRollover({ status: "WAITING_FOR_KST_DAY_ROLLOVER" }, now);
    tracker.observePeriods(open(start), []);
    assert.equal(tracker.snapshot().nextEvaluationEligibleAt, undefined);
  }
  const tracker = new ClosedLearningLoopStatusTracker();
  const beforeMidnight = Date.parse("2026-10-11T14:59:59Z");
  tracker.observeRollover({ status: "WAITING_FOR_KST_DAY_ROLLOVER" }, beforeMidnight);
  tracker.observePeriods(open(beforeMidnight), []);
  assert.equal(tracker.snapshot().nextEvaluationEligibleAt, Date.parse("2026-10-11T15:00:00Z"));
  tracker.observeRollover({ status: "WAITING_FOR_KST_DAY_ROLLOVER" }, Date.parse("2026-10-11T15:00:00Z"));
  assert.equal(tracker.snapshot().nextEvaluationEligibleAt, undefined);
});
