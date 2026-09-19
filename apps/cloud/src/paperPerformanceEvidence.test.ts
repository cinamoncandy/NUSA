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
  const value = input();
  value.equityCurve = [
    { observedAt: 1_000, equity: 100 },
    { observedAt: 2_000, equity: 80 },
    { observedAt: 3_000, equity: 120 },
    { observedAt: 4_000, equity: 110 },
  ];
  assert.equal(buildPaperPerformanceEvidence(value).maxDrawdownRate, 0.2);
});

test("source ledger identity changes evidence identity", () => {
  const first = buildPaperPerformanceEvidence(input());
  const changed = { ...input(), sourceLedgerFingerprintSha256: "b".repeat(64) };
  const second = buildPaperPerformanceEvidence(changed);
  assert.notEqual(first.evidenceFingerprintSha256, second.evidenceFingerprintSha256);
  assert.throws(() => verifyPaperPerformanceEvidence(input(), second), /PAPER_PERFORMANCE_EVIDENCE_MISMATCH/);
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
  ["incomplete window", (value: PaperPerformanceEvidenceInput) => ({ ...value, equityCurve: [{ observedAt: 1_001, equity: 100 }, { observedAt: 4_000, equity: 110 }] })],
] as const) {
  test(`fails closed on ${name}`, () => assert.throws(() => buildPaperPerformanceEvidence(mutate(input()))));
}
