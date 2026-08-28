const test = require("node:test");
const assert = require("node:assert/strict");
const { classifyPaperPortfolioPerformance } = require("../dist/apps/cloud/src/paperPortfolioPerformanceEvidence.js");

const hash = "b".repeat(64);
const observation = (index, overrides = {}) => ({
  observationId: `obs-${index}`,
  candidateId: "candidate-881-performance",
  datasetId: "dataset-881-performance",
  datasetContentSha256: hash,
  periodStartAt: `2026-08-${String(index + 1).padStart(2, "0")}T00:00:00.000Z`,
  periodEndAt: `2026-08-${String(index + 1).padStart(2, "0")}T12:00:00.000Z`,
  status: "VERIFIED",
  portfolioGrossReturn: 0.012,
  portfolioTurnover: 0.25,
  portfolioFeeRate: 0.001,
  portfolioSlippageRate: 0.001,
  benchmarkNetReturn: 0.006,
  componentNetReturns: [0.007, 0.008],
  ...overrides,
});
const input = (overrides = {}) => ({
  evaluationId: "evaluation-881-performance",
  candidateId: "candidate-881-performance",
  datasetId: "dataset-881-performance",
  datasetContentSha256: hash,
  evaluatedAt: "2026-09-01T00:00:00.000Z",
  minimumEvidencePeriods: 3,
  minimumImprovement: 0.001,
  regressionTolerance: 0.001,
  observations: [observation(0), observation(1), observation(2)],
  ...overrides,
});

test("verified improvement requires after-cost outperformance versus benchmark and best component", () => {
  const result = classifyPaperPortfolioPerformance(input());
  assert.equal(result.classification, "VERIFIED_IMPROVEMENT");
  assert.ok(result.portfolioVsBenchmark >= 0.001);
  assert.ok(result.portfolioVsBestComponent >= 0.001);
  assert.equal(result.liveAuthority, "NONE");
  assert.equal(result.productionMutationAllowed, false);
  assert.equal(result.aiAuthority, "ZERO_AUTHORITY");
});

test("unknown insufficient and conflicting evidence never become improvement", () => {
  for (const status of ["UNKNOWN", "INSUFFICIENT", "CONFLICTING"]) {
    const result = classifyPaperPortfolioPerformance(input({
      observations: [observation(0, { status }), observation(1), observation(2)],
    }));
    assert.equal(result.classification, "INSUFFICIENT");
    assert.equal(result.portfolioNetReturnMean, null);
    assert.ok(result.reasons.includes(`EVIDENCE_${status}`));
  }
});

test("provenance duplicate future and chronology failures fail closed", () => {
  const provenance = classifyPaperPortfolioPerformance(input({
    observations: [observation(0, { candidateId: "wrong" }), observation(1), observation(2)],
  }));
  assert.equal(provenance.classification, "INSUFFICIENT");
  assert.ok(provenance.reasons.includes("PROVENANCE_MISMATCH"));

  const duplicate = classifyPaperPortfolioPerformance(input({
    observations: [observation(0), observation(1, { observationId: "obs-0" }), observation(2)],
  }));
  assert.equal(duplicate.classification, "INSUFFICIENT");
  assert.ok(duplicate.reasons.includes("DUPLICATE_OBSERVATION"));

  const future = classifyPaperPortfolioPerformance(input({
    observations: [observation(0), observation(1), observation(2, {
      periodStartAt: "2026-09-02T00:00:00.000Z",
      periodEndAt: "2026-09-02T12:00:00.000Z",
    })],
  }));
  assert.equal(future.classification, "INSUFFICIENT");
  assert.ok(future.reasons.includes("FUTURE_EVIDENCE"));

  const chronology = classifyPaperPortfolioPerformance(input({
    observations: [observation(0), observation(1), observation(2, {
      periodStartAt: "2026-08-03T12:00:00.000Z",
      periodEndAt: "2026-08-03T00:00:00.000Z",
    })],
  }));
  assert.equal(chronology.classification, "INSUFFICIENT");
  assert.ok(chronology.reasons.includes("INVALID_PERIOD_CHRONOLOGY"));
});

test("cost erosion produces regression and rollback or rework recommendation", () => {
  const result = classifyPaperPortfolioPerformance(input({
    observations: [0, 1, 2].map((index) => observation(index, {
      portfolioGrossReturn: 0.01,
      portfolioTurnover: 1,
      portfolioFeeRate: 0.003,
      portfolioSlippageRate: 0.003,
      benchmarkNetReturn: 0.006,
      componentNetReturns: [0.007, 0.008],
    })),
  }));
  assert.equal(result.classification, "REGRESSION");
  assert.ok(result.reasons.includes("PORTFOLIO_PERFORMANCE_REGRESSION_REQUIRES_REWORK_OR_ROLLBACK_RECOMMENDATION"));
});

test("neutral and insufficient evidence cannot manufacture verified value", () => {
  const neutral = classifyPaperPortfolioPerformance(input({
    observations: [0, 1, 2].map((index) => observation(index, {
      portfolioGrossReturn: 0.009,
      portfolioTurnover: 0,
      benchmarkNetReturn: 0.0085,
      componentNetReturns: [0.0084, 0.0086],
    })),
  }));
  assert.equal(neutral.classification, "NEUTRAL");

  const short = classifyPaperPortfolioPerformance(input({ observations: [observation(0), observation(1)] }));
  assert.equal(short.classification, "INSUFFICIENT");
  assert.ok(short.reasons.includes("INSUFFICIENT_LONGITUDINAL_EVIDENCE"));

  const missingComponent = classifyPaperPortfolioPerformance(input({
    observations: [observation(0, { componentNetReturns: [] }), observation(1), observation(2)],
  }));
  assert.equal(missingComponent.classification, "INSUFFICIENT");
  assert.ok(missingComponent.reasons.includes("MISSING_COMPONENT_BENCHMARK"));
});
