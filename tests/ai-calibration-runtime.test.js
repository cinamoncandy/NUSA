const test = require("node:test");
const assert = require("node:assert/strict");
const { aiSha256 } = require("../dist/packages/contracts/src/aiInference.js");
const { TransportModelProvider } = require("../dist/apps/cloud/src/ai/modelProvider.js");
const { createCloudAiRuntime } = require("../dist/apps/cloud/src/ai/runtime.js");
const { createCalibrationOutcome } = require("../dist/apps/cloud/src/ai/outcomeCalibration.js");

const marketPayload = Object.freeze({ market: "KRW-BTC", price: 100, source: "UPBIT_PUBLIC_TICKER" });
const contentDigest = aiSha256(marketPayload);
const evidence = Object.freeze({ evidenceId: "e-1", evidenceType: "market-data", sourceReference: "market-feed:1", observedAt: 1, validUntil: 100, quality: "verified", contentDigest, lineageReferences: [] });
const materialization = Object.freeze({ evidenceId: "e-1", contentDigest, payload: marketPayload });

const provider = new TransportModelProvider("openai", "model-v1", async (request) => {
  let payload;
  if (request.role === "EVIDENCE_PRODUCER") payload = { observations: [{ claim: "verified market state", claimType: "fact", evidenceReferences: ["e-1"], freshnessStatus: "fresh" }], missingEvidence: [], evidenceBundleHash: request.input.evidenceBundleHash };
  if (request.role === "STRATEGY_PROPOSER") payload = { strategyVersionId: "strategy-preview", decision: "candidate", rationaleClaims: ["candidate"], assumptions: ["paper only"], uncertainty: "medium", rawProbability: 0.8, expectedEffect: "research", costSensitivity: "unknown", capacitySensitivity: "unknown" };
  if (request.role === "ADVERSARIAL_CRITIC") payload = { reviewedProposalHash: request.input.proposalHash, counterClaims: [], failedAssumptions: [], missingTests: [], alternativeExplanations: [], severity: "low" };
  if (request.role === "RISK_VERIFIER") payload = { result: "verified", hardDenies: [], warnings: [], missingRequirements: [], requiredEscalations: [], policyReferences: ["risk-policy"] };
  const output = { schemaVersion: 1, role: request.role, evidenceReferences: ["e-1"], payload };
  return { requestId: request.requestId, providerId: request.providerId, modelVersionId: request.modelVersionId, promptArtifactDigest: request.promptArtifactDigest, contextHash: request.contextHash, inputHash: request.inputHash, structuredOutput: output, outputHash: aiSha256(output), startedAt: 10, completedAt: 20 };
});

const waitForRuntime = async (runtime) => {
  for (let attempt = 0; attempt < 20 && runtime.isInFlight(); attempt += 1) await new Promise((resolve) => setImmediate(resolve));
  assert.equal(runtime.isInFlight(), false);
};

test("cloud AI runtime records verified predictions and recalculates read-only calibration after verified outcomes", async () => {
  const runtime = createCloudAiRuntime({ NUSA_AI_ENABLED: "true" }, provider, {
    now: () => 1_000,
    minimumCadenceMs: 0,
    maximumResultAgeMs: 10_000,
    calibration: {
      outcomeDefinitionId: "next-period-positive",
      outcomeDefinitionVersion: "1",
      horizonMs: 100,
      policy: { minimumSamples: 1, maximumExpectedCalibrationError: 1, maximumBrierScore: 1 }
    }
  });
  assert.equal(runtime.schedule({ orchestrationRunId: "runtime-1", decisionId: "decision-1", evaluatedAt: 10, evidence: [evidence], evidenceMaterializations: [materialization] }), true);
  await waitForRuntime(runtime);

  const prediction = runtime.latestCalibrationPrediction();
  assert.ok(prediction);
  assert.equal(prediction.providerId, "openai");
  assert.equal(prediction.modelVersionId, "model-v1");
  assert.equal(prediction.promptArtifactId, "nusa.ai.strategy_proposer");
  assert.equal(prediction.promptArtifactVersion, "1.0.0");
  assert.equal(prediction.rawProbability, 0.8);
  assert.equal(prediction.provenance, "VERIFIED_RUNTIME");

  const before = runtime.calibrationProfile();
  assert.ok(before);
  assert.equal(before.status, "INSUFFICIENT_DATA");
  assert.equal(before.sampleCount, 0);
  assert.equal(before.effectiveConfidence, 0);
  const beforeProjection = runtime.latestProjection();
  assert.equal(beforeProjection.rawProbability, 0.8);
  assert.equal(beforeProjection.calibrationStatus, "INSUFFICIENT_DATA");
  assert.equal(beforeProjection.confidence, 0);

  const resolved = createCalibrationOutcome({ predictionId: prediction.predictionId, outcomeDefinitionId: prediction.outcomeDefinitionId, outcomeDefinitionVersion: prediction.outcomeDefinitionVersion, outcome: true, resolvedAt: prediction.predictedAt + prediction.horizonMs, evidenceReferences: ["verified-outcome:e-1"], provenance: "VERIFIED_RUNTIME" });
  runtime.recordCalibrationOutcome(resolved);
  const after = runtime.calibrationProfile();
  assert.equal(after.status, "CALIBRATED");
  assert.equal(after.sampleCount, 1);
  assert.equal(after.calibratedProbability, 1);
  assert.equal(after.effectiveConfidence, 0.8);
  const afterProjection = runtime.latestProjection();
  assert.equal(afterProjection.calibrationStatus, "CALIBRATED");
  assert.equal(afterProjection.rawProbability, 0.8);
  assert.equal(afterProjection.calibrationSampleCount, 1);
  assert.equal(afterProjection.confidence, 0, "same-model multi-agent governance remains incomplete, so calibration cannot create trusted decision confidence");
  assert.equal(afterProjection.liveAuthority, "NONE");
  assert.equal(afterProjection.productionMutationAllowed, false);
});

test("runtime refuses synthetic-as-real outcomes and invalid calibration configuration", async () => {
  assert.throws(() => createCloudAiRuntime({ NUSA_AI_ENABLED: "true" }, provider, { calibration: { outcomeDefinitionId: "x", outcomeDefinitionVersion: "1", horizonMs: 0 } }), /positive safe integer/);
  const runtime = createCloudAiRuntime({ NUSA_AI_ENABLED: "true" }, provider, { now: () => 1_000, minimumCadenceMs: 0, calibration: { outcomeDefinitionId: "next-period-positive", outcomeDefinitionVersion: "1", horizonMs: 100 } });
  runtime.schedule({ orchestrationRunId: "runtime-2", decisionId: "decision-2", evaluatedAt: 10, evidence: [evidence], evidenceMaterializations: [materialization] });
  await waitForRuntime(runtime);
  const prediction = runtime.latestCalibrationPrediction();
  assert.ok(prediction);
  const synthetic = createCalibrationOutcome({ predictionId: prediction.predictionId, outcomeDefinitionId: prediction.outcomeDefinitionId, outcomeDefinitionVersion: prediction.outcomeDefinitionVersion, outcome: true, resolvedAt: prediction.predictedAt + prediction.horizonMs, evidenceReferences: ["fixture"], provenance: "SYNTHETIC_TEST" });
  assert.throws(() => runtime.recordCalibrationOutcome(synthetic), /provenance mismatch/);
  assert.equal(runtime.calibrationProfile().sampleCount, 0);
});
