const test = require("node:test");
const assert = require("node:assert/strict");
const {
  createPaperPortfolioTrustedLongitudinalEvidence,
  evaluatePaperPortfolioRiskEvidence,
} = require("../dist/apps/cloud/src/paperPortfolioRiskEvidence.js");

const trustedRun = {
  verificationSource: "GITHUB_API",
  repository: "cinamoncandy/NUSA",
  headSha: "a".repeat(40),
  workflowRunId: 33150000000,
  workflowRunAttempt: 1,
  workflowRef: "cinamoncandy/NUSA/.github/workflows/actual-paper-runtime.yml@refs/heads/main",
  eventName: "workflow_dispatch",
  workflowRunUrl: "https://github.com/cinamoncandy/NUSA/actions/runs/33150000000",
};

const baseInput = {
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
  maximumAbsoluteCandidateCorrelation: 0.45,
  maximumAllowedCandidateCorrelation: 0.85,
  portfolioRegime: "RISK_ON",
  regimeCoFailureRate: 0.2,
  currentPortfolioGrossWeight: 0.4,
  currentStrategyWeight: 0,
  estimatedTurnover: 0.25,
  estimatedFeeRate: 0.001,
  estimatedSlippageRate: 0.001,
  grossExpectedEdge: 0.01,
};

const trustedEvidenceFor = (value) => createPaperPortfolioTrustedLongitudinalEvidence({
  ...value,
  trustedRun,
  periodIds: Array.from({ length: value.evidencePeriods }, (_, index) => `period-${index}`),
  outcomeReceiptFingerprints: Array.from({ length: value.evidencePeriods }, (_, index) => String(index).padStart(64, "0")),
});

const input = (overrides = {}) => {
  const value = { ...baseInput, ...overrides };
  const trustedEvidence = Object.prototype.hasOwnProperty.call(overrides, "trustedEvidence")
    ? overrides.trustedEvidence
    : (() => {
      try { return trustedEvidenceFor(value); } catch { return undefined; }
    })();
  return { ...value, trustedEvidence };
};

test("accepts only verified point-in-time risk evidence inside portfolio bounds", () => {
  const result = evaluatePaperPortfolioRiskEvidence(input());
  assert.equal(result.decision, "ACCEPT");
  assert.deepEqual(result.reasons, []);
  assert.equal(result.maximumAbsoluteCandidateCorrelation, 0.45);
  assert.equal(result.regimeCoFailureRate, 0.2);
  assert.equal(result.currentPortfolioGrossWeight, 0.4);
  assert.equal(result.estimatedTurnover, 0.25);
  assert.equal(result.grossExpectedEdge, 0.01);
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

test("drawdown diversification and candidate dependence remain bounded", () => {
  const drawdown = evaluatePaperPortfolioRiskEvidence(input({ portfolioDrawdownContribution: 0.11 }));
  assert.ok(drawdown.reasons.includes("DRAWDOWN_CONTRIBUTION_LIMIT_EXCEEDED"));
  const diversification = evaluatePaperPortfolioRiskEvidence(input({ diversificationBenefit: 0.005 }));
  assert.ok(diversification.reasons.includes("INSUFFICIENT_DIVERSIFICATION_BENEFIT"));
  const dependence = evaluatePaperPortfolioRiskEvidence(input({ maximumAbsoluteCandidateCorrelation: 0.96 }));
  assert.ok(dependence.reasons.includes("CANDIDATE_DEPENDENCE_LIMIT_EXCEEDED"));
});

test("every allocation-driving fact is fingerprint-bound and cannot be swapped", () => {
  const trustedEvidence = trustedEvidenceFor(baseInput);
  const mutations = [
    { maximumAbsoluteCandidateCorrelation: 0.46 },
    { portfolioRegime: "RISK_OFF" },
    { regimeCoFailureRate: 0.21 },
    { currentPortfolioGrossWeight: 0.41 },
    { currentStrategyWeight: 0.01 },
    { estimatedTurnover: 0.26 },
    { estimatedFeeRate: 0.002 },
    { estimatedSlippageRate: 0.002 },
    { grossExpectedEdge: 0.011 },
    { portfolioDrawdownContribution: 0.09 },
    { diversificationBenefit: 0.04 },
  ];
  for (const mutation of mutations) {
    const result = evaluatePaperPortfolioRiskEvidence(input({ ...mutation, trustedEvidence }));
    assert.equal(result.decision, "ABSTAIN");
    assert.ok(result.reasons.includes("TRUSTED_PAPER_EVIDENCE_FINGERPRINT_MISMATCH"));
  }
});

test("malformed provenance and allocation-driving numerics fail closed", () => {
  assert.throws(() => evaluatePaperPortfolioRiskEvidence(input({ datasetContentSha256: "bad" })), /sha256/);
  assert.throws(() => evaluatePaperPortfolioRiskEvidence(input({ portfolioDrawdownContribution: Number.NaN })), /finite/);
  assert.throws(() => evaluatePaperPortfolioRiskEvidence(input({ maximumAbsoluteCandidateCorrelation: 1.01 })), /between 0 and 1/);
  assert.throws(() => evaluatePaperPortfolioRiskEvidence(input({ regimeCoFailureRate: 1.01 })), /between 0 and 1/);
  assert.throws(() => evaluatePaperPortfolioRiskEvidence(input({ currentPortfolioGrossWeight: -0.01 })), /between 0 and 1/);
  assert.throws(() => evaluatePaperPortfolioRiskEvidence(input({ estimatedTurnover: Number.POSITIVE_INFINITY })), /finite/);
  assert.throws(() => evaluatePaperPortfolioRiskEvidence(input({ grossExpectedEdge: Number.NaN })), /finite/);
});

test("caller-asserted VERIFIED evidence without the canonical capability stays abstained", () => {
  const result = evaluatePaperPortfolioRiskEvidence(input({
    trustedEvidence: {
      verificationStatus: "VERIFIED",
      candidateId: "candidate-881-risk",
      datasetId: "dataset-881-risk",
      datasetContentSha256: "c".repeat(64),
    },
  }));
  assert.equal(result.decision, "ABSTAIN");
  assert.ok(result.reasons.includes("UNTRUSTED_PAPER_EVIDENCE"));
});
