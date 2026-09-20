import assert from "node:assert/strict";
import test from "node:test";
import { buildPaperPerformanceEvidence, verifyPaperPerformanceEvidence, type PaperPerformanceEvidenceInput } from "./paperPerformanceEvidence";

const hash = "a".repeat(64);
function input(): PaperPerformanceEvidenceInput {
  return {
    candidateId: "candidate-1", strategyId: "strategy-1", strategyVersion: "1.0.0",
    periodStartAt: 1_000, periodEndAt: 4_000,
    equityCurve: [
      { observedAt: 1_000, equity: 100 },
      { observedAt: 2_000, equity: 120 },
      { observedAt: 3_000, equity: 90 },
      { observedAt: 4_000, equity: 110 },
    ],
    realizedPnL: 8, unrealizedPnL: 2, feeAmount: 1, fillCount: 4,
    sourceLedgerFingerprintSha256: hash,
    benchmarkId: "KRW-CASH", calculationVersion: "paper-performance-v1", generatedAt: 5_000,
  };
}

test("builds deterministic PAPER_ONLY performance evidence from ordered observations", () => {
  const first = buildPaperPerformanceEvidence(input());
  const second = buildPaperPerformanceEvidence(input());
  assert.deepEqual(first, second);
  assert.equal(first.evidenceKind, "PAPER");
  assert.equal(first.authority, "PAPER_ONLY");
  assert.equal(first.liveAuthority, "NONE");
  assert.equal(first.productionMutationAllowed, false);
  assert.equal(first.aiAuthority, "ZERO_AUTHORITY");
  assert.equal(first.observationCount, 4);
  assert.equal(first.netPnL, 10);
  assert.equal(first.returnRate, 0.1);
  assert.equal(first.maxDrawdownRate, 0.25);
  assert.match(first.evidenceFingerprintSha256, /^[a-f0-9]{64}$/);
  verifyPaperPerformanceEvidence(input(), first);
});

test("drawdown respects temporal peak-to-trough ordering", () => {
  const value: PaperPerformanceEvidenceInput = {
    ...input(),
    equityCurve: [
      { observedAt: 1_000, equity: 100 },
      { observedAt: 2_000, equity: 80 },
      { observedAt: 3_000, equity: 120 },
      { observedAt: 4_000, equity: 110 },
    ],
  };
  assert.equal(buildPaperPerformanceEvidence(value).maxDrawdownRate, 0.2);
});

test("source ledger identity changes evidence identity", () => {
  const first = buildPaperPerformanceEvidence(input());
  const changed = { ...input(), sourceLedgerFingerprintSha256: "b".repeat(64) };
  const second = buildPaperPerformanceEvidence(changed);
  assert.notEqual(first.evidenceFingerprintSha256, second.evidenceFingerprintSha256);
  assert.throws(() => verifyPaperPerformanceEvidence(input(), second), /PAPER_PERFORMANCE_EVIDENCE_MISMATCH/);
});

test("provenance identity changes evidence identity", () => {
  const first = buildPaperPerformanceEvidence(input());
  const benchmark = buildPaperPerformanceEvidence({ ...input(), benchmarkId: "KRW-BTC" });
  const calculation = buildPaperPerformanceEvidence({ ...input(), calculationVersion: "paper-performance-v2" });
  assert.notEqual(first.evidenceFingerprintSha256, benchmark.evidenceFingerprintSha256);
  assert.notEqual(first.evidenceFingerprintSha256, calculation.evidenceFingerprintSha256);
});

test("metric or candidate tampering fails independent rebuild verification", () => {
  const source = input();
  const evidence = buildPaperPerformanceEvidence(source);
  assert.throws(() => verifyPaperPerformanceEvidence(source, { ...evidence, finalEquity: 999 }), /PAPER_PERFORMANCE_EVIDENCE_MISMATCH/);
  assert.throws(() => verifyPaperPerformanceEvidence(source, { ...evidence, candidateId: "other" }), /PAPER_PERFORMANCE_EVIDENCE_MISMATCH/);
});

for (const [name, mutate] of [
  ["invalid period", (value: PaperPerformanceEvidenceInput) => ({ ...value, periodEndAt: 999 })],
  ["invalid ledger hash", (value: PaperPerformanceEvidenceInput) => ({ ...value, sourceLedgerFingerprintSha256: "bad" })],
  ["negative fee", (value: PaperPerformanceEvidenceInput) => ({ ...value, feeAmount: -1 })],
  ["non-finite equity", (value: PaperPerformanceEvidenceInput) => ({ ...value, equityCurve: [{ observedAt: 1_000, equity: 100 }, { observedAt: 4_000, equity: Number.NaN }] })],
  ["invalid fill count", (value: PaperPerformanceEvidenceInput) => ({ ...value, fillCount: 1.5 })],
  ["non-canonical identity", (value: PaperPerformanceEvidenceInput) => ({ ...value, candidateId: " candidate-1 " })],
  ["insufficient observations", (value: PaperPerformanceEvidenceInput) => ({ ...value, equityCurve: [{ observedAt: 1_000, equity: 100 }] })],
  ["unordered observations", (value: PaperPerformanceEvidenceInput) => ({ ...value, equityCurve: [{ observedAt: 1_000, equity: 100 }, { observedAt: 3_000, equity: 90 }, { observedAt: 2_000, equity: 95 }, { observedAt: 4_000, equity: 110 }] })],
  ["invalid generation time", (value: PaperPerformanceEvidenceInput) => ({ ...value, generatedAt: 3_999 })],
  ["empty benchmark identity", (value: PaperPerformanceEvidenceInput) => ({ ...value, benchmarkId: "" })],
  ["empty calculation identity", (value: PaperPerformanceEvidenceInput) => ({ ...value, calculationVersion: "" })],
  ["incomplete window", (value: PaperPerformanceEvidenceInput) => ({ ...value, equityCurve: [{ observedAt: 1_001, equity: 100 }, { observedAt: 4_000, equity: 110 }] })],
] as const) {
  test(`fails closed on ${name}`, () => assert.throws(() => buildPaperPerformanceEvidence(mutate(input()))));
}

test("zero-trade flat equity remains finite and neutral", () => {
  const value: PaperPerformanceEvidenceInput = {
    ...input(),
    equityCurve: [{ observedAt: 1_000, equity: 100 }, { observedAt: 4_000, equity: 100 }],
    realizedPnL: 0, unrealizedPnL: 0, feeAmount: 0, fillCount: 0,
  };
  const result = buildPaperPerformanceEvidence(value);
  assert.equal(result.netPnL, 0);
  assert.equal(result.returnRate, 0);
  assert.equal(result.maxDrawdownRate, 0);
  assert.ok([result.netPnL, result.returnRate, result.maxDrawdownRate].every(Number.isFinite));
});

test("complete equity loss reports 100 percent maximum drawdown without NaN", () => {
  const value: PaperPerformanceEvidenceInput = {
    ...input(),
    equityCurve: [
      { observedAt: 1_000, equity: 100 },
      { observedAt: 2_000, equity: 120 },
      { observedAt: 3_000, equity: 0 },
      { observedAt: 4_000, equity: 0 },
    ],
    realizedPnL: -100, unrealizedPnL: 0,
  };
  const result = buildPaperPerformanceEvidence(value);
  assert.equal(result.maxDrawdownRate, 1);
  assert.equal(result.finalEquity, 0);
  assert.ok(Number.isFinite(result.returnRate));
});
