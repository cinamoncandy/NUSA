const test = require("node:test");
const assert = require("node:assert/strict");
const { createCalibrationOutcome, createCalibrationPrediction } = require("../dist/apps/cloud/src/ai/outcomeCalibration.js");
const { GovernedOutcomeAttributionEngine, aiAttributionCalibrationCohortIdentity, aiAttributionEvidenceSnapshotIdentity, scoreAiAttributionBenchmark } = require("../dist/apps/cloud/src/ai/outcomeAttributionLearning.js");
const { GovernedAttributionReplayEvaluator, evaluateAiAttributionNetBenefit, zeroAiAttributionEvaluationResources, aiAttributionEvaluationResourcesFromSnapshot } = require("../dist/apps/cloud/src/ai/outcomeAttributionEvaluation.js");
const { InferenceResourceLedger } = require("../dist/apps/cloud/src/ai/inferenceResourceLedger.js");

const policy = Object.freeze({
  schemaVersion: 1,
  policyId: "WO-AI-009-EVAL-TEST",
  policyVersion: "1",
  allowedCauses: Object.freeze(["EVIDENCE_GAP", "DATA_QUALITY_FAILURE", "MODEL_DISAGREEMENT", "CALIBRATION_MISS", "SCENARIO_SENSITIVITY_MISS", "REGIME_SHIFT_CANDIDATE", "UNRESOLVED"]),
  holdoutSalt: "eval-holdout",
  holdoutPercent: 20,
  defaultEpisodeTtlMs: 60000
});

const budget = (maxModelCalls) => Object.freeze({
  schemaVersion: 1,
  policyId: `AI009-REPLAY-${maxModelCalls}`,
  policyVersion: "1",
  maxModelCalls,
  maxTotalAttempts: 4,
  maxCumulativeOutputTokens: 4096,
  maxInputBytes: 1024 * 1024,
  maxWallClockMs: 10000,
  requireUsageAccounting: false
});

function signals(overrides = {}) {
  return Object.freeze({
    evidenceGapEvidenceReferences: Object.freeze([]),
    dataQualityFailureEvidenceReferences: Object.freeze([]),
    providerComparisonState: "CONSENSUS",
    calibrationStatus: "CALIBRATED",
    scenarioRobustnessState: null,
    regimeShiftEvidenceReferences: Object.freeze([]),
    counterEvidenceReferences: Object.freeze([]),
    modelSelfReportedCause: null,
    providerMajorityCause: null,
    ...overrides
  });
}

function attributionRequest(id) {
  const prediction = createCalibrationPrediction({
    predictionId: `prediction-${id}`,
    orchestrationRunId: `run-${id}`,
    proposalId: `proposal-${id}`,
    agentId: "ai-strategy-proposer",
    role: "STRATEGY_PROPOSER",
    providerId: "openai",
    modelVersionId: "model-v1",
    promptArtifactId: "nusa.ai.strategy_proposer",
    promptArtifactVersion: "1.0.0",
    promptArtifactDigest: "a".repeat(64),
    outcomeDefinitionId: "UPBIT_PUBLIC_PRICE_HIGHER_AFTER_5M",
    outcomeDefinitionVersion: "1",
    targetId: "KRW-BTC",
    anchorValue: 100,
    anchorObservedAt: 900,
    anchorEvidenceReference: `anchor-${id}`,
    rawProbability: 0.8,
    predictedAt: 1000,
    horizonMs: 300000,
    provenance: "VERIFIED_RUNTIME"
  });
  const outcome = createCalibrationOutcome({
    predictionId: prediction.predictionId,
    predictionContentHash: prediction.contentHash,
    outcomeDefinitionId: prediction.outcomeDefinitionId,
    outcomeDefinitionVersion: prediction.outcomeDefinitionVersion,
    outcome: false,
    resolvedValue: 99,
    resolvedAt: 301000,
    evidenceReferences: [`outcome-${id}`],
    provenance: "VERIFIED_RUNTIME"
  });
  const observedEvidence = Object.freeze([
    Object.freeze({ evidenceId: `anchor-${id}`, contentDigest: "b".repeat(64), provenance: "VERIFIED_RUNTIME" }),
    Object.freeze({ evidenceId: `outcome-${id}`, contentDigest: "c".repeat(64), provenance: "VERIFIED_RUNTIME" })
  ]);
  return Object.freeze({
    episodeId: `episode-${id}`,
    prediction,
    outcome,
    observedEvidence,
    lineage: Object.freeze({
      providerId: prediction.providerId,
      modelVersionId: prediction.modelVersionId,
      promptArtifactId: prediction.promptArtifactId,
      promptArtifactVersion: prediction.promptArtifactVersion,
      promptArtifactDigest: prediction.promptArtifactDigest,
      calibrationCohortIdentity: aiAttributionCalibrationCohortIdentity(prediction),
      evidenceSnapshotIdentity: aiAttributionEvidenceSnapshotIdentity(prediction, outcome, observedEvidence)
    }),
    signals: signals(),
    scope: "KRW-BTC:5m",
    createdAt: 400000
  });
}

