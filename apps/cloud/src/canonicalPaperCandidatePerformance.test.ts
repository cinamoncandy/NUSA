import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { PaperForwardPeriodEvidence } from "../../../packages/contracts/src/paperForwardEvidence";
import type { PaperAccountState } from "./paperTradingExecutionLoop";
import { buildCanonicalPaperCandidatePerformance } from "./canonicalPaperCandidatePerformance";

const HASH = "a".repeat(64);
const binding = Object.freeze({
  schemaVersion: 1 as const,
  status: "BOUND_UNVERIFIED" as const,
  authority: "PAPER_RESEARCH_ONLY" as const,
  liveAuthority: "NONE" as const,
  productionMutationAllowed: false as const,
  candidateId: "candidate-a",
  datasetId: "dataset-a",
  datasetContentSha256: HASH,
  advisoryGeneratedAt: 500,
  periodStartAt: 1_000,
  advisoryFingerprintSha256: HASH,
  bindingFingerprintSha256: HASH,
});

function period(index: number, grossReturn: number, status: PaperForwardPeriodEvidence["status"] = "COMPLETED"): PaperForwardPeriodEvidence {
  const start = 1_000 + index * 2_000;
  return Object.freeze({
    periodId: `period-${index}`,
    candidateId: "candidate-a",
    datasetId: "dataset-a",
    datasetContentSha256: HASH,
    advisoryGeneratedAt: 500,
    periodStartAt: start,
    periodEndAt: start + 1_000,
    grossReturn,
    turnover: 1,
    feeRate: 0.0005,
    spreadRate: 0,
    slippageRate: 0.0005,
    status,
  });
}

function account(): PaperAccountState {
  return Object.freeze({
    version: 1 as const,
    initialCapital: 10_000,
    cash: 10_000,
    equity: 10_000,
    realizedPnL: 0,
    unrealizedPnL: 0,
    positions: Object.freeze([]),
    orders: Object.freeze([
      { id: "o1", idempotencyKey: "k1", market: "KRW-BTC", side: "BUY" as const, quantity: 1, price: 100, fee: 0.05, status: "FILLED" as const, createdAt: 1_100, filledAt: 1_200 },
      { id: "o2", idempotencyKey: "k2", market: "KRW-BTC", side: "SELL" as const, quantity: 1, price: 110, fee: 0.055, status: "FILLED" as const, createdAt: 3_100, filledAt: 3_200 },
    ]),
    fills: Object.freeze([
      { id: "f1", orderId: "o1", market: "KRW-BTC", side: "BUY" as const, quantity: 1, price: 100, fee: 0.05, filledAt: 1_200, candidateProvenance: Object.freeze({ schemaVersion: 1 as const, source: "CIO_DECISION_BINDING" as const, decisionAt: 1_050, binding }) },
      { id: "f2", orderId: "o2", market: "KRW-BTC", side: "SELL" as const, quantity: 1, price: 110, fee: 0.055, filledAt: 3_200, candidateProvenance: Object.freeze({ schemaVersion: 1 as const, source: "CIO_DECISION_BINDING" as const, decisionAt: 3_050, binding }) },
    ]),
    processedIdempotencyKeys: Object.freeze(["k1", "k2"]),
    updatedAt: 4_000,
  });
}

const quality = Object.freeze({ acceptableSlippageBps: 5, poorSlippageBps: 20, acceptableLatencyMs: 500, poorLatencyMs: 2_000 });

