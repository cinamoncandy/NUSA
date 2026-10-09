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
  assert.match(src, /loopStatus\.observeError\(Date\.now\(\)\); persistLastBlocked\(\); throw error;/, "an error tick persists its reason before the scheduler fails closed");
  assert.match(src, /loopStatus\.observeRollover\(await runClosedLearningRolloverAsync\(\), Date\.now\(\)\);\r?\n\s*persistLastBlocked\(\);/, "a blocked tick persists its reason");
  assert.match(src, /loopStatus\.seedLastBlocked\(readClosedLearningBlocked\(config\.cloudStateDbPath\)\)/, "the persisted reason seeds the status after a restart");
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

// ---- review hardening ---------------------------------------------------------------------------------------------
test("the durable summary replays the ledger once and counts only valid cycles", () => {
  const db = new SqliteDatabase(":memory:");
  try {
    const ledger = new SqliteEvolutionLearningLedger(db);
    const repo = new ClosedLearningEvolutionLedgerRepository(ledger);
    repo.append(cycleRecord("a", "REJECTED", 1_000));
    repo.append(cycleRecord("b", "INSUFFICIENT", 5_000));
    // A namespace-shaped but invalid entry in the shared ledger: neither counted nor allowed to hide the others.
    ledger.append({ opportunityId: "closed-learning:not-a-cycle:decision", problem: "x", hypothesis: "{}", evidenceReferences: ["closed-learning-evidence:e", "closed-learning-fingerprint:" + HEX("f")], changeReference: "x", validationStatus: "REJECTED", outcome: "UNDERPERFORMED", failureReason: "x", rollbackReference: null, reusable: true, recordedAt: new Date(9_000).toISOString() });
    let replays = 0;
    const counting = new ClosedLearningEvolutionLedgerRepository({ append: (r) => ledger.append(r), list: () => { replays += 1; return ledger.list(); } });
    const summary = counting.summary();
    assert.equal(replays, 1, "one replay no matter how many cycles");
    assert.equal(summary.cyclesRecorded, 2, "the invalid entry is not a recorded cycle");
    assert.equal(summary.latest.cycleId, `closed-learning:${HEX("b")}`);
  } finally { db.close(); }
});

test("a ledger failure propagates from summary(), and clearing withdraws every durable value that was published", () => {
  const broken = new ClosedLearningEvolutionLedgerRepository({ append: () => { throw new Error("x"); }, list: () => { throw new Error("ledger corrupted"); } });
  assert.throws(() => broken.summary(), /ledger corrupted/);
  const t = new ClosedLearningLoopStatusTracker();
  t.observeRollover({ status: "WAITING_FOR_CANONICAL_BOUNDARY" }, 1000);
  t.observeDurableCycles({ cyclesRecorded: 2, latest: cycleRecord("c", "REJECTED", 9_000) });
  assert.equal(t.snapshot().lastCycleOutcome, "REJECTED");
  t.clearDurableCycles();
  const s = t.snapshot();
  assert.equal(s.lastCycleOutcome, undefined, "the durable outcome is withdrawn, not left as if current");
  assert.equal(s.evidence, undefined, "no durable identity or count remains");
});

test("clearing the durable copy never removes what a cycle evaluated in this process observed", () => {
  const t = new ClosedLearningLoopStatusTracker();
  t.observeDurableCycles({ cyclesRecorded: 1, latest: cycleRecord("c", "REJECTED", 9_000) });
  t.observeRollover({ status: "CLOSED_AND_EVALUATED", cycle: { status: "EXECUTED", record: cycleRecord("d", "INSUFFICIENT", 12_000) } }, 2000);
  t.clearDurableCycles();
  const s = t.snapshot();
  assert.equal(s.lastCycleOutcome, "INSUFFICIENT");
  assert.equal(s.evidence.cycleId, `closed-learning:${HEX("d")}`);
  assert.equal(s.evidence.cyclesRecorded, undefined);
});