function quality(knownCorrect) {
  return scoreAiAttributionBenchmark([
    {
      caseId: "known",
      expectedCause: "EVIDENCE_GAP",
      expectedAmbiguous: false,
      actualStrength: knownCorrect ? "IDENTIFIED" : "UNRESOLVED",
      actualCause: knownCorrect ? "EVIDENCE_GAP" : null
    },
    {
      caseId: "ambiguous",
      expectedCause: null,
      expectedAmbiguous: true,
      actualStrength: "UNRESOLVED",
      actualCause: null
    }
  ]);
}

const netPolicy = Object.freeze({
  schemaVersion: 1,
  policyId: "AI009-NET-BENEFIT",
  policyVersion: "1",
  requireQualityImprovement: true,
  maxProviderCallIncrease: 0,
  maxAttemptIncrease: 0,
  maxTokenIncrease: 0,
  maxLatencyIncreaseMs: 10,
  maxFailureRateIncrease: 0
});

test("one-dimension attribution replay uses one externally owned WO-AI-006 resource controller", async () => {
  let now = 100;
  let providerSideEffects = 0;
  const resources = new InferenceResourceLedger(budget(2), now);
  const engine = new GovernedOutcomeAttributionEngine(policy);
  const runner = {
    async runVariant(variant, sharedResources) {
      now += 1;
      if (!sharedResources.reserveCall(`ai009-${variant.kind}`, now)) throw new Error("resource blocked");
      providerSideEffects += 1;
      return variant.expectedSignals;
    }
  };
  const evaluator = new GovernedAttributionReplayEvaluator(engine, runner, { now: () => now });
  const request = attributionRequest("replay-complete");
  const ablated = signals({ evidenceGapEvidenceReferences: Object.freeze(["removed-evidence"]) });
  const result = await evaluator.run("exp-complete", request, ablated, resources);
  assert.equal(result.status, "COMPLETED");
  assert.equal(result.changedDimension, "evidenceGapEvidenceReferences");
  assert.equal(providerSideEffects, 2);
  assert.equal(result.resourceAfter.modelCalls, 2);
  assert.equal(result.baseline.strength, "UNRESOLVED");
  assert.equal(result.ablation.strength, "IDENTIFIED");
  assert.equal(result.baseline.realizedLearningCreditAllowed, false);
  assert.equal(result.ablation.realizedLearningCreditAllowed, false);
  assert.equal(result.liveAuthority, "NONE");
  assert.equal(result.productionMutationAllowed, false);
});

