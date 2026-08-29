const test = require("node:test");
const assert = require("node:assert/strict");
const { evaluatePaperPortfolioRiskEvidence } = require("../dist/apps/cloud/src/paperPortfolioRiskEvidence.js");

const input = (overrides = {}) => ({
  evaluationId: "risk-eval-881",
  candidateId: "candidate-881-risk",
  datasetId: "dataset-881-risk",
  datasetContentSha256: "c".repeat(64),
  observedAt: "2026-08-29T00:00:00.000Z",
  evaluatedAt: "2026-08-29T01:00:00.000Z",
  status: "VERIFIED",
  evidencePeriods: 40,
  minimumEvidencePeriods: 30,
  maximumEvidenceAgeMs: 24 * 60 * 60 * 1000,
  portfolioDrawdownContribution: 0.08,
  maximumDrawdownContribution: 0.1,
  diversificationBenefit: 0.03,
  minimumDiversificationBenefit: 0.01,
  ...overrides,
});

test("accepts only verified point-in-time risk evidence inside drawdown and diversification bounds", () => {
  const result = evaluatePaperPortfolioRiskEvidence(input());
  assert.equal(result.decision, "ACCEPT");
  assert.deepEqual(result.reasons, []);
  assert.equal(result.liveAuthority, "NONE");
  assert.equal(result.productionMutationAllowed, false);
  assert.equal(result.aiAuthority, "ZERO_AUTHORITY");
  assert.ok(Object.isFrozen(result));
  assert.ok(Object.isFrozen(result.reasons));
});

test("UNKNOWN INSUFFICIENT and CONFLICTING never become accepted evidence", () => {
  for (const status of ["UNKNOWN", "INSUFFICIENT", "CONFLICTING"]) {
    const result = evaluatePaperPortfolioRiskEvidence(input({ status }));
    assert.equal(result.decision, "ABSTAIN");
    assert.ok(result.reasons.includes(`EVIDENCE_${status}`));
  }
});

test("insufficient future and stale evidence fail closed", () => {
  const short = evaluatePaperPortfolioRiskEvidence(input({ evidencePeriods: 29 }));
  assert.equal(short.decision, "ABSTAIN");
  assert.ok(short.reasons.includes("INSUFFICIENT_LONGITUDINAL_EVIDENCE"));

  const future = evaluatePaperPortfolioRiskEvidence(input({ observedAt: "2026-08-29T02:00:00.000Z" }));
  assert.equal(future.decision, "ABSTAIN");
  assert.ok(future.reasons.includes("FUTURE_EVIDENCE"));

  const stale = evaluatePaperPortfolioRiskEvidence(input({ observedAt: "2026-08-27T00:00:00.000Z" }));
  assert.equal(stale.decision, "ABSTAIN");
  assert.ok(stale.reasons.includes("STALE_EVIDENCE"));
});

test("excess drawdown contribution forces abstention", () => {
  const result = evaluatePaperPortfolioRiskEvidence(input({ portfolioDrawdownContribution: 0.11 }));
  assert.equal(result.decision, "ABSTAIN");
  assert.ok(result.reasons.includes("DRAWDOWN_CONTRIBUTION_LIMIT_EXCEEDED"));
});

test("missing diversification benefit forces abstention", () => {
  const result = evaluatePaperPortfolioRiskEvidence(input({ diversificationBenefit: 0.005 }));
  assert.equal(result.decision, "ABSTAIN");
  assert.ok(result.reasons.includes("INSUFFICIENT_DIVERSIFICATION_BENEFIT"));
});

test("malformed provenance and non-finite risk numerics fail closed", () => {
  assert.throws(() => evaluatePaperPortfolioRiskEvidence(input({ datasetContentSha256: "bad" })), /sha256/);
  assert.throws(() => evaluatePaperPortfolioRiskEvidence(input({ portfolioDrawdownContribution: Number.NaN })), /finite/);
  assert.throws(() => evaluatePaperPortfolioRiskEvidence(input({ diversificationBenefit: Number.POSITIVE_INFINITY })), /finite/);
});