describe("buildCanonicalPaperCandidatePerformance", () => {
  it("derives the existing PAPER summary from candidate-bound periods and fills", () => {
    const result = buildCanonicalPaperCandidatePerformance({ candidateId: "candidate-a", periods: [period(0, 0.02), period(1, -0.01), period(2, 0.03)], account: account(), executionQualityPolicy: quality });
    assert.ok(result);
    assert.equal(result.tradeCount, 2);
    assert.equal(result.availabilityRatio, 1);
    assert.equal(result.unresolvedFaultCount, 0);
    assert.equal(result.killSwitchActivationCount, 0);
    assert.equal(result.executionQualityScore, 100);
    assert.ok(Number.isFinite(result.sharpeRatio));
    assert.ok(result.profitFactor > 0);
    assert.ok(result.maximumDrawdown > 0);
    assert.equal(result.observationDays, 0, "seconds of evidence cannot claim a whole independent day");
  });
  it("counts covered whole days, not hourly partitions or unobserved gaps", () => {
    const hourly = (count: number, duration: number) => Array.from({ length: count }, (_, index) => ({ ...period(index, index % 2 === 0 ? 0.02 : -0.01), periodStartAt: 1_000 + index * 3_600_000, periodEndAt: 1_000 + index * 3_600_000 + duration }));
    const evaluate = (periods: readonly PaperForwardPeriodEvidence[]) => buildCanonicalPaperCandidatePerformance({ candidateId: "candidate-a", periods, account: account(), executionQualityPolicy: quality });
    assert.equal(evaluate(hourly(23, 3_600_000))?.observationDays, 0);
    assert.equal(evaluate(hourly(24, 3_600_000))?.observationDays, 1);
    assert.equal(evaluate(hourly(48, 60_000))?.observationDays, 0, "uncovered gaps are not observation days");
  });
  it("daily scoring is invariant to splitting continuous daily evidence into hourly partitions", () => {
    const hourly = Array.from({ length: 72 }, (_, index) => ({ ...period(index, index < 24 ? 0.005 : index < 48 ? -0.002 : 0.007), periodStartAt: 1_000 + index * 3_600_000, periodEndAt: 1_000 + (index + 1) * 3_600_000 }));
    const daily = Array.from({ length: 3 }, (_, index) => {
      const gross = hourly[index * 24]!.grossReturn;
      const net = (1 + gross - 0.001) ** 24 - 1;
      return { ...period(index, net + 0.024), turnover: 24, periodStartAt: 1_000 + index * 86_400_000, periodEndAt: 1_000 + (index + 1) * 86_400_000 };
    });
    const evaluate = (periods: readonly PaperForwardPeriodEvidence[]) => buildCanonicalPaperCandidatePerformance({ candidateId: "candidate-a", periods, account: account(), executionQualityPolicy: quality, requireIndependentDays: true });
    const h = evaluate(hourly);
    const d = evaluate(daily);
    assert.ok(h && d);
    assert.equal(h.observationDays, 3);
    assert.equal(d.observationDays, 3);
    assert.ok(Math.abs(h.sharpeRatio - d.sharpeRatio) < 1e-10);
    assert.ok(Math.abs(h.profitFactor - d.profitFactor) < 1e-10);
    assert.ok(Math.abs(h.netReturn - d.netReturn) < 1e-10);
    assert.equal(evaluate(hourly.slice(0, 30)), undefined, "30 hours are not 30 independent-day samples");
    assert.equal(evaluate(hourly.map((p) => ({ ...p, periodEndAt: p.periodStartAt + 60_000 }))), undefined, "missing intervals never create whole-day samples");
  });

  it("keeps rejected and halted periods in reliability/failure evidence", () => {
    const result = buildCanonicalPaperCandidatePerformance({ candidateId: "candidate-a", periods: [period(0, 0.02), period(1, -0.01), period(2, 0.03), period(3, 0, "REJECTED"), period(4, 0, "HALTED")], account: account(), executionQualityPolicy: quality });
    assert.ok(result);
    assert.equal(result.availabilityRatio, 3 / 5);
    assert.equal(result.unresolvedFaultCount, 1);
    assert.equal(result.killSwitchActivationCount, 1);
  });

  it("returns unavailable instead of fabricating Sharpe/profit factor when variation is insufficient", () => {
    assert.equal(buildCanonicalPaperCandidatePerformance({ candidateId: "candidate-a", periods: [period(0, 0.02), period(1, 0.02)], account: account(), executionQualityPolicy: quality }), undefined);
  });

  it("returns unavailable when no exact candidate-bound fills exist", () => {
    const empty = Object.freeze({ ...account(), orders: Object.freeze([]), fills: Object.freeze([]), processedIdempotencyKeys: Object.freeze([]) });
    assert.equal(buildCanonicalPaperCandidatePerformance({ candidateId: "candidate-a", periods: [period(0, 0.02), period(1, -0.01)], account: empty, executionQualityPolicy: quality }), undefined);
  });

  it("fails closed on candidate/dataset provenance drift", () => {
    const bad = Object.freeze({ ...period(1, -0.01), datasetId: "dataset-other" });
    assert.throws(() => buildCanonicalPaperCandidatePerformance({ candidateId: "candidate-a", periods: [period(0, 0.02), bad], account: account(), executionQualityPolicy: quality }), /provenance mismatch/);
  });
});
