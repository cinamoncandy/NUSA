const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { ResearchCandidateGate } = require("../dist/apps/cloud/src/researchCandidateGate.js");
const { ResearchStreamNormalizer } = require("../dist/apps/cloud/src/researchStreamNormalizer.js");
const { createResearchExperimentManifest, validateResearchExperimentManifest, validateResearchExperimentResult, researchHardeningHash } = require("../dist/packages/contracts/src/researchHardening.js");
const { appendResearchHypothesisEvent, replayResearchHypothesisEvents } = require("../dist/packages/contracts/src/researchMemoryLifecycle.js");

const sha = (char) => char.repeat(64);
const provenance = (windowId, role = "VALIDATION", split = windowId) => ({ researchRunId: "run-1", sessionId: "session-1", experimentId: `experiment-${windowId}`, evaluationId: `evaluation-${windowId}`, datasetId: "dataset-1", datasetContentSha256: sha("a"), datasetManifestSchemaVersion: 1, market: "KRW-BTC", interval: "1m", startEventTime: role === "HOLDOUT" ? 3 : 1, endEventTime: role === "HOLDOUT" ? 4 : 2, featurePipelineVersion: "features-1", featurePipelineHash: sha("b"), strategyId: "challenger-1", strategyVersion: "1.0.0", strategyArtifactHash: sha("c"), strategyConfigHash: sha("d"), sourceCommitSha: "e".repeat(40), evaluatorVersion: "eval-1", modelVersion: "model-1", fillModelVersion: "fill-1", feeModelVersion: "fee-1", slippageModelVersion: "slip-1", randomSeed: "seed-1", splitIdentity: split, splitHash: sha(split === "holdout" ? "f" : "1"), walkForwardConfigHash: sha("2"), experimentFamilyId: "family-1", attempt: 1, hypothesisLineage: "hypothesis-1", trainingWindowHash: sha("3"), validationWindowHash: sha("4"), finalHoldoutWindowHash: sha("5"), canonicalInputHash: sha(windowId === "window-1" ? "3" : "4"), finalHoldoutUntouched: role === "HOLDOUT", windowId, windowRole: role });
const metrics = (overrides = {}) => ({ netReturn: 0.2, costAdjustedReturn: 0.18, maximumDrawdown: 0.1, sharpeRatio: 1.4, profitFactor: 1.3, executionQuality: 0.99, unresolvedFaultCount: 0, dataQualityFailures: 0, tradeCount: 60, observationDays: 31, statisticalConfidence: 0.99, superiorityMargin: 0.01, ...overrides });
const candidateId = (p) => `candidate-${researchHardeningHash({ sessionId: p.researchRunId, strategyId: p.strategyId, strategyVersion: p.strategyVersion }).slice(0, 48)}`;
const evidence = (p, overrides = {}) => ({ schemaVersion: 1, researchRunId: p.researchRunId, evaluationId: p.evaluationId, strategyId: p.strategyId, strategyVersion: p.strategyVersion, marketDataTimestamp: 2, evaluationTimestamp: 3, canonicalInputHash: p.canonicalInputHash, modelVersion: p.modelVersion, fillModelVersion: p.fillModelVersion, feeModelVersion: p.feeModelVersion, slippageModelVersion: p.slippageModelVersion, costEvidence: { schemaVersion: 1, evaluationId: p.evaluationId, datasetId: p.datasetId, datasetContentSha256: p.datasetContentSha256, feeRate: 0.001, spreadRate: 0.0005, slippageRate: 0.0005, turnoverRate: 20, grossReturn: 0.22, netReturn: 0.18, costModelVersion: "cost-v1", observedAt: 2 }, provenance: p, champion: { strategyId: "champion-1", strategyVersion: "1.0.0", authority: "PAPER_ONLY", evaluatorVersion: "champion-eval", canonicalInputHash: p.canonicalInputHash, metrics: metrics({ netReturn: 0.1, costAdjustedReturn: 0.09, sharpeRatio: 1.1 }), signal: "HOLD" }, challenger: { strategyId: p.strategyId, strategyVersion: p.strategyVersion, authority: "ZERO_AUTHORITY", evaluatorVersion: "eval-1", canonicalInputHash: p.canonicalInputHash, metrics: metrics(), signal: "HOLD" }, result: "CHALLENGER_BETTER", reason: "MULTI_METRIC_COMPARISON", productionMutationAllowed: false, promotionAllowed: false, ...overrides });

test("a single winning net-return evaluation never creates eligibility", () => {
  const p = provenance("window-1");
  const result = new ResearchCandidateGate({ nowMs: 10 }).evaluate({ candidateId: candidateId(p), evidence: [evidence(p)] });
  assert.equal(result.status, "NOT_ELIGIBLE");
  assert.ok(result.reasons.includes("INSUFFICIENT_INDEPENDENT_WINDOWS"));
  assert.ok(result.reasons.includes("HOLDOUT_REQUIRED"));
});

