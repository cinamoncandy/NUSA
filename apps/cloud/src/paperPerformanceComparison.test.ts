import assert from "node:assert/strict";
import test from "node:test";
import { assertPaperPerformanceComparable } from "./paperPerformanceComparison";
import { buildPaperPerformanceEvidence, type PaperPerformanceEvidenceInput } from "./paperPerformanceEvidence";

const base: PaperPerformanceEvidenceInput = {
  candidateId: "a", strategyId: "s", strategyVersion: "1",
  periodStartAt: 1_000, periodEndAt: 2_000,
  equityCurve: [{ observedAt: 1_000, equity: 100 }, { observedAt: 2_000, equity: 101 }],
  realizedPnL: 1, unrealizedPnL: 0, feeAmount: 0, fillCount: 1,
  sourceLedgerFingerprintSha256: "a".repeat(64),
  benchmarkId: "KRW-CASH", calculationVersion: "paper-performance-v1", generatedAt: 2_000,
};

const evidence = (patch: Partial<PaperPerformanceEvidenceInput> = {}) => buildPaperPerformanceEvidence({ ...base, ...patch });

test("allows same-family same-convention PAPER evidence comparison without choosing a winner", () => {
  assert.doesNotThrow(() => assertPaperPerformanceComparable(
    { familyId: "family-1", evidence: evidence() },
    { familyId: "family-1", evidence: evidence({ candidateId: "b", strategyId: "s2", sourceLedgerFingerprintSha256: "b".repeat(64) }) },
  ));
});

test("fails closed on apples-to-oranges performance evidence", () => {
  const left = { familyId: "family-1", evidence: evidence() };
  assert.throws(() => assertPaperPerformanceComparable(left, { familyId: "family-2", evidence: evidence({ candidateId: "b" }) }), /FAMILY_MISMATCH/);
  assert.throws(() => assertPaperPerformanceComparable(left, { familyId: "family-1", evidence: evidence({ candidateId: "b", periodStartAt: 999, equityCurve: [{ observedAt: 999, equity: 100 }, { observedAt: 2_000, equity: 101 }] }) }), /WINDOW_MISMATCH/);
  assert.throws(() => assertPaperPerformanceComparable(left, { familyId: "family-1", evidence: evidence({ candidateId: "b", benchmarkId: "KRW-BTC" }) }), /BENCHMARK_MISMATCH/);
  assert.throws(() => assertPaperPerformanceComparable(left, { familyId: "family-1", evidence: evidence({ candidateId: "b", calculationVersion: "v2" }) }), /CALCULATION_MISMATCH/);
});
