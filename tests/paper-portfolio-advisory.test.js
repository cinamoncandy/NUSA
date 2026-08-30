const test = require("node:test");
const assert = require("node:assert/strict");
const { evaluatePaperPortfolioAdvisory } = require("../dist/apps/cloud/src/paperPortfolioAdvisory.js");
const { createPaperPortfolioTrustedLongitudinalEvidence } = require("../dist/apps/cloud/src/paperPortfolioRiskEvidence.js");

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

const trustedRun = Object.freeze({
  verificationSource: "GITHUB_API",
  repository: "cinamoncandy/NUSA",
  headSha: "a".repeat(40),
  workflowRunId: 33150000000,
  workflowRunAttempt: 1,
  workflowRef: "cinamoncandy/NUSA/.github/workflows/actual-paper-runtime.yml@refs/heads/main",
  eventName: "workflow_dispatch",
  workflowRunUrl: "https://github.com/cinamoncandy/NUSA/actions/runs/33150000000"
});

const riskFacts = Object.freeze({
  evaluationId: "risk-eval-881",
  candidateId: evidence.candidateId,
  datasetId: evidence.datasetId,
  datasetContentSha256: evidence.datasetContentSha256,
  observedAt: evidence.observedAt,
  evaluatedAt: "2026-08-29T00:30:00.000Z",
  status: "VERIFIED",
  evidencePeriods: evidence.evidencePeriods,
  minimumEvidencePeriods: 30,
  maximumEvidenceAgeMs: 24 * 60 * 60 * 1000,
  portfolioDrawdownContribution: 0.08,
  maximumDrawdownContribution: 0.1,
  diversificationBenefit: 0.03,
  minimumDiversificationBenefit: 0.01,
  maximumAbsoluteCandidateCorrelation: evidence.maximumPeerCorrelation,
  maximumAllowedCandidateCorrelation: policy.maximumCorrelation,
  portfolioRegime: evidence.regime,
  regimeCoFailureRate: evidence.regimeCoFailureRate,
  currentPortfolioGrossWeight: evidence.currentPortfolioGrossWeight,
  currentStrategyWeight: evidence.currentStrategyWeight,
  estimatedTurnover: evidence.estimatedTurnover,
  estimatedFeeRate: evidence.estimatedFeeRate,
  estimatedSlippageRate: evidence.estimatedSlippageRate,
  grossExpectedEdge: evidence.grossExpectedEdge,
});

const trustedEvidence = createPaperPortfolioTrustedLongitudinalEvidence({
  ...riskFacts,
  trustedRun,
  periodIds: Array.from({ length: 40 }, (_, index) => `period-${index}`),
  outcomeReceiptFingerprints: Array.from({ length: 40 }, (_, index) => String(index).padStart(64, "0"))
});
const riskEvidence = Object.freeze({ ...riskFacts, trustedEvidence });
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

test("UNKNOWN INSUFFICIENT and CONFLICTING evidence never becomes allocation confidence", () => {
  for (const status of ["UNKNOWN", "INSUFFICIENT", "CONFLICTING"]) {
    const result = evaluatePaperPortfolioAdvisory({ ...input, evidence: { ...evidence, status } }, policy);
    assert.equal(result.decision, "ABSTAIN");
    assert.equal(result.recommendedWeight, 0);
    assert.ok(result.reasons.includes(`EVIDENCE_${status}`));
  }
});

test("future and stale evidence fail closed", () => {
  const future = evaluatePaperPortfolioAdvisory({ ...input, evidence: { ...evidence, observedAt: "2026-08-29T02:00:00.000Z" } }, policy);
  assert.equal(future.decision, "ABSTAIN");
  assert.ok(future.reasons.includes("FUTURE_EVIDENCE"));
  const stale = evaluatePaperPortfolioAdvisory({ ...input, evidence: { ...evidence, observedAt: "2026-08-27T00:00:00.000Z" } }, policy);
  assert.equal(stale.decision, "ABSTAIN");
  assert.ok(stale.reasons.includes("STALE_EVIDENCE"));
});

test("correlation regime co-failure and concentration limits still force abstention", () => {
  const correlated = evaluatePaperPortfolioAdvisory({ ...input, evidence: { ...evidence, maximumPeerCorrelation: 0.9 } }, policy);
  assert.equal(correlated.decision, "ABSTAIN");
  assert.ok(correlated.reasons.includes("CORRELATION_LIMIT_EXCEEDED"));
  assert.ok(correlated.reasons.includes("RISK_CANDIDATE_DEPENDENCE_MISMATCH"));
  const coFailure = evaluatePaperPortfolioAdvisory({ ...input, evidence: { ...evidence, regimeCoFailureRate: 0.8 } }, policy);
  assert.equal(coFailure.decision, "ABSTAIN");
  assert.ok(coFailure.reasons.includes("REGIME_CO_FAILURE_LIMIT_EXCEEDED"));
  assert.ok(coFailure.reasons.includes("RISK_REGIME_CO_FAILURE_MISMATCH"));
  const concentrated = evaluatePaperPortfolioAdvisory({ ...input, evidence: { ...evidence, currentPortfolioGrossWeight: 0.8 } }, policy);
  assert.equal(concentrated.decision, "ABSTAIN");
  assert.ok(concentrated.reasons.includes("PORTFOLIO_CONCENTRATION_LIMIT_REACHED"));
  assert.ok(concentrated.reasons.includes("RISK_CONCENTRATION_EVIDENCE_MISMATCH"));
});