test("multiple independent windows with untouched holdout and multi-metric evidence are eligible only for PAPER", () => {
  const first = provenance("window-1");
  const second = provenance("window-2", "HOLDOUT", "holdout");
  const result = new ResearchCandidateGate({ nowMs: 10 }).evaluate({ candidateId: candidateId(first), evidence: [evidence(first), evidence(second)], provenance: [first, second] });
  assert.equal(result.status, "ELIGIBLE");
  assert.equal(result.candidateAuthority, "PAPER_ONLY");
  assert.equal(result.automaticPromotion, false);
});

test("missing provenance, faults, poor drawdown, and reused holdout fail closed", () => {
  const first = provenance("window-1");
  const second = provenance("window-2", "HOLDOUT", "holdout");
  const result = new ResearchCandidateGate({ nowMs: 10 }).evaluate({ candidateId: candidateId(first), evidence: [evidence(first, { challenger: { ...evidence(first).challenger, metrics: metrics({ unresolvedFaultCount: 1, maximumDrawdown: 0.3 }) } }), evidence(second)], provenance: [first, { ...second, splitHash: first.splitHash }] });
  assert.equal(result.status, "NOT_ELIGIBLE");
  assert.ok(result.reasons.includes("UNRESOLVED_FAULT"));
  assert.ok(result.reasons.includes("DRAWDOWN_NON_REGRESSION_FAILED"));
  assert.ok(result.reasons.includes("HOLDOUT_REUSED"));
});

test("stream normalizer suppresses duplicates, bounds backlog, and reports late/gap conditions", () => {
  const normalizer = new ResearchStreamNormalizer({ maxPendingEvents: 1, gapThresholdMs: 10, allowedLatenessMs: 2 });
  assert.equal(normalizer.accept({ market: "KRW-BTC", price: 100, eventTime: 1, receivedAt: 1 }).disposition, "ACCEPTED");
  assert.equal(normalizer.accept({ market: "KRW-BTC", price: 100, eventTime: 1, receivedAt: 1 }).disposition, "DUPLICATE");
  assert.equal(normalizer.accept({ market: "KRW-BTC", price: 101, eventTime: 20, receivedAt: 20 }).disposition, "GAP");
  assert.equal(normalizer.accept({ market: "KRW-BTC", price: 99, eventTime: 1, receivedAt: 21 }).disposition, "TOO_LATE");
});

test("typed experiment manifest and result reject unsupported or tampered schemas", () => {
  const p = provenance("window-1");
  const manifest = createResearchExperimentManifest({ experimentId: p.experimentId, researchRunId: p.researchRunId, sessionId: p.sessionId, datasetId: p.datasetId, datasetContentSha256: p.datasetContentSha256, splitIdentity: p.splitIdentity, splitHash: p.splitHash, windowId: p.windowId, windowRole: p.windowRole, startEventTime: p.startEventTime, endEventTime: p.endEventTime, featurePipelineHash: p.featurePipelineHash, strategyArtifactHash: p.strategyArtifactHash, strategyConfigHash: p.strategyConfigHash, sourceCommitSha: p.sourceCommitSha, evaluatorVersion: p.evaluatorVersion, modelVersion: p.modelVersion, fillModelVersion: p.fillModelVersion, feeModelVersion: p.feeModelVersion, slippageModelVersion: p.slippageModelVersion, randomSeed: p.randomSeed, walkForwardConfigHash: p.walkForwardConfigHash });
  assert.deepEqual(validateResearchExperimentManifest(manifest), []);
  assert.notDeepEqual(validateResearchExperimentManifest({ ...manifest, canonicalHash: sha("f") }), []);
  const result = { schemaVersion: 1, experimentId: p.experimentId, evaluationId: p.evaluationId, result: "CHALLENGER_BETTER", champion: metrics(), challenger: metrics(), inconclusiveRate: 0, statisticalConfidence: 0.99, superiorityMargin: 0.01, provenanceHash: researchHardeningHash(p), canonicalHash: sha("e") };
  assert.deepEqual(validateResearchExperimentResult(result), []);
  assert.ok(validateResearchExperimentResult({ ...result, schemaVersion: 99 }).includes("UNSUPPORTED_RESULT_SCHEMA"));
});

