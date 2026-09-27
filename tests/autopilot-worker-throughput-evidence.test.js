"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");

const {
  summariseWorkerThroughput,
  toConcurrencyEvidence,
  MINIMUM_THROUGHPUT_SAMPLE,
  evaluateWorkerPoolConcurrency,
  workerOutcomeFromTelemetry,
  workerOutcomeWithReleaseCompletion,
} = require("../dist/apps/autopilot/src/workerThroughputEvidence.js");
const { adviseConcurrency } = require("../dist/apps/autopilot/src/concurrencyAdvisor.js");

/**
 * adviseConcurrency has existed and been fail-closed for a while, but nothing in the repository
 * calls it, because nothing produced a ConcurrencyEvidence. These pin the property that makes
 * producing one safe: an input that was not measured must never arrive as a measured zero.
 *
 * Reporting missing CI utilisation as 0, or a missing throughput trend as flat, both read as
 * headroom -- and headroom is exactly what makes the advisor ask for more concurrency.
 */

const HOUR = 3_600_000;
const START = 1_787_000_000_000;

function outcome(id, { verified = true, reworked = false, conflicted = false, at = START + HOUR / 2 } = {}) {
  return {
    metrics: {
      taskId: id,
      workerId: `worker-${id}`,
      queuedAt: START,
      claimedAt: START + 1_000,
      startedAt: START + 2_000,
      completedAt: at,
      queueWaitMs: 1_000,
      claimToStartMs: 1_000,
      claimToCompleteMs: at - (START + 1_000),
      totalMs: at - START,
    },
    verified,
    reworked,
    conflicted,
  };
}

function window(overrides = {}) {
  return {
    source: "worker-pool-metrics",
    windowStartedAt: START,
    windowEndedAt: START + HOUR,
    outcomes: Array.from({ length: 8 }, (_, index) => outcome(`t${index}`)),
    currentWip: 1,
    maxWip: 4,
    ciUtilization: 0.4,
    priorVerifiedTasksPerHour: 6,
    ...overrides,
  };
}

test("a fully measured window is VERIFIED and reports real rates", () => {
  const summary = summariseWorkerThroughput(window());
  assert.equal(summary.confidence, "VERIFIED");
  assert.deepEqual([...summary.unmeasured], []);
  assert.equal(summary.sampleSize, 8);
  assert.equal(summary.verifiedTasksPerHour, 8);
  assert.equal(summary.conflictRate, 0);
  assert.equal(summary.reworkRate, 0);
  assert.equal(summary.throughputTrend, 2);
  assert.equal(summary.ciUtilization, 0.4);
});

test("an unmeasured input is null and named, never a zero", () => {
  const noCi = summariseWorkerThroughput(window({ ciUtilization: null }));
  assert.equal(noCi.ciUtilization, null, "missing CI utilisation must not read as idle capacity");
  assert.ok(noCi.unmeasured.includes("ci-utilization"));
  assert.equal(noCi.confidence, "UNKNOWN");

  const noPrior = summariseWorkerThroughput(window({ priorVerifiedTasksPerHour: null }));
  assert.equal(noPrior.throughputTrend, null, "a trend needs two measurements; one window is not a flat trend");
  assert.ok(noPrior.unmeasured.includes("throughput-trend"));
  assert.equal(noPrior.confidence, "UNKNOWN");
});

test("a sample too small for a rate is INSUFFICIENT, and its rates are null", () => {
  const small = summariseWorkerThroughput(window({
    outcomes: Array.from({ length: MINIMUM_THROUGHPUT_SAMPLE - 1 }, (_, index) => outcome(`s${index}`, { reworked: index === 0 })),
  }));
  assert.equal(small.confidence, "INSUFFICIENT");
  // With 4 outcomes a single repair round would read as a 25% rework rate. That is arithmetic, not evidence.
  assert.equal(small.reworkRate, null);
  assert.equal(small.conflictRate, null);
  assert.equal(small.verifiedTasksPerHour, null);
});