test("resource exhaustion blocks later replay provider side effects fail-closed", async () => {
  let now = 100;
  let providerSideEffects = 0;
  const resources = new InferenceResourceLedger(budget(1), now);
  const engine = new GovernedOutcomeAttributionEngine(policy);
  const runner = {
    async runVariant(variant, sharedResources) {
      now += 1;
      if (!sharedResources.reserveCall(`ai009-${variant.kind}`, now)) throw new Error("resource blocked");
      providerSideEffects += 1;
      return variant.expectedSignals;
    }
  };
  const evaluator = new GovernedAttributionReplayEvaluator(engine, runner, { now: () => now });
  const result = await evaluator.run(
    "exp-exhausted",
    attributionRequest("replay-exhausted"),
    signals({ evidenceGapEvidenceReferences: Object.freeze(["removed-evidence"]) }),
    resources
  );
  assert.equal(result.status, "RESOURCE_BLOCKED");
  assert.equal(providerSideEffects, 1, "second provider side effect must never be admitted");
  assert.equal(result.resourceAfter.health, "EXHAUSTED");
  assert.ok(result.reasonCodes.includes("ABLATION_REPLAY_RESOURCE_BLOCKED"));
});

test("invalid multi-dimension ablation is rejected before replay side effects", async () => {
  const now = 100;
  let calls = 0;
  const resources = new InferenceResourceLedger(budget(2), now);
  const evaluator = new GovernedAttributionReplayEvaluator(new GovernedOutcomeAttributionEngine(policy), {
    async runVariant(variant) { calls += 1; return variant.expectedSignals; }
  }, { now: () => now });
  const result = await evaluator.run(
    "exp-invalid",
    attributionRequest("replay-invalid"),
    signals({ evidenceGapEvidenceReferences: Object.freeze(["missing"]), calibrationStatus: "DEGRADED" }),
    resources
  );
  assert.equal(result.status, "UNVERIFIED");
  assert.equal(calls, 0);
  assert.ok(result.reasonCodes.includes("INVALID_ABLATION_DIMENSION_COUNT"));
});

test("net-benefit gate passes measured quality gain with zero provider/token/failure regression", () => {
  const before = quality(false);
  const after = quality(true);
  const result = evaluateAiAttributionNetBenefit(netPolicy, {
    beforeQuality: before,
    afterQuality: after,
    beforeResources: zeroAiAttributionEvaluationResources(5),
    afterResources: zeroAiAttributionEvaluationResources(10),
    safetyRegressionCount: 0
  });
  assert.equal(result.status, "PASS");
  assert.equal(result.knownCauseAccuracyDelta, 1);
  assert.equal(result.providerCallDelta, 0);
  assert.equal(result.tokenDelta, 0);
  assert.equal(result.failureRateDelta, 0);
  assert.ok(result.reasonCodes.includes("NET_BENEFIT_VERIFIED"));
});

test("quality gain cannot compensate for provider, latency, failure or safety regression", () => {
  const beforeQuality = quality(false);
  const afterQuality = quality(true);
  const zero = zeroAiAttributionEvaluationResources(5);
  const cases = [
    [{ ...zero, providerCalls: 1 }, 0, "PROVIDER_CALL_REGRESSION"],
    [{ ...zero, latencyMs: 20 }, 0, "LATENCY_REGRESSION"],
    [{ ...zero, failureRate: 0.2 }, 0, "FAILURE_RATE_REGRESSION"],
    [zero, 1, "SAFETY_REGRESSION"]
  ];
  for (const [afterResources, safetyRegressionCount, reason] of cases) {
    const result = evaluateAiAttributionNetBenefit(netPolicy, { beforeQuality, afterQuality, beforeResources: zero, afterResources, safetyRegressionCount });
    assert.equal(result.status, "FAIL");
    assert.ok(result.reasonCodes.includes(reason));
  }
});

test("WO-AI-006 resource snapshot accounting remains truthful for zero-call attribution path", () => {
  const resources = new InferenceResourceLedger(budget(2), 100);
  const metrics = aiAttributionEvaluationResourcesFromSnapshot(resources.snapshot(100));
  assert.deepEqual(metrics, { providerCalls: 0, attempts: 0, totalTokens: 0, latencyMs: 0, failureRate: 0 });
});
