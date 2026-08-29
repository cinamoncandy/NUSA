const test = require("node:test");
const assert = require("node:assert/strict");
const { evaluatePaperPortfolioAdvisory } = require("../dist/apps/cloud/src/paperPortfolioAdvisory.js");

const policy = Object.freeze({
  policyVersion: "capital-v1",
  fractionalKelly: 0.25,
  maximumPortfolioWeight: 0.8,
  maximumStrategyWeight: 0.2,
  minimumCashReserveWeight: 0.2,
  maximumCorrelation: 0.7,
  maximumRiskBudgetUsage: 0.8,
  maximumDrawdown: 0.2,
  dailyLossLimit: 0.02,
  monthlyLossLimit: 0.06,
  minimumAllocationUsd: 100
});

const evidence = Object.freeze({
  candidateId: "candidate-881",
  datasetId: "dataset-881",
  datasetContentSha256: "a".repeat(64),
  observedAt: "2026-08-29T00:00:00.000Z",
  regime: "RISK_ON",
  status: "VERIFIED",
  evidencePeriods: 40,
  currentPortfolioGrossWeight: 0.4,
  currentStrategyWeight: 0,
  maximumPeerCorrelation: 0.4,
  regimeCoFailureRate: 0.2,
  estimatedTurnover: 0.25,
  estimatedFeeRate: 0.001,
  estimatedSlippageRate: 0.001,
  grossExpectedEdge: 0.01
});

const riskEvidence = Object.freeze({
  evaluationId: "risk-eval-881",
  candidateId: "candidate-881",
  datasetId: "dataset-881",
  datasetContentSha256: "a".repeat(64),
  observedAt: "2026-08-29T00:00:00.000Z",
  evaluatedAt: "2026-08-29T00:30:00.000Z",
  status: "VERIFIED",
  evidencePeriods: 40,
  minimumEvidencePeriods: 30,
  maximumEvidenceAgeMs: 24 * 60 * 60 * 1000,
  portfolioDrawdownContribution: 0.08,
  maximumDrawdownContribution: 0.1,
  diversificationBenefit: 0.03,
  minimumDiversificationBenefit: 0.01
});

const input = Object.freeze({
  advisoryId: "advisory-881",
  strategyId: "strategy-881",
  generatedAt: "2026-08-29T01:00:00.000Z",
  source: "PAPER",
  evidence,
  minimumEvidencePeriods: 30,
  maximumEvidenceAgeMs: 24 * 60 * 60 * 1000,
  maximumRegimeCoFailureRate: 0.5,
  riskEvidence
});

test("advises only from verified point-in-time PAPER evidence", () => {
  const result = evaluatePaperPortfolioAdvisory(input, policy);
  assert.equal(result.decision, "ADVISE");
  assert.equal(result.recommendedWeight, 0.2);
  assert.ok(result.netExpectedEdge > 0);
  assert.deepEqual(result.reasons, []);
  assert.equal(result.candidateId, evidence.candidateId);
  assert.equal(result.datasetId, evidence.datasetId);
  assert.equal(result.datasetContentSha256, evidence.datasetContentSha256);
  assert.equal(result.liveAuthority, "NONE");
  assert.equal(result.productionMutationAllowed, false);
  assert.equal(result.aiAuthority, "ZERO_AUTHORITY");
  assert.ok(Object.isFrozen(result));
  assert.ok(Object.isFrozen(result.reasons));
});

test("UNKNOWN and INSUFFICIENT can never become allocation confidence", () => {
  for (const status of ["UNKNOWN", "INSUFFICIENT", "CONFLICTING"]) {
    const result = evaluatePaperPortfolioAdvisory({
      ...input,
      evidence: { ...evidence, status }
    }, policy);
    assert.equal(result.decision, "ABSTAIN");
    assert.equal(result.recommendedWeight, 0);
    assert.ok(result.reasons.includes(`EVIDENCE_${status}`));
  }
});

test("future and stale evidence fail closed", () => {
  const future = evaluatePaperPortfolioAdvisory({
    ...input,
    evidence: { ...evidence, observedAt: "2026-08-29T02:00:00.000Z" }
  }, policy);
  assert.equal(future.decision, "ABSTAIN");
  assert.ok(future.reasons.includes("FUTURE_EVIDENCE"));

  const stale = evaluatePaperPortfolioAdvisory({
    ...input,
    evidence: { ...evidence, observedAt: "2026-08-27T00:00:00.000Z" }
  }, policy);
  assert.equal(stale.decision, "ABSTAIN");
  assert.ok(stale.reasons.includes("STALE_EVIDENCE"));
});

test("correlation, regime co-failure and concentration force abstention", () => {
  const correlated = evaluatePaperPortfolioAdvisory({
    ...input,
    evidence: { ...evidence, maximumPeerCorrelation: 0.9 }
  }, policy);
  assert.equal(correlated.decision, "ABSTAIN");
  assert.ok(correlated.reasons.includes("CORRELATION_LIMIT_EXCEEDED"));

  const coFailure = evaluatePaperPortfolioAdvisory({
    ...input,
    evidence: { ...evidence, regimeCoFailureRate: 0.8 }
  }, policy);
  assert.equal(coFailure.decision, "ABSTAIN");
  assert.ok(coFailure.reasons.includes("REGIME_CO_FAILURE_LIMIT_EXCEEDED"));

  const concentrated = evaluatePaperPortfolioAdvisory({
    ...input,
    evidence: { ...evidence, currentPortfolioGrossWeight: 0.8 }
  }, policy);
  assert.equal(concentrated.decision, "ABSTAIN");
  assert.ok(concentrated.reasons.includes("PORTFOLIO_CONCENTRATION_LIMIT_REACHED"));
});