test("the durable evidence is visible even when the tick fails before a rollover result", () => {
  const t = new ClosedLearningLoopStatusTracker();
  t.observeDurableCycles({ cyclesRecorded: 4, latest: cycleRecord("c", "REJECTED", 9_000) });
  assert.equal(t.snapshot(), null, "nothing is published before the first tick result");
  t.observeError(1000);
  const s = t.snapshot();
  assert.equal(s.rollover, "ERROR");
  assert.equal(s.evidence.cyclesRecorded, 4);
  assert.equal(s.lastCycleOutcome, "REJECTED");
});

test("cycle failure receipts survive restart, deduplicate replay, and remain beside a later successful cycle", () => {
  const db = new SqliteDatabase(":memory:");
  try {
    const ledger = new SqliteEvolutionLearningLedger(db);
    const repo = new ClosedLearningEvolutionLedgerRepository(ledger, () => 7_000);
    const input = { closedPeriodId: "period-7", evidenceId: "closed-learning-paper:e7", evidenceFingerprintSha256: HEX("e"), sourceCommitSha: "a".repeat(40), runtimeSourceCommitSha: "b".repeat(40), stage: "CYCLE", code: "RESEARCH_WORKER_FAILED" };
    const first = repo.appendFailure(input);
    assert.equal(repo.appendFailure(input).failureId, first.failureId);
    assert.equal(repo.failureSummary().failuresRecorded, 1, "same deterministic failure is appended once");
    repo.append(cycleRecord("7", "REJECTED", 8_000));
    const restarted = new ClosedLearningEvolutionLedgerRepository(ledger).failureSummary();
    assert.equal(restarted.failuresRecorded, 1, "success does not rewrite failure history");
    const t = new ClosedLearningLoopStatusTracker();
    t.observeDurableFailures(restarted);
    t.observeDurableCycles(repo.summary());
    t.observeRollover({ status: "WAITING_FOR_CANONICAL_BOUNDARY" }, 9_000);
    assert.equal(t.snapshot().evidence.latestFailurePeriodId, "period-7");
    assert.equal(t.snapshot().evidence.latestFailureCode, "RESEARCH_WORKER_FAILED");
    assert.equal(t.snapshot().evidence.cyclesRecorded, 1, "latest success is exposed separately");
    assert.doesNotMatch(JSON.stringify(t.snapshot()), /price|balance|exception/i);
  } finally { db.close(); }
});

test("malformed durable cycle failure evidence fails closed", () => {
  const db = new SqliteDatabase(":memory:");
  try {
    const ledger = new SqliteEvolutionLearningLedger(db);
    ledger.append({ opportunityId: "closed-learning-failure:" + HEX("f"), problem: "x", evidenceReferences: ["closed-learning-evidence:e"], hypothesis: "{}", changeReference: "a".repeat(40), validationStatus: "CYCLE_FAILURE", outcome: "FAILED", failureReason: "FAILED", rollbackReference: null, reusable: true, recordedAt: new Date(1_000).toISOString() });
    assert.throws(() => new ClosedLearningEvolutionLedgerRepository(ledger).failureSummary(), /malformed|invalid/);
  } finally { db.close(); }
});

test("cycle failure receipts reject unbounded or non-canonical identities", () => {
  const db = new SqliteDatabase(":memory:");
  try {
    const repo = new ClosedLearningEvolutionLedgerRepository(new SqliteEvolutionLearningLedger(db));
    const input = { closedPeriodId: "period-7", evidenceId: "closed-learning-paper:e7", evidenceFingerprintSha256: HEX("e"), sourceCommitSha: "a".repeat(40), runtimeSourceCommitSha: "b".repeat(40), stage: "CYCLE", code: "RESEARCH_WORKER_FAILED" };
    assert.throws(() => repo.appendFailure({ ...input, closedPeriodId: "p".repeat(513) }), /input is invalid/);
    assert.throws(() => repo.appendFailure({ ...input, evidenceId: " closed-learning-paper:e7" }), /input is invalid/);
    assert.equal(repo.failureSummary().failuresRecorded, 0, "rejected identities never reach the durable ledger");
  } finally { db.close(); }
});

