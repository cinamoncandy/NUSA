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
  assert.match(src, /\(\) => loopStatus\.snapshot\(\),\r?\n\s*\(\) => researchExperiments\?\.experimentTicksByInterval\(\) \?\? null,\r?\n\s*\);/);
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

// ---- durable cycle evidence: a restart must not erase the last lap -------------------------------------------------
const { SqliteDatabase } = require("../dist/packages/storage/src/index.js");
const { SqliteEvolutionLearningLedger } = require("../dist/packages/storage/src/evolutionLearningLedger.js");
const { ClosedLearningEvolutionLedgerRepository } = require("../dist/apps/cloud/src/closedLearningEvolutionLedgerRepository.js");

const HEX = (seed) => seed.repeat(64).slice(0, 64);
const cycleRecord = (seed, outcome, recordedAt, extra = {}) => ({
  cycleId: `closed-learning:${HEX(seed)}`, evidenceId: `evidence-${seed}`, evidenceFingerprintSha256: HEX(seed),
  decision: { decisionId: `decision-${seed}`, outcome, decisionReference: `research:decision-${seed}`, reasons: ["NOT_BETTER_THAN_COST"], ...(outcome === "QUALIFIED_FOR_LEAGUE" ? { candidateId: "candidate-b", candidateVersion: "v2" } : {}) },
  recordedAt, ...extra,
});

test("the durable ledger summary counts recorded cycles and reports the most recent one", () => {
  const db = new SqliteDatabase(":memory:");
  try {
    const repo = new ClosedLearningEvolutionLedgerRepository(new SqliteEvolutionLearningLedger(db));
    assert.deepEqual(repo.summary(), { cyclesRecorded: 0 });
    repo.append(cycleRecord("a", "REJECTED", 1_000));
    repo.append(cycleRecord("b", "INSUFFICIENT", 5_000));
    const summary = repo.summary();
    assert.equal(summary.cyclesRecorded, 2);
    assert.equal(summary.latest.cycleId, `closed-learning:${HEX("b")}`);
    assert.equal(summary.latest.decision.outcome, "INSUFFICIENT");
    // A restart (a fresh repository over the same database) reads the same truth.
    assert.deepEqual(new ClosedLearningEvolutionLedgerRepository(new SqliteEvolutionLearningLedger(db)).summary().latest.cycleId, summary.latest.cycleId);
  } finally { db.close(); }
});

test("after a restart the status shows the last durable cycle identities but keeps the per-process counters at zero", () => {
  const t = new ClosedLearningLoopStatusTracker();
  t.observeBootstrap({ status: "EXISTING_PAPER_STATE" });
  t.observeRollover({ status: "WAITING_FOR_CANONICAL_BOUNDARY" }, 1000);
  t.observeDurableCycles({ cyclesRecorded: 3, latest: cycleRecord("c", "REJECTED", 9_000) });
  const s = t.snapshot();
  assert.equal(s.cyclesEvaluated, 0, "the in-process counter is not backfilled");
  assert.equal(s.lastCycleOutcome, "REJECTED", "the durable outcome fills in when this process has seen none");
  assert.equal(s.evidence.cycleId, `closed-learning:${HEX("c")}`);
  assert.equal(s.evidence.cycleEvidenceFingerprint, HEX("c"));
  assert.equal(s.evidence.decisionId, "decision-c");
  assert.equal(s.evidence.cyclesRecorded, 3);
  assert.equal(s.evidence.lastCycleRecordedAt, 9_000);
  assert.doesNotMatch(JSON.stringify(s), /NOT_BETTER_THAN_COST/, "reasons never leave the module");
});

test("a cycle evaluated in this process wins over the durable copy", () => {
  const t = new ClosedLearningLoopStatusTracker();
  t.observeDurableCycles({ cyclesRecorded: 1, latest: cycleRecord("c", "REJECTED", 9_000) });
  t.observeRollover({ status: "CLOSED_AND_EVALUATED", cycle: { status: "EXECUTED", record: cycleRecord("d", "QUALIFIED_FOR_LEAGUE", 12_000, { paperDeployment: { deploymentId: "dep-d" } }) } }, 2000);
  t.observeDurableCycles({ cyclesRecorded: 2, latest: cycleRecord("d", "QUALIFIED_FOR_LEAGUE", 12_000) });
  const s = t.snapshot();
  assert.equal(s.cyclesEvaluated, 1);
  assert.equal(s.lastCycleOutcome, "QUALIFIED_FOR_LEAGUE");
  assert.equal(s.evidence.cycleId, `closed-learning:${HEX("d")}`);
  assert.equal(s.evidence.deploymentId, "dep-d");
  assert.equal(s.evidence.cyclesRecorded, 2);
});
