import test from "node:test";
import assert from "node:assert/strict";
import { validateResearchCostEvidence, type ResearchCostEvidence } from "./researchCostEvidence";

function validEvidence(overrides: Partial<ResearchCostEvidence> = {}): ResearchCostEvidence {
  return {
    schemaVersion: 1,
    feeRate: 0.001,
    spreadRate: 0.0005,
    slippageRate: 0.0005,
    turnoverRate: 2,
    grossReturn: 0.02,
    netReturn: 0.016,
    costModelVersion: "cost-v1",
    observedAt: 10,
    ...overrides,
  };
}

test("explicit research cost evidence verifies only after cost reconciliation", () => {
  const result = validateResearchCostEvidence(validEvidence(), 10);
  assert.equal(result.status, "VERIFIED");
  assert.deepEqual(result.reasons, []);
  assert.match(result.evidenceHash, /^[a-f0-9]{64}$/);
});

test("missing fee/spread/slippage/turnover evidence fails closed", () => {
  for (const [field, value, reason] of [
    ["feeRate", Number.NaN, "INVALID_FEE_EVIDENCE"],
    ["spreadRate", Number.NaN, "INVALID_SPREAD_EVIDENCE"],
    ["slippageRate", Number.NaN, "INVALID_SLIPPAGE_EVIDENCE"],
    ["turnoverRate", Number.NaN, "INVALID_TURNOVER_EVIDENCE"],
  ] as const) {
    const result = validateResearchCostEvidence(validEvidence({ [field]: value }), 10);
    assert.equal(result.status, "REJECTED");
    assert.ok(result.reasons.includes(reason));
  }
});

test("gross return cannot masquerade as cost-adjusted net return", () => {
  const result = validateResearchCostEvidence(validEvidence({ netReturn: 0.02 }), 10);
  assert.equal(result.status, "REJECTED");
  assert.ok(result.reasons.includes("COST_RECONCILIATION_MISMATCH"));
});

test("future-derived cost evidence fails closed", () => {
  const result = validateResearchCostEvidence(validEvidence({ observedAt: 11 }), 10);
  assert.equal(result.status, "REJECTED");
  assert.ok(result.reasons.includes("FUTURE_COST_EVIDENCE"));
});

test("validator output carries no execution authority", () => {
  const serialized = JSON.stringify(validateResearchCostEvidence(validEvidence(), 10)).toLowerCase();
  assert.equal(serialized.includes("liveauthority"), false);
  assert.equal(serialized.includes("productionmutationallowed"), false);
  assert.equal(serialized.includes("order"), false);
  assert.equal(serialized.includes("withdraw"), false);
});