test("hypothesis lifecycle is append-only and terminal transitions are rejected", () => {
  let events = appendResearchHypothesisEvent([], { hypothesisId: "h-1", type: "CREATED", title: "H", statement: "S", occurredAt: "2026-08-08T00:00:00.000Z" });
  events = appendResearchHypothesisEvent(events, { hypothesisId: "h-1", type: "ACTIVATED", title: "H", statement: "S", occurredAt: "2026-08-08T00:00:01.000Z" });
  events = appendResearchHypothesisEvent(events, { hypothesisId: "h-1", type: "REJECTED", title: "H", statement: "S", occurredAt: "2026-08-08T00:00:02.000Z" });
  assert.equal(replayResearchHypothesisEvents(events).get("h-1"), "REJECTED");
  assert.throws(() => appendResearchHypothesisEvent(events, { hypothesisId: "h-1", type: "ACTIVATED", title: "H", statement: "S", occurredAt: "2026-08-08T00:00:03.000Z" }), /transition/);
  assert.throws(() => replayResearchHypothesisEvents(events.map((event) => event.sequence === 2 ? { ...event, hash: "f".repeat(64) } : event)), /integrity/);
});

test("future and non-finite evaluation timestamps fail closed", () => {
  const p = provenance("window-1");
  const gate = new ResearchCandidateGate({ nowMs: 10 });
  const future = gate.evaluate({ candidateId: candidateId(p), evidence: [evidence(p, { evaluationTimestamp: 11 })] });
  assert.equal(future.status, "NOT_ELIGIBLE");
  assert.ok(future.reasons.includes("FUTURE_EVALUATION_TIMESTAMP"));
  const nonFinite = gate.evaluate({ candidateId: candidateId(p), evidence: [evidence(p, { evaluationTimestamp: Number.NaN })] });
  assert.equal(nonFinite.status, "NOT_ELIGIBLE");
  assert.ok(nonFinite.reasons.includes("INVALID_EVALUATION_TIMESTAMP"));
});

test("candidate admission rejects provenance that does not bind the evidence identity", () => {
  const first = provenance("window-1");
  const second = provenance("window-2", "HOLDOUT", "holdout");
  const mismatched = { ...second, datasetId: "dataset-tampered" };
  const result = new ResearchCandidateGate({ nowMs: 10 }).evaluate({
    candidateId: candidateId(first),
    evidence: [evidence(first), evidence(second)],
    provenance: [first, mismatched],
  });
  assert.equal(result.status, "NOT_ELIGIBLE");
  assert.ok(result.reasons.includes("PROVENANCE_EVIDENCE_MISMATCH"));
});


test("candidate freshness uses the injected clock at evaluation time", () => {
  const p = provenance("window-1");
  const result = new ResearchCandidateGate({ nowMs: 10, clock: () => 11 }).evaluate({
    candidateId: candidateId(p),
    evidence: [evidence(p, { evaluationTimestamp: 11 })],
  });
  assert.equal(result.status, "NOT_ELIGIBLE");
  assert.equal(result.reasons.includes("FUTURE_EVALUATION_TIMESTAMP"), false);
});


test("candidate admission requires explicit cost evidence", () => {
  const p = provenance("window-1");
  const result = new ResearchCandidateGate({ nowMs: 10 }).evaluate({
    candidateId: candidateId(p),
    evidence: [evidence(p, { costEvidence: undefined })],
  });
  assert.equal(result.status, "NOT_ELIGIBLE");
  assert.ok(result.reasons.includes("MISSING_COST_EVIDENCE"));
});

test("candidate admission rejects future or provenance-mismatched cost evidence", () => {
  const p = provenance("window-1");
  const gate = new ResearchCandidateGate({ nowMs: 10 });
  const future = gate.evaluate({
    candidateId: candidateId(p),
    evidence: [evidence(p, { costEvidence: { ...evidence(p).costEvidence, observedAt: 4 } })],
  });
  assert.equal(future.status, "NOT_ELIGIBLE");
  assert.ok(future.reasons.includes("COST_EVIDENCE_FUTURE_COST_EVIDENCE"));
  const mismatched = gate.evaluate({
    candidateId: candidateId(p),
    evidence: [evidence(p, { costEvidence: { ...evidence(p).costEvidence, datasetId: "dataset-tampered" } })],
  });
  assert.equal(mismatched.status, "NOT_ELIGIBLE");
  assert.ok(mismatched.reasons.includes("COST_EVIDENCE_PROVENANCE_MISMATCH"));
});

test("candidate admission rejects cost evidence that disagrees with cost-adjusted return", () => {
  const p = provenance("window-1");
  const result = new ResearchCandidateGate({ nowMs: 10 }).evaluate({
    candidateId: candidateId(p),
    evidence: [evidence(p, { costEvidence: { ...evidence(p).costEvidence, netReturn: 0.19 } })],
  });
  assert.equal(result.status, "NOT_ELIGIBLE");
  assert.ok(result.reasons.includes("COST_EVIDENCE_RETURN_MISMATCH"));
});