test("fees and slippage are charged before positive-edge advice", () => {
  const result = evaluatePaperPortfolioAdvisory({
    ...input,
    evidence: {
      ...evidence,
      estimatedTurnover: 1,
      estimatedFeeRate: 0.01,
      estimatedSlippageRate: 0.01,
      grossExpectedEdge: 0.015
    }
  }, policy);
  assert.equal(result.decision, "ABSTAIN");
  assert.ok(result.netExpectedEdge < 0);
  assert.ok(result.reasons.includes("NON_POSITIVE_EDGE_AFTER_COSTS"));
});

test("insufficient longitudinal periods and invalid provenance fail closed", () => {
  const short = evaluatePaperPortfolioAdvisory({
    ...input,
    evidence: { ...evidence, evidencePeriods: 29 }
  }, policy);
  assert.equal(short.decision, "ABSTAIN");
  assert.ok(short.reasons.includes("INSUFFICIENT_LONGITUDINAL_EVIDENCE"));

  assert.throws(() => evaluatePaperPortfolioAdvisory({
    ...input,
    evidence: { ...evidence, datasetContentSha256: "not-a-hash" }
  }, policy), /sha256/);
});

test("malformed longitudinal period counts fail closed before decisioning", () => {
  for (const evidencePeriods of [Number.NaN, Number.POSITIVE_INFINITY, -1, 1.5]) {
    assert.throws(() => evaluatePaperPortfolioAdvisory({
      ...input,
      evidence: { ...evidence, evidencePeriods }
    }, policy), /evidencePeriods must be a non-negative integer/);
  }
});

test("malformed consumed allocation policy limits fail closed", () => {
  const malformedPolicies = [
    { ...policy, maximumCorrelation: Number.NaN },
    { ...policy, maximumCorrelation: Number.POSITIVE_INFINITY },
    { ...policy, maximumCorrelation: -0.1 },
    { ...policy, maximumPortfolioWeight: Number.NaN },
    { ...policy, maximumPortfolioWeight: 1.1 },
    { ...policy, maximumStrategyWeight: Number.POSITIVE_INFINITY },
    { ...policy, maximumStrategyWeight: -0.1 }
  ];

  for (const malformedPolicy of malformedPolicies) {
    assert.throws(() => evaluatePaperPortfolioAdvisory(input, malformedPolicy), /must be (finite|between 0 and 1)/);
  }
});

test("derived advisory numerics can never become non-finite", () => {
  assert.throws(() => evaluatePaperPortfolioAdvisory({
    ...input,
    evidence: { ...evidence, grossExpectedEdge: Number.MAX_VALUE }
  }, policy), /netExpectedEdge must be finite/);

  const result = evaluatePaperPortfolioAdvisory(input, policy);
  assert.ok(Number.isFinite(result.netExpectedEdge));
  assert.ok(Number.isFinite(result.maximumWeight));
  assert.ok(Number.isFinite(result.recommendedWeight));
});

test("allocation advice abstains when canonical portfolio risk evidence is absent or not accepted", () => {
  const missing = evaluatePaperPortfolioAdvisory({ ...input, riskEvidence: undefined }, policy);
  assert.equal(missing.decision, "ABSTAIN");
  assert.equal(missing.recommendedWeight, 0);
  assert.ok(missing.reasons.includes("RISK_EVIDENCE_MISSING"));

  const rejected = evaluatePaperPortfolioAdvisory({
    ...input,
    riskEvidence: { ...riskEvidence, portfolioDrawdownContribution: 0.11 }
  }, policy);
  assert.equal(rejected.decision, "ABSTAIN");
  assert.ok(rejected.reasons.includes("RISK_DRAWDOWN_CONTRIBUTION_LIMIT_EXCEEDED"));
});

test("portfolio risk evidence must match advisory provenance and be current at decision time", () => {
  const mismatch = evaluatePaperPortfolioAdvisory({
    ...input,
    riskEvidence: { ...riskEvidence, candidateId: "candidate-other" }
  }, policy);
  assert.equal(mismatch.decision, "ABSTAIN");
  assert.ok(mismatch.reasons.includes("RISK_EVIDENCE_PROVENANCE_MISMATCH"));

  const future = evaluatePaperPortfolioAdvisory({
    ...input,
    riskEvidence: { ...riskEvidence, evaluatedAt: "2026-08-29T02:00:00.000Z" }
  }, policy);
  assert.equal(future.decision, "ABSTAIN");
  assert.ok(future.reasons.includes("RISK_EVIDENCE_FUTURE"));

  const stale = evaluatePaperPortfolioAdvisory({
    ...input,
    riskEvidence: {
      ...riskEvidence,
      observedAt: "2026-08-27T00:00:00.000Z",
      evaluatedAt: "2026-08-27T00:30:00.000Z"
    }
  }, policy);
  assert.equal(stale.decision, "ABSTAIN");
  assert.ok(stale.reasons.includes("RISK_EVALUATION_STALE"));
});