test("outcomes that completed outside the window are not counted against its duration", () => {
  const summary = summariseWorkerThroughput(window({
    outcomes: [
      ...Array.from({ length: 6 }, (_, index) => outcome(`in${index}`)),
      outcome("before", { at: START - 1 }),
      outcome("after", { at: START + HOUR + 1 }),
    ],
  }));
  assert.equal(summary.sampleSize, 6);
  assert.equal(summary.verifiedTasksPerHour, 6);
});

test("a malformed window yields UNKNOWN with every rate null, not a default", () => {
  for (const bad of [
    window({ source: "" }),
    window({ windowEndedAt: START }),
    window({ currentWip: 0 }),
    window({ currentWip: 5, maxWip: 4 }),
    window({ outcomes: [{ verified: true }] }),
  ]) {
    const summary = summariseWorkerThroughput(bad);
    assert.equal(summary.confidence, "UNKNOWN");
    assert.deepEqual(
      [summary.verifiedTasksPerHour, summary.conflictRate, summary.reworkRate, summary.throughputTrend, summary.ciUtilization],
      [null, null, null, null, null],
    );
  }
});

test("unverified evidence cannot talk the advisor into more concurrency, even if confidence is ignored", () => {
  // The advisor already refuses on confidence. This checks the second line of defence: the numeric
  // fields of unverified evidence are filled so that they cannot read as headroom either.
  for (const broken of [
    window({ ciUtilization: null }),
    window({ priorVerifiedTasksPerHour: null }),
    window({ outcomes: [outcome("only")] }),
    window({ source: "" }),
  ]) {
    const evidence = toConcurrencyEvidence(summariseWorkerThroughput(broken), 1, 4);
    assert.ok(evidence.throughputTrend <= 0, "an unmeasured trend must not read as growth");
    assert.equal(evidence.conflictRate, 1);
    assert.equal(evidence.reworkRate, 1);
    assert.equal(evidence.ciUtilization, 1);
    assert.notEqual(adviseConcurrency(evidence).action, "INCREASE_BY_ONE");
  }
});

test("measured headroom does reach the advisor, so this is not just a refusal machine", () => {
  const evidence = toConcurrencyEvidence(summariseWorkerThroughput(window()), 1, 4);
  assert.equal(evidence.confidence, "VERIFIED");
  const recommendation = adviseConcurrency(evidence);
  assert.equal(recommendation.action, "INCREASE_BY_ONE");
  assert.equal(recommendation.recommendedWip, 2);
  assert.equal(recommendation.mutationAllowed, false, "the advisor only ever advises");
});

test("this repository's actually measured churn does not justify raising concurrency", () => {
  // Measured from 40 consecutive ci.yml runs, 2026-09-20 08:04-11:20Z: 18% of runs cancelled and
  // 11% failed, so 29% ended without a verified result, and 11 branches ran CI two to four times.
  // Fed through the real advisor, that must not come out as headroom.
  const measured = window({
    outcomes: [
      ...Array.from({ length: 7 }, (_, index) => outcome(`ok${index}`)),
      ...Array.from({ length: 3 }, (_, index) => outcome(`redo${index}`, { verified: false, reworked: true })),
    ],
    ciUtilization: 0.4,
    priorVerifiedTasksPerHour: 6,
  });
  const summary = summariseWorkerThroughput(measured);
  assert.equal(summary.confidence, "VERIFIED");
  assert.equal(summary.reworkRate, 0.3);
  const recommendation = adviseConcurrency(toConcurrencyEvidence(summary, 2, 4));
  assert.equal(recommendation.action, "DECREASE_BY_ONE", "30% rework is contention pressure, not headroom");
  assert.equal(recommendation.reason, "verified-contention-or-capacity-pressure");
});


test("production evaluation boundary turns measured worker outcomes into a non-mutating recommendation", () => {
  const recommendation = evaluateWorkerPoolConcurrency(window());
  assert.equal(recommendation.action, "INCREASE_BY_ONE");
  assert.equal(recommendation.recommendedWip, 2);
  assert.equal(recommendation.mutationAllowed, false);
});

