import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { admitPaperForwardEvidence, PaperForwardEvidenceAdmissionError, type PaperForwardPeriodEvidence } from "./paperForwardEvidenceAdmission";

const period = (index: number, overrides: Partial<PaperForwardPeriodEvidence> = {}): PaperForwardPeriodEvidence => ({
  periodId: `period-${index}`,
  candidateId: "sma-5-20",
  datasetId: "dataset-1",
  datasetContentSha256: "abc123",
  advisoryGeneratedAt: index * 10_000,
  periodStartAt: index * 10_000 + 1_000,
  periodEndAt: index * 10_000 + 9_000,
  grossReturn: 0.01,
  turnover: 0.5,
  feeRate: 0.0005,
  spreadRate: 0.0005,
  slippageRate: 0.0005,
  status: "COMPLETED",
  ...overrides,
});

const code = (fn: () => unknown): string => {
  try { fn(); } catch (error) {
    if (error instanceof PaperForwardEvidenceAdmissionError) return error.code;
    throw error;
  }
  throw new Error("expected PaperForwardEvidenceAdmissionError");
};

describe("PAPER forward evidence admission", () => {
  it("keeps narrow longitudinal evidence insufficient", () => {
    const result = admitPaperForwardEvidence([period(0), period(1)]);
    assert.equal(result.strength, "INSUFFICIENT");
    assert.equal(result.periodCount, 2);
    assert.ok(result.reasons.includes("NARROW_LONGITUDINAL_EVIDENCE"));
  });

  it("admits 30 explicit chronological periods while retaining failed periods", () => {
    const periods = Array.from({ length: 30 }, (_, index) => period(index, index === 7 ? { status: "HALTED" } : {}));
    const result = admitPaperForwardEvidence(periods);
    assert.equal(result.strength, "VERIFIED");
    assert.equal(result.periodCount, 30);
    assert.equal(result.completedPeriodCount, 29);
    assert.equal(result.rejectedOrHaltedPeriodCount, 1);
    assert.ok(result.reasons.includes("FAILED_PERIODS_RETAINED"));
  });

  it("rejects candidate identity drift", () => {
    assert.equal(code(() => admitPaperForwardEvidence([period(0), period(1, { candidateId: "other" })])), "CANDIDATE_IDENTITY_MISMATCH");
  });

  it("rejects dataset provenance drift", () => {
    assert.equal(code(() => admitPaperForwardEvidence([period(0), period(1, { datasetContentSha256: "different" })])), "DATASET_PROVENANCE_MISMATCH");
  });

  it("rejects same-period or future advisory look-ahead", () => {
    assert.equal(code(() => admitPaperForwardEvidence([period(0, { advisoryGeneratedAt: 1_000 })])), "LOOK_AHEAD_EVIDENCE");
    assert.equal(code(() => admitPaperForwardEvidence([period(0, { advisoryGeneratedAt: 2_000 })])), "LOOK_AHEAD_EVIDENCE");
  });

  it("rejects overlapping chronology", () => {
    assert.equal(code(() => admitPaperForwardEvidence([period(0), period(1, { advisoryGeneratedAt: 7_000, periodStartAt: 8_000 })])), "NON_MONOTONIC_PERIODS");
  });

  it("rejects duplicate periods for replay idempotency", () => {
    assert.equal(code(() => admitPaperForwardEvidence([period(0), period(1, { periodId: "period-0" })])), "DUPLICATE_PERIOD");
  });

  it("subtracts explicit fee, spread and slippage cost", () => {
    const result = admitPaperForwardEvidence([period(0, { grossReturn: 0.02, turnover: 1, feeRate: 0.001, spreadRate: 0.002, slippageRate: 0.003 })], { minimumLongitudinalPeriods: 1 });
    assert.ok(Math.abs(result.cumulativeNetReturn - 0.014) < 1e-12);
  });

  it("rejects omitted cost evidence represented by non-finite values", () => {
    assert.equal(code(() => admitPaperForwardEvidence([period(0, { slippageRate: Number.NaN })])), "NON_FINITE_VALUE");
  });

  it("rejects unknown persisted runtime status instead of counting it as failed evidence", () => {
    const invalid = { ...period(0), status: "UNKNOWN" } as unknown as PaperForwardPeriodEvidence;
    assert.equal(code(() => admitPaperForwardEvidence([invalid])), "INVALID_STATUS");
  });

  it("rejects finite inputs whose compounded PAPER return overflows", () => {
    assert.equal(
      code(() => admitPaperForwardEvidence([
        period(0, { grossReturn: 1e308, turnover: 0, feeRate: 0, spreadRate: 0, slippageRate: 0 }),
        period(1, { grossReturn: 1e308, turnover: 0, feeRate: 0, spreadRate: 0, slippageRate: 0 }),
      ], { minimumLongitudinalPeriods: 1 })),
      "INVALID_CUMULATIVE_RETURN",
    );
  });
});
