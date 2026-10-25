import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SqliteDatabase } from "../../../packages/storage/src/index";
import { PaperRealizedPeriodProducer, SqlitePaperRealizedPeriodRepository } from "./paperRealizedPeriodProducer";
import { ClosedLearningPendingPeriodReader } from "./closedLearningPendingPeriodReader";
import { ClosedLearningRolloverScheduler } from "./closedLearningRolloverScheduler";
import { buildPaperRuntimeExecutionCostEvidence, buildPaperObservedExecutionQuote, buildPaperObservedExecutionCostAttribution } from "./paperRuntimeExecutionCostEvidence";
import type { PaperAccountState, PaperFillRecord } from "./paperTradingExecutionLoop";
const HASH = "a".repeat(64);
function fill(id: string, side: "BUY" | "SELL", at: number, price: number, incomplete = false): PaperFillRecord {
  const base = { id, orderId: `order-${id}`, market: "KRW-BTC", side, quantity: 1, price, fee: 0.05, filledAt: at,
    candidateProvenance: { schemaVersion: 1 as const, source: "CIO_DECISION_BINDING" as const, decisionAt: at,
      binding: { schemaVersion: 1 as const, status: "BOUND_UNVERIFIED" as const, authority: "PAPER_RESEARCH_ONLY" as const, liveAuthority: "NONE" as const, productionMutationAllowed: false as const,
        candidateId: "candidate-a", datasetId: "dataset-a", datasetContentSha256: HASH, advisoryGeneratedAt: 100, periodStartAt: 200, advisoryFingerprintSha256: HASH, bindingFingerprintSha256: HASH } } };
  if (incomplete) return { ...base, runtimeExecutionCostEvidence: buildPaperRuntimeExecutionCostEvidence(base, price) };
  const quote = buildPaperObservedExecutionQuote({ market: base.market, observedAt: at, totalAskSize: 10, totalBidSize: 10,
    units: [{ askPrice: 100, bidPrice: 99, askSize: 10, bidSize: 10 }] });
  return { ...base, orderBookQuoteReceipt: quote.receipt, executionCostAttribution: buildPaperObservedExecutionCostAttribution(base, quote) };
}
function setup(path = ":memory:") {
  const db = new SqliteDatabase(path); const repository = new SqlitePaperRealizedPeriodRepository(db);
  let fills: PaperFillRecord[] = [];
  let account: PaperAccountState = { version: 1, initialCapital: 1000, cash: 1000, equity: 1000, realizedPnL: 0, unrealizedPnL: 0, positions: [], orders: [], fills: [], processedIdempotencyKeys: [], updatedAt: 1000 };
  const options = { retentionGuard: { referencedRecordIds: () => new Set<string>() }, sourceRuntimeSha: "b".repeat(40), readCanonicalPaperAccount: () => account, readCanonicalPaperFills: () => fills,
    readCanonicalBenchmarkEvidence: (start: number, end: number) => ({ evidenceId: "isolated-benchmark", observedAt: end, benchmarkReturn: 0, market: "KRW-BTC", source: "UPBIT_PUBLIC_TICKER" as const, startObservedAt: start, endObservedAt: end, startPrice: 100, endPrice: 100, inputFingerprintSha256: HASH }) };
  const producer = new PaperRealizedPeriodProducer(repository, options);
  producer.openPeriodFromCanonicalAccount({ periodId: "period-21", periodIndex: 21, market: "KRW-BTC", periodStartAt: 1000,
    advisory: { schemaVersion: 1, generatedAt: new Date(0).toISOString(), policy: { maximumCandidateWeight: 1, minimumEvidenceBreadth: 0, maximumCandidateCount: 5, maximumFamilyWeight: 1 }, entries: [{ id: "candidate-a", familyId: "family-a", rank: 1, leagueScore: 1, evidenceBreadth: 1, researchWeight: 1, reasons: [], sourceDatasetIds: ["dataset-a"] }], excludedCandidateIds: [], reasons: [], provenance: { sourceDatasetIds: ["dataset-a"] } },
    candidateProvenance: [{ candidateId: "candidate-a", datasetId: "dataset-a", datasetContentSha256: HASH }] });
  fills = [fill("bad-buy", "BUY", 1500, 100, true), fill("sell", "SELL", 1600, 100)];
  account = { ...account, cash: 999.9, equity: 999.9, fills, updatedAt: 2000 };
  producer.observeExecution({ observationId: "fill-observed", observedAt: 1600, status: "FILLED" });
  return { db, repository, producer, options, account: () => account, fills: () => fills,
    setAccount: (value: PaperAccountState) => { account = value; },
    advance: () => { fills = [...fills, fill("next-buy", "BUY", 2500, 100), fill("next-sell", "SELL", 2600, 99)]; account = { ...account, cash: 998.8, equity: 998.8, fills, updatedAt: 3000 }; } };
}
// All data below is isolated test evidence, never actual PAPER acceptance.
test("canonical producer disposition survives recovery/replay; the next observed-cost period closes without historical fabrication", () => {
  const s = setup();
  try {
    const original = s.repository.getPending("period-21")!; const originalFills = JSON.stringify(s.fills());
    assert.throws(() => s.producer.closePeriodFromCanonicalAccount({ periodId: "period-21", periodEndAt: 2000 }), /incomplete/);
    const result = s.producer.disposeIncompletePeriodFromCanonicalAccount({ periodId: "period-21", periodEndAt: 2000 });
    assert.deepEqual(result.disposition.original, original); assert.equal(result.disposition.validPerformanceEvidence, false);
    assert.equal(result.disposition.reason.sourceRuntimeSha, "b".repeat(40));
    assert.equal(JSON.stringify(s.fills()), originalFills); assert.equal(s.repository.list().length, 0);
    const reader = new ClosedLearningPendingPeriodReader(s.db);
    assert.equal(reader.list().length, 1); assert.equal(reader.list()[0]!.periodIndex, 22); assert.equal(reader.dispositions().length, 1);
    const restarted = new PaperRealizedPeriodProducer(s.repository, s.options);
    assert.deepEqual(restarted.disposeIncompletePeriodFromCanonicalAccount({ periodId: "period-21", periodEndAt: 2000 }), result);
    assert.throws(() => restarted.disposeIncompletePeriodFromCanonicalAccount({ periodId: "period-21", periodEndAt: 2001 }), /boundary changed/);
    s.advance(); restarted.observeExecution({ observationId: "next-fill-observed", observedAt: 2600, status: "FILLED" });
    const closed = restarted.closePeriodFromCanonicalAccount({ periodId: result.successor.periodId, periodEndAt: 3000 });
    assert.equal(closed.record.status, "COMPLETED"); assert.equal(closed.record.costEvidence.evidenceKind, "OBSERVED");
    assert.equal(s.repository.list().length, 1); assert.equal(s.repository.list()[0]!.record.periodIndex, 22);
    assert.equal(s.repository.listPendingDispositions().length, 1); assert.equal(restarted.nextPeriodIndex(), 23);
    assert.deepEqual(restarted.closePeriodFromCanonicalAccount({ periodId: result.successor.periodId, periodEndAt: 3000 }), closed);
  } finally { s.db.close(); }
});
test("open exposure and tampered incomplete receipts fail closed without removing the original pending period", () => {
  const s = setup();
  try {
    s.setAccount({ ...s.account(), positions: [{ market: "KRW-BTC", quantity: 1, averageEntryPrice: 100, realizedPnL: 0, unrealizedPnL: 0, markPrice: 100 }] });
    assert.throws(() => s.producer.disposeIncompletePeriodFromCanonicalAccount({ periodId: "period-21", periodEndAt: 2000 }), /flat boundary/);
    assert.ok(s.repository.getPending("period-21")); assert.equal(s.repository.listPendingDispositions().length, 0);
    s.setAccount({ ...s.account(), positions: [] });
    const bad = s.fills()[0]!; Object.assign(bad, { runtimeExecutionCostEvidence: { ...bad.runtimeExecutionCostEvidence!, evidenceFingerprintSha256: "0".repeat(64) } });
    assert.throws(() => s.producer.disposeIncompletePeriodFromCanonicalAccount({ periodId: "period-21", periodEndAt: 2000 }));
    assert.ok(s.repository.getPending("period-21")); assert.equal(s.repository.listPendingDispositions().length, 0);
  } finally { s.db.close(); }
});
test("scheduler uses the canonical producer, returns INELIGIBLE without entering performance or Governance", () => {
  const s = setup();
  try {
    let downstream = 0;
    const scheduler = new ClosedLearningRolloverScheduler({ listOpenPeriods: () => s.producer.listOpenPeriods(), listRealizedPeriods: () => s.repository.list(), readCanonicalPaperAccount: s.account,
      now: () => 3_601_001, evaluationPeriodMs: 3_600_000,
      closePeriodFromCanonicalAccount: (input) => s.producer.closePeriodFromCanonicalAccount(input), openPeriodFromCanonicalAccount: (input) => s.producer.openPeriodFromCanonicalAccount(input),
      disposeIncompletePeriodFromCanonicalAccount: (input) => s.producer.disposeIncompletePeriodFromCanonicalAccount(input), nextPeriodIndex: () => s.producer.nextPeriodIndex(),
      buildEvidenceIdentity: () => { downstream++; throw Error("must not qualify ineligible evidence"); }, runClosedLearningCycle: () => { downstream++; throw Error("must not run cycle"); } });
    const result = scheduler.runOnce();
    assert.equal(result.status, "INCOMPLETE_PERIOD_INELIGIBLE"); assert.equal(downstream, 0);
    assert.equal(scheduler.runOnce().status, "WAITING_FOR_CANONICAL_BOUNDARY"); assert.equal(s.repository.listPendingDispositions().length, 1);
  } finally { s.db.close(); }
});