// ---- the reason a tick was blocked must outlive the next tick ------------------------------------------------------
test("a BLOCKED reason is kept after later ticks succeed, so a transient failure is still readable", () => {
  const t = new ClosedLearningLoopStatusTracker();
  t.observeRollover({ status: "WAITING_FOR_KST_DAY_ROLLOVER" }, 1000);
  assert.equal(t.snapshot().lastBlockedReason, undefined, "nothing blocked yet");
  t.observeRollover({ status: "BLOCKED", reason: "MISSING_BENCHMARK_EVIDENCE:detail text never leaves" }, 2000);
  t.observeRollover({ status: "STALLED_PERIOD_REOPENED", reason: "continued:closed-learning-rollover:2:1" }, 2030);
  const s = t.snapshot();
  assert.equal(s.rollover, "STALLED_PERIOD_REOPENED", "the live step moved on");
  assert.equal(s.lastBlockedReason, "MISSING_BENCHMARK_EVIDENCE", "the earlier block is still reported, as a code only");
  assert.equal(s.lastBlockedAt, 2000);
  assert.doesNotMatch(JSON.stringify(s), /detail text/);
});

test("a later block replaces the earlier one, an uncoded block is labelled, and an error tick is recorded", () => {
  const t = new ClosedLearningLoopStatusTracker();
  t.observeRollover({ status: "BLOCKED", reason: "free text without a code" }, 1000);
  assert.equal(t.snapshot().lastBlockedReason, "BLOCKED_WITHOUT_CODE");
  t.observeRollover({ status: "BLOCKED", reason: "CANDIDATE_BINDING_MIXED" }, 2000);
  assert.equal(t.snapshot().lastBlockedReason, "CANDIDATE_BINDING_MIXED");
  t.observeError(3000);
  assert.equal(t.snapshot().lastBlockedReason, "TICK_ERROR");
  assert.equal(t.snapshot().lastBlockedAt, 3000);
});

test("an error on the very first tick is recorded too", () => {
  const t = new ClosedLearningLoopStatusTracker();
  t.observeError(500);
  assert.equal(t.snapshot().lastBlockedReason, "TICK_ERROR");
});

test("shadow totals appear in the evidence as integers, are withdrawn when malformed or not started, and the runtime wires them", () => {
  const t = new ClosedLearningLoopStatusTracker();
  t.observeRollover({ status: "WAITING_FOR_KST_DAY_ROLLOVER" }, 1);
  t.observeShadow({ since: 5, trades: 3, wins: 1, grossGainBp: 40, grossLossBp: 90, feeBp: 30 });
  assert.deepEqual({ ...t.snapshot().evidence }, { shadowSince: 5, shadowTrades: 3, shadowWins: 1, shadowGrossGainBp: 40, shadowGrossLossBp: 90, shadowFeeBp: 30 });
  t.observeShadow({ since: 5, trades: 1, wins: 2, grossGainBp: 0, grossLossBp: 0, feeBp: 0 });
  assert.equal(t.snapshot().evidence, undefined, "wins above trades is malformed and withdrawn");
  t.observeShadow({ since: 0, trades: 0, wins: 0, grossGainBp: 0, grossLossBp: 0, feeBp: 0 });
  assert.equal(t.snapshot().evidence, undefined, "a shadow that has not started publishes nothing");
  t.observeShadow(undefined);
  assert.equal(t.snapshot().evidence, undefined);
  const src = fs.readFileSync(path.join(__dirname, "..", "apps", "cloud", "src", "closedLearningProductionRuntime.ts"), "utf8");
  assert.match(src, /baselineShadow\?\.observe\(market, bars\)/, "the shadow reads the same completed minute bars the strategy reads");
  assert.match(src, /loopStatus\.observeShadow\(baselineShadow\.summary\(\)\)/);
  assert.match(src, /writeBaselineShadowRecord\(config\.cloudStateDbPath, persistable\)\) baselineShadow\.markUnpersisted\(\)/, "a failed write is retried on a later tick");
});