test("execution telemetry records worker outcome but cannot assert canonical completion", () => {
  const metrics = outcome("telemetry").metrics;
  const telemetry = {
    schemaVersion: 1,
    telemetryId: "0".repeat(64),
    executionId: "execution-telemetry",
    timestampMs: metrics.completedAt,
    trigger: "worker-complete",
    decision: "record-outcome",
    action: "ACTION",
    selectedExecutor: "codex",
    dedupeKey: "dedupe-telemetry",
    attempt: 2,
    retry: { attempt: 2, maxAttempts: 3, backoffMs: 1000 },
    recovery: { action: "retry", reason: "validation-failed" },
    checkpoint: { checkpointId: "checkpoint-1", resumed: true },
    durationMs: metrics.claimToCompleteMs,
    result: "SUCCESS",
    validationResult: "SUCCESS",
    ciResult: "SUCCESS",
    failureClass: null,
    commitSha: null,
    pullRequestNumber: null,
    failureReason: null,
    liveAuthority: "NONE",
    productionMutationAllowed: false,
    aiAuthority: "ZERO_AUTHORITY",
  };
  const measured = workerOutcomeFromTelemetry(metrics, telemetry);
  assert.ok(measured);
  assert.equal(measured.verified, false, "worker telemetry cannot prove exact-head CI + Audit + Release");
  assert.equal(measured.reworked, true);
  assert.equal(measured.conflicted, false);
  assert.equal(workerOutcomeFromTelemetry(metrics, { ...telemetry, timestampMs: metrics.completedAt + 1 }), null);
});

test("failed conflict telemetry is measured as conflict and never as verified completion", () => {
  const metrics = outcome("conflict").metrics;
  const telemetry = {
    schemaVersion: 1,
    telemetryId: "0".repeat(64),
    executionId: "execution-conflict",
    timestampMs: metrics.completedAt,
    trigger: "worker-complete",
    decision: "record-outcome",
    action: "ACTION",
    selectedExecutor: "codex",
    dedupeKey: "dedupe-conflict",
    attempt: 1,
    retry: { attempt: 1, maxAttempts: 3, backoffMs: 0 },
    recovery: { action: "none", reason: null },
    checkpoint: { checkpointId: null, resumed: false },
    durationMs: metrics.claimToCompleteMs,
    result: "FAILED",
    validationResult: "FAILED",
    ciResult: "NOT_RUN",
    failureClass: "deterministic",
    commitSha: null,
    pullRequestNumber: null,
    failureReason: "CONFLICT_KEY_ACTIVE",
    liveAuthority: "NONE",
    productionMutationAllowed: false,
    aiAuthority: "ZERO_AUTHORITY",
  };
  const measured = workerOutcomeFromTelemetry(metrics, telemetry);
  assert.ok(measured);
  assert.equal(measured.verified, false);
  assert.equal(measured.reworked, false);
  assert.equal(measured.conflicted, true);
});

test("only matching canonical RELEASE_COMPLETE evidence verifies a worker outcome", () => {
  const base = outcome("release-join", { verified: false });
  const commitSha = "a".repeat(40);
  const codingEvidence = {
    outcome: { pullRequestNumber: 2304, commitSha },
  };
  const complete = {
    status: "RELEASE_COMPLETE",
    pullRequestNumber: 2304,
    expectedHeadSha: commitSha,
  };
  assert.equal(workerOutcomeWithReleaseCompletion(base, codingEvidence, complete).verified, true);
  assert.equal(workerOutcomeWithReleaseCompletion(base, codingEvidence, { ...complete, status: "CONVERGENCE_INCOMPLETE" }).verified, false);
  assert.equal(workerOutcomeWithReleaseCompletion(base, codingEvidence, { ...complete, pullRequestNumber: 2305 }).verified, false);
  assert.equal(workerOutcomeWithReleaseCompletion(base, codingEvidence, { ...complete, expectedHeadSha: "b".repeat(40) }).verified, false);
  assert.equal(workerOutcomeWithReleaseCompletion(base, { outcome: { pullRequestNumber: null, commitSha } }, complete).verified, false);
});
