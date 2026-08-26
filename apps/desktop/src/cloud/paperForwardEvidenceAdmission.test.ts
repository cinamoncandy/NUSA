import { describe, expect, it } from "vitest";
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
    expect(result.strength).toBe("INSUFFICIENT");
    expect(result.periodCount).toBe(2);
    expect(result.reasons).toContain("NARROW_LONGITUDINAL_EVIDENCE");
  });

  it("admits 30 explicit chronological periods while retaining failed periods", () => {
    const periods = Array.from({ length: 30 }, (_, index) => period(index, index === 7 ? { status: "HALTED" } : {}));
    const result = admitPaperForwardEvidence(periods);
    expect(result.strength).toBe("VERIFIED");
    expect(result.periodCount).toBe(30);
    expect(result.completedPeriodCount).toBe(29);
    expect(result.rejectedOrHaltedPeriodCount).toBe(1);
    expect(result.reasons).toContain("FAILED_PERIODS_RETAINED");
  });

  it("rejects candidate identity drift", () => {
    expect(code(() => admitPaperForwardEvidence([period(0), period(1, { candidateId: "other" })]))).toBe("CANDIDATE_IDENTITY_MISMATCH");
  });

  it("rejects dataset provenance drift", () => {
    expect(code(() => admitPaperForwardEvidence([period(0), period(1, { datasetContentSha256: "different" })]))).toBe("DATASET_PROVENANCE_MISMATCH");
  });

  it("rejects same-period or future advisory look-ahead", () => {
    expect(code(() => admitPaperForwardEvidence([period(0, { advisoryGeneratedAt: 1_000 })]))).toBe("LOOK_AHEAD_EVIDENCE");
    expect(code(() => admitPaperForwardEvidence([period(0, { advisoryGeneratedAt: 2_000 })]))).toBe("LOOK_AHEAD_EVIDENCE");
  });

  it("rejects overlapping chronology", () => {
    expect(code(() => admitPaperForwardEvidence([period(0), period(1, { periodStartAt: 8_000 })]))).toBe("NON_MONOTONIC_PERIODS");
  });

  it("rejects duplicate periods for replay idempotency", () => {
    expect(code(() => admitPaperForwardEvidence([period(0), period(1, { periodId: "period-0" })]))).toBe("DUPLICATE_PERIOD");
  });

  it("subtracts explicit fee, spread and slippage cost", () => {
    const result = admitPaperForwardEvidence([period(0, { grossReturn: 0.02, turnover: 1, feeRate: 0.001, spreadRate: 0.002, slippageRate: 0.003 })], { minimumLongitudinalPeriods: 1 });
    expect(result.cumulativeNetReturn).toBeCloseTo(0.014, 12);
  });

  it("rejects omitted cost evidence represented by non-finite values", () => {
    expect(code(() => admitPaperForwardEvidence([period(0, { slippageRate: Number.NaN })]))).toBe("NON_FINITE_VALUE");
  });
});