test("all allocation-driving advisory facts must equal trusted risk facts", () => {
  const mutations = [
    [{ regime: "RISK_OFF" }, "RISK_REGIME_MISMATCH"],
    [{ maximumPeerCorrelation: 0.2 }, "RISK_CANDIDATE_DEPENDENCE_MISMATCH"],
    [{ regimeCoFailureRate: 0.3 }, "RISK_REGIME_CO_FAILURE_MISMATCH"],
    [{ currentPortfolioGrossWeight: 0.5 }, "RISK_CONCENTRATION_EVIDENCE_MISMATCH"],
    [{ currentStrategyWeight: 0.1 }, "RISK_CONCENTRATION_EVIDENCE_MISMATCH"],
    [{ estimatedTurnover: 0.4 }, "RISK_COST_EDGE_EVIDENCE_MISMATCH"],
    [{ estimatedFeeRate: 0.002 }, "RISK_COST_EDGE_EVIDENCE_MISMATCH"],
    [{ estimatedSlippageRate: 0.002 }, "RISK_COST_EDGE_EVIDENCE_MISMATCH"],
    [{ grossExpectedEdge: 0.02 }, "RISK_COST_EDGE_EVIDENCE_MISMATCH"],
  ];
  for (const [mutation, reason] of mutations) {
    const result = evaluatePaperPortfolioAdvisory({ ...input, evidence: { ...evidence, ...mutation } }, policy);
    assert.equal(result.decision, "ABSTAIN");
    assert.equal(result.recommendedWeight, 0);
    assert.ok(result.reasons.includes(reason));
  }
});

test("fees and slippage are charged before positive-edge advice", () => {
  const alteredRisk = { ...riskFacts, estimatedTurnover: 1, estimatedFeeRate: 0.01, estimatedSlippageRate: 0.01, grossExpectedEdge: 0.015 };
  const alteredTrusted = createPaperPortfolioTrustedLongitudinalEvidence({
    ...alteredRisk,
    trustedRun,
    periodIds: Array.from({ length: 40 }, (_, index) => `cost-period-${index}`),
    outcomeReceiptFingerprints: Array.from({ length: 40 }, (_, index) => String(index + 100).padStart(64, "0"))
  });
  const result = evaluatePaperPortfolioAdvisory({
    ...input,
    evidence: { ...evidence, estimatedTurnover: 1, estimatedFeeRate: 0.01, estimatedSlippageRate: 0.01, grossExpectedEdge: 0.015 },
    riskEvidence: { ...alteredRisk, trustedEvidence: alteredTrusted }
  }, policy);
  assert.equal(result.decision, "ABSTAIN");
  assert.ok(result.netExpectedEdge < 0);
  assert.ok(result.reasons.includes("NON_POSITIVE_EDGE_AFTER_COSTS"));
});

test("allocation advice abstains when canonical portfolio risk evidence is absent or not accepted", () => {
  const missing = evaluatePaperPortfolioAdvisory({ ...input, riskEvidence: undefined }, policy);
  assert.equal(missing.decision, "ABSTAIN");
  assert.ok(missing.reasons.includes("RISK_EVIDENCE_MISSING"));
  const rejected = evaluatePaperPortfolioAdvisory({ ...input, riskEvidence: { ...riskEvidence, portfolioDrawdownContribution: 0.11 } }, policy);
  assert.equal(rejected.decision, "ABSTAIN");
  assert.ok(rejected.reasons.includes("RISK_DRAWDOWN_CONTRIBUTION_LIMIT_EXCEEDED"));
});

test("portfolio risk evidence must match advisory provenance and be current at decision time", () => {
  const mismatch = evaluatePaperPortfolioAdvisory({ ...input, riskEvidence: { ...riskEvidence, candidateId: "candidate-other" } }, policy);
  assert.equal(mismatch.decision, "ABSTAIN");
  assert.ok(mismatch.reasons.includes("RISK_EVIDENCE_PROVENANCE_MISMATCH"));
  const future = evaluatePaperPortfolioAdvisory({ ...input, riskEvidence: { ...riskEvidence, evaluatedAt: "2026-08-29T02:00:00.000Z" } }, policy);
  assert.equal(future.decision, "ABSTAIN");
  assert.ok(future.reasons.includes("RISK_EVIDENCE_FUTURE"));
});

test("malformed longitudinal counts policy and derived numerics fail closed", () => {
  for (const evidencePeriods of [Number.NaN, Number.POSITIVE_INFINITY, -1, 1.5]) {
    assert.throws(() => evaluatePaperPortfolioAdvisory({ ...input, evidence: { ...evidence, evidencePeriods } }, policy), /evidencePeriods must be a non-negative integer/);
  }
  for (const malformedPolicy of [
    { ...policy, maximumCorrelation: Number.NaN },
    { ...policy, maximumPortfolioWeight: 1.1 },
    { ...policy, maximumStrategyWeight: -0.1 }
  ]) assert.throws(() => evaluatePaperPortfolioAdvisory(input, malformedPolicy), /must be (finite|between 0 and 1)/);
  assert.throws(() => evaluatePaperPortfolioAdvisory({ ...input, evidence: { ...evidence, grossExpectedEdge: Number.MAX_VALUE } }, policy), /netExpectedEdge must be finite/);
});
