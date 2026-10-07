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
  assert.doesNotMatch(JSON.stringify(s), /period-secret-id/, "rollover periodId/reason text never leaks");
  assert.deepEqual(Object.keys(s).filter((key) => key !== "evidence").includes("deploymentId"), false, "identities live only under evidence");
  assert.equal(s.evidence.deploymentId, "d");
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
  assert.match(src, /loopStatus\.observePeriods\(periods\.listOpenPeriods\(\)\[0\], periods\.listRealizedPeriods\(\)\)/, "every tick reads the canonical period identities");
  assert.match(src, /\(\) => loopStatus\.snapshot\(\),\r?\n\s*\);/);
});

test("evidence correlates the open period, the latest realized period and the latest Research cycle", () => {
  const t = new ClosedLearningLoopStatusTracker();
  t.observeRollover({ status: "WAITING_FOR_KST_DAY_ROLLOVER" }, 1);
  const hex = (c) => c.repeat(64);
  const open = { periodId: "owner-baseline:KRW-XRP:1791331979980", market: "KRW-XRP", periodStartAt: 1791331979980, candidateProvenance: [{ candidateId: "owner-baseline-sma-5-20" }], observations: [{ status: "FILLED" }, { status: "WAIT" }] };
  const realized = [
    { record: { recordId: "old", periodIndex: 0, periodEndAt: 10, costEvidence: { evidenceFingerprintSha256: hex("b") } } },
    { record: { recordId: "owner-baseline:KRW-BTC:1", periodIndex: 1, periodEndAt: 20, canonicalOutcomeReceiptFingerprint: hex("a"), costEvidence: { evidenceFingerprintSha256: hex("c") } } },
  ];
  t.observePeriods(open, realized);
  assert.deepEqual(t.snapshot().evidence, {
    openPeriodId: open.periodId, openMarket: "KRW-XRP", openCandidateId: "owner-baseline-sma-5-20", openPeriodStartAt: 1791331979980, openObservations: 2, openFilledObservations: 1,
    realizedPeriods: 2, realizedPeriodId: "owner-baseline:KRW-BTC:1", realizedPeriodEndAt: 20, realizedOutcomeFingerprint: hex("a"), realizedCostEvidenceFingerprint: hex("c"),
  });
  t.observeRollover({ status: "CLOSED_AND_EVALUATED", cycle: { status: "EXECUTED", record: { cycleId: "closed-learning:c1", evidenceId: "closed-learning-paper:x", evidenceFingerprintSha256: hex("d"), decision: { decisionId: "decision-1", outcome: "INSUFFICIENT", decisionReference: "research:decision-1" } } } }, 2);
  const evidence = t.snapshot().evidence;
  assert.equal(evidence.cycleId, "closed-learning:c1");
  assert.equal(evidence.cycleEvidenceFingerprint, hex("d"));
  assert.equal(evidence.decisionReference, "research:decision-1");
  assert.equal(evidence.openPeriodId, open.periodId, "period identities survive the next rollover tick");
  assert.equal(evidence.decisionCandidateId, undefined);
});
