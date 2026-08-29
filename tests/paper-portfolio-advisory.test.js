const test = require("node:test");\nconst assert = require("node:assert/strict");\nconst { evaluatePaperPortfolioAdvisory } = require("../dist/apps/cloud/src/paperPortfolioAdvisory.js");\n\nconst policy = Object.freeze({\n  policyVersion: "capital-v1",\n  fractionalKelly: 0.25,\n  maximumPortfolioWeight: 0.8,\n  maximumStrategyWeight: 0.2,\n  minimumCashReserveWeight: 0.2,\n  maximumCorrelation: 0.7,\n  maximumRiskBudgetUsage: 0.8,\n  maximumDrawdown: 0.2,\n  dailyLossLimit: 0.02,\n  monthlyLossLimit: 0.06,\n  minimumAllocationUsd: 100\n});\n\nconst evidence = Object.freeze({
  candidateId: "candidate-881",\n  datasetId: "dataset-881",\n  datasetContentSha256: "a".repeat(64),\n  observedAt: "2026-08-29T00:00:00.000Z",\n  regime: "RISK_ON",\n  status: "VERIFIED",\n  evidencePeriods: 40,\n  currentPortfolioGrossWeight: 0.4,\n  currentStrategyWeight: 0,\n  maximumPeerCorrelation: 0.4,\n  regimeCoFailureRate: 0.2,\n  estimatedTurnover: 0.25,\n  estimatedFeeRate: 0.001,\n  estimatedSlippageRate: 0.001,\n  grossExpectedEdge: 0.01
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
\nconst input = Object.freeze({\n  advisoryId: "advisory-881",\n  strategyId: "strategy-881",\n  generatedAt: "2026-08-29T01:00:00.000Z",\n  source: "PAPER",\n  evidence,
  minimumEvidencePeriods: 30,
  maximumEvidenceAgeMs: 24 * 60 * 60 * 1000,
  maximumRegimeCoFailureRate: 0.5,
  riskEvidence
});
\ntest("advises only from verified point-in-time PAPER evidence", () => {\n  const result = evaluatePaperPortfolioAdvisory(input, policy);\n  assert.equal(result.decision, "ADVISE");\n  assert.equal(result.recommendedWeight, 0.2);\n  assert.ok(result.netExpectedEdge > 0);\n  assert.deepEqual(result.reasons, []);\n  assert.equal(result.candidateId, evidence.candidateId);\n  assert.equal(result.datasetId, evidence.datasetId);\n  assert.equal(result.datasetContentSha256, evidence.datasetContentSha256);\n  assert.equal(result.liveAuthority, "NONE");\n  assert.equal(result.productionMutationAllowed, false);\n  assert.equal(result.aiAuthority, "ZERO_AUTHORITY");\n  assert.ok(Object.isFrozen(result));\n  assert.ok(Object.isFrozen(result.reasons));\n});\n\ntest("UNKNOWN and INSUFFICIENT can never become allocation confidence", () => {\n  for (const status of ["UNKNOWN", "INSUFFICIENT", "CONFLICTING"]) {\n    const result = evaluatePaperPortfolioAdvisory({\n      ...input,\n      evidence: { ...evidence, status }\n    }, policy);\n    assert.equal(result.decision, "ABSTAIN");\n    assert.equal(result.recommendedWeight, 0);\n    assert.ok(result.reasons.includes(`EVIDENCE_${status}`));\n  }\n});\n\ntest("future and stale evidence fail closed", () => {\n  const future = evaluatePaperPortfolioAdvisory({\n    ...input,\n    evidence: { ...evidence, observedAt: "2026-08-29T02:00:00.000Z" }\n  }, policy);\n  assert.equal(future.decision, "ABSTAIN");\n  assert.ok(future.reasons.includes("FUTURE_EVIDENCE"));\n\n  const stale = evaluatePaperPortfolioAdvisory({\n    ...input,\n    evidence: { ...evidence, observedAt: "2026-08-27T00:00:00.000Z" }\n  }, policy);\n  assert.equal(stale.decision, "ABSTAIN");\n  assert.ok(stale.reasons.includes("STALE_EVIDENCE"));\n});\n\ntest("correlation, regime co-failure and concentration force abstention", () => {\n  const correlated = evaluatePaperPortfolioAdvisory({\n    ...input,\n    evidence: { ...evidence, maximumPeerCorrelation: 0.9 }\n  }, policy);\n  assert.equal(correlated.decision, "ABSTAIN");\n  assert.ok(correlated.reasons.includes("CORRELATION_LIMIT_EXCEEDED"));\n\n  const coFailure = evaluatePaperPortfolioAdvisory({\n    ...input,\n    evidence: { ...evidence, regimeCoFailureRate: 0.8 }\n  }, policy);\n  assert.equal(coFailure.decision, "ABSTAIN");\n  assert.ok(coFailure.reasons.includes("REGIME_CO_FAILURE_LIMIT_EXCEEDED"));\n\n  const concentrated = evaluatePaperPortfolioAdvisory({\n    ...input,\n    evidence: { ...evidence, currentPortfolioGrossWeight: 0.8 }\n  }, policy);\n  assert.equal(concentrated.decision, "ABSTAIN");\n  assert.ok(concentrated.reasons.includes("PORTFOLIO_CONCENTRATION_LIMIT_REACHED"));\n});\n\ntest("fees and slippage are charged before positive-edge advice", () => {\n  const result = evaluatePaperPortfolioAdvisory({\n    ...input,\n    evidence: {\n      ...evidence,\n      estimatedTurnover: 1,\n      estimatedFeeRate: 0.01,\n      estimatedSlippageRate: 0.01,\n      grossExpectedEdge: 0.015\n    }\n  }, policy);\n  assert.equal(result.decision, "ABSTAIN");\n  assert.ok(result.netExpectedEdge < 0);\n  assert.ok(result.reasons.includes("NON_POSITIVE_EDGE_AFTER_COSTS"));\n});\n\ntest("insufficient longitudinal periods and invalid provenance fail closed", () => {\n  const short = evaluatePaperPortfolioAdvisory({\n    ...input,\n    evidence: { ...evidence, evidencePeriods: 29 }\n  }, policy);\n  assert.equal(short.decision, "ABSTAIN");\n  assert.ok(short.reasons.includes("INSUFFICIENT_LONGITUDINAL_EVIDENCE"));\n\n  assert.throws(() => evaluatePaperPortfolioAdvisory({\n    ...input,\n    evidence: { ...evidence, datasetContentSha256: "not-a-hash" }\n  }, policy), /sha256/);\n});\n\ntest("malformed longitudinal period counts fail closed before decisioning", () => {\n  for (const evidencePeriods of [Number.NaN, Number.POSITIVE_INFINITY, -1, 1.5]) {\n    assert.throws(() => evaluatePaperPortfolioAdvisory({\n      ...input,\n      evidence: { ...evidence, evidencePeriods }\n    }, policy), /evidencePeriods must be a non-negative integer/);\n  }\n});\n\ntest("malformed consumed allocation policy limits fail closed", () => {\n  const malformedPolicies = [\n    { ...policy, maximumCorrelation: Number.NaN },\n    { ...policy, maximumCorrelation: Number.POSITIVE_INFINITY },\n    { ...policy, maximumCorrelation: -0.1 },\n    { ...policy, maximumPortfolioWeight: Number.NaN },\n    { ...policy, maximumPortfolioWeight: 1.1 },\n    { ...policy, maximumStrategyWeight: Number.POSITIVE_INFINITY },\n    { ...policy, maximumStrategyWeight: -0.1 }\n  ];\n\n  for (const malformedPolicy of malformedPolicies) {\n    assert.throws(() => evaluatePaperPortfolioAdvisory(input, malformedPolicy), /must be (finite|between 0 and 1)/);\n  }\n});\n\ntest("derived advisory numerics can never become non-finite", () => {
  assert.throws(() => evaluatePaperPortfolioAdvisory({\n    ...input,\n    evidence: { ...evidence, grossExpectedEdge: Number.MAX_VALUE }\n  }, policy), /netExpectedEdge must be finite/);\n\n  const result = evaluatePaperPortfolioAdvisory(input, policy);\n  assert.ok(Number.isFinite(result.netExpectedEdge));\n  assert.ok(Number.isFinite(result.maximumWeight));\n  assert.ok(Number.isFinite(result.recommendedWeight));
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