test("disk reopen rehydrates the same disposition across runtime revisions and reserves a retired successor index", () => {
  const dir = mkdtempSync(join(tmpdir(), "nusa-period-operating-")); const path = join(dir, "state.sqlite");
  const s = setup(path); let reopened: SqliteDatabase | undefined; let closed = false;
  try {
    const result = s.producer.disposeIncompletePeriodFromCanonicalAccount({ periodId: "period-21", periodEndAt: 2000 });
    s.db.close(); closed = true; reopened = new SqliteDatabase(path);
    const repository = new SqlitePaperRealizedPeriodRepository(reopened);
    const producer = new PaperRealizedPeriodProducer(repository, { ...s.options, sourceRuntimeSha: "c".repeat(40) });
    const replay = producer.disposeIncompletePeriodFromCanonicalAccount({ periodId: "period-21", periodEndAt: 2000 });
    assert.equal(replay.disposition.evidenceFingerprintSha256, result.disposition.evidenceFingerprintSha256);
    assert.equal(replay.disposition.reason.sourceRuntimeSha, "b".repeat(40));
    assert.equal(new ClosedLearningPendingPeriodReader(reopened).list().length, 1);
    producer.retireOpenPeriodForUnstreamedMarket(result.successor.periodId, ["KRW-ETH"]);
    assert.equal(producer.nextPeriodIndex(), 23); assert.equal(repository.listPendingDispositions().length, 1);
  } finally { if (!closed) s.db.close(); reopened?.close(); rmSync(dir, { recursive: true, force: true }); }
});
