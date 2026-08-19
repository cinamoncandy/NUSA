const test = require("node:test");
const assert = require("node:assert/strict");
const { aiSha256 } = require("../dist/packages/contracts/src/aiInference.js");
const { TransportModelProvider } = require("../dist/apps/cloud/src/ai/modelProvider.js");
const { buildCloudRuntimeAiEvidence } = require("../dist/apps/cloud/src/ai/cloudRuntimeEvidence.js");
const {
  createCloudAiRuntime,
  AI_CALIBRATION_OUTCOME_DEFINITION_ID,
  AI_CALIBRATION_OUTCOME_DEFINITION_VERSION,
  AI_CALIBRATION_HORIZON_MS,
  AI_CALIBRATION_RESOLUTION_GRACE_MS
} = require("../dist/apps/cloud/src/ai/runtime.js");

const firstObservedAt = 1_700_000_000_000;
const secondObservedAt = firstObservedAt + AI_CALIBRATION_HORIZON_MS + 10;
let modelCompletedAt = firstObservedAt + 2;

const evidenceFor = (price, observedAt, market = "KRW-BTC") => buildCloudRuntimeAiEvidence({
  code: market,
  trade_price: price,
  trade_timestamp: observedAt,
  signed_change_rate: 0.01,
  acc_trade_volume: 100
}, {
  mode: "PAPER",
  killSwitchActive: false,
  tradingAllowed: true,
  overallHealth: "HEALTHY",
  p0State: "CLOSED",
  observedAt
});

const provider = new TransportModelProvider("openai", "model-v1", async (request) => {
  const marketEvidenceId = request.input.evidence[0].evidenceId;
  let payload;
  if (request.role === "EVIDENCE_PRODUCER") payload = { observations: [{ claim: "verified market state", claimType: "fact", evidenceReferences: [marketEvidenceId], freshnessStatus: "fresh" }], missingEvidence: [], evidenceBundleHash: request.input.evidenceBundleHash };
  if (request.role === "STRATEGY_PROPOSER") payload = { strategyVersionId: "strategy-preview", decision: "candidate", rationaleClaims: ["candidate"], assumptions: ["paper only"], uncertainty: "medium", rawProbability: 0.8, expectedEffect: "research", costSensitivity: "unknown", capacitySensitivity: "unknown" };
  if (request.role === "ADVERSARIAL_CRITIC") payload = { reviewedProposalHash: request.input.proposalHash, counterClaims: [], failedAssumptions: [], missingTests: [], alternativeExplanations: [], severity: "low" };
  if (request.role === "RISK_VERIFIER") payload = { result: "verified", hardDenies: [], warnings: [], missingRequirements: [], requiredEscalations: [], policyReferences: ["risk-policy"] };
  const output = { schemaVersion: 1, role: request.role, evidenceReferences: [marketEvidenceId], payload };
  return { requestId: request.requestId, providerId: request.providerId, modelVersionId: request.modelVersionId, promptArtifactDigest: request.promptArtifactDigest, contextHash: request.contextHash, inputHash: request.inputHash, structuredOutput: output, outputHash: aiSha256(output), startedAt: modelCompletedAt - 1, completedAt: modelCompletedAt };
});

const waitForRuntime = async (runtime) => {
  for (let attempt = 0; attempt < 50 && runtime.isInFlight(); attempt += 1) await new Promise((resolve) => setImmediate(resolve));
  assert.equal(runtime.isInFlight(), false);
};

const orchestrationInput = (id, observedAt, bundle) => ({
  orchestrationRunId: `runtime-${id}`,
  decisionId: `decision-${id}`,
  evaluatedAt: observedAt,
  evidence: bundle.evidence,
  evidenceMaterializations: bundle.evidenceMaterializations,
  policyVersionIds: ["AI_ZERO_AUTHORITY_POLICY_V1"],
  certificationIds: [],
  controlPlaneStateId: "test-paper-safe",
  contextValidForMs: 120_000
});

const runtimeOptions = (now) => ({
  now,
  minimumCadenceMs: 0,
  maximumResultAgeMs: 10_000_000,
  calibration: {
    outcomeDefinitionId: AI_CALIBRATION_OUTCOME_DEFINITION_ID,
    outcomeDefinitionVersion: AI_CALIBRATION_OUTCOME_DEFINITION_VERSION,
    horizonMs: AI_CALIBRATION_HORIZON_MS,
    policy: { minimumSamples: 1, minimumBucketSamples: 1, maximumExpectedCalibrationError: 1, maximumBrierScore: 1 }
  }
});

test("cloud AI runtime records a verified prediction and resolves it only from a later verified Upbit ticker", async () => {
  let runtimeNow = firstObservedAt + 100;
  modelCompletedAt = firstObservedAt + 2;
  const runtime = createCloudAiRuntime({ NUSA_AI_ENABLED: "true" }, provider, runtimeOptions(() => runtimeNow));
  const first = evidenceFor(100, firstObservedAt);
  assert.equal(runtime.schedule(orchestrationInput("first", firstObservedAt, first)), true);
  await waitForRuntime(runtime);

  const prediction = runtime.latestCalibrationPrediction();
  assert.ok(prediction);
  assert.equal(prediction.providerId, "openai");
  assert.equal(prediction.modelVersionId, "model-v1");
  assert.equal(prediction.promptArtifactId, "nusa.ai.strategy_proposer");
  assert.equal(prediction.promptArtifactVersion, "1.0.0");
  assert.equal(prediction.targetId, "KRW-BTC");
  assert.equal(prediction.anchorValue, 100);
  assert.equal(prediction.anchorObservedAt, firstObservedAt);
  assert.equal(prediction.anchorEvidenceReference, first.evidence[0].evidenceId);
  assert.equal(prediction.rawProbability, 0.8);
  assert.equal(prediction.provenance, "VERIFIED_RUNTIME");

  const before = runtime.calibrationProfile();
  assert.ok(before);
  assert.equal(before.status, "INSUFFICIENT_DATA");
  assert.equal(before.sampleCount, 0);
  assert.equal(before.effectiveConfidence, 0);

  runtimeNow = secondObservedAt + 100;
  modelCompletedAt = secondObservedAt + 2;
  const second = evidenceFor(110, secondObservedAt);
  assert.equal(runtime.schedule(orchestrationInput("second", secondObservedAt, second)), true);

  const resolvedProfile = runtime.calibrationProfile();
  assert.equal(resolvedProfile.status, "CALIBRATED");
  assert.equal(resolvedProfile.sampleCount, 1);
  assert.equal(resolvedProfile.calibratedProbability, 1);
  // One resolved prediction is one coin flip. The bucket rate is 1 but effectiveConfidence reports
  // the Wilson lower bound for a single sample rather than the raw 0.8 ceiling.
  assert.ok(Math.abs(resolvedProfile.effectiveConfidence - 0.2065432) < 1e-6, `expected single-sample confidence floor, got ${resolvedProfile.effectiveConfidence}`);
  await waitForRuntime(runtime);

  const projection = runtime.latestProjection(runtimeNow);
  assert.ok(projection);
  assert.equal(projection.calibrationStatus, "CALIBRATED");
  assert.equal(projection.rawProbability, 0.8);
  assert.equal(projection.calibrationSampleCount, 1);
  assert.equal(projection.confidence, 0, "same-model multi-agent governance remains incomplete, so calibration cannot create trusted decision confidence");
  assert.equal(projection.liveAuthority, "NONE");
  assert.equal(projection.productionMutationAllowed, false);
  assert.equal(runtime.recordCalibrationOutcome, undefined, "manual outcome injection must not exist on the runtime surface");
});

test("pre-horizon ticker cannot resolve a pending prediction", async () => {
  let runtimeNow = firstObservedAt + 100;
  modelCompletedAt = firstObservedAt + 2;
  const runtime = createCloudAiRuntime({ NUSA_AI_ENABLED: "true" }, provider, runtimeOptions(() => runtimeNow));
  runtime.schedule(orchestrationInput("pre-first", firstObservedAt, evidenceFor(100, firstObservedAt)));
  await waitForRuntime(runtime);

  const earlyObservedAt = firstObservedAt + AI_CALIBRATION_HORIZON_MS - 1_000;
  runtimeNow = earlyObservedAt + 100;
  modelCompletedAt = earlyObservedAt + 2;
  runtime.schedule(orchestrationInput("pre-early", earlyObservedAt, evidenceFor(150, earlyObservedAt)));
  assert.equal(runtime.calibrationProfile().sampleCount, 0);
  await waitForRuntime(runtime);
});

test("a different market cannot resolve or expire another market prediction", async () => {
  let runtimeNow = firstObservedAt + 100;
  modelCompletedAt = firstObservedAt + 2;
  const runtime = createCloudAiRuntime({ NUSA_AI_ENABLED: "true" }, provider, runtimeOptions(() => runtimeNow));
  runtime.schedule(orchestrationInput("market-first", firstObservedAt, evidenceFor(100, firstObservedAt, "KRW-BTC")));
  await waitForRuntime(runtime);

  const wrongMarketAt = firstObservedAt + AI_CALIBRATION_HORIZON_MS + AI_CALIBRATION_RESOLUTION_GRACE_MS + 10;
  runtimeNow = wrongMarketAt + 100;
  modelCompletedAt = wrongMarketAt + 2;
  runtime.schedule(orchestrationInput("market-eth", wrongMarketAt, evidenceFor(999, wrongMarketAt, "KRW-ETH")));
  assert.equal(runtime.calibrationProfile().sampleCount, 0);
  await waitForRuntime(runtime);

  const btcObservedAt = firstObservedAt + 2 + AI_CALIBRATION_HORIZON_MS + 10;
  runtimeNow = wrongMarketAt + 200;
  modelCompletedAt = runtimeNow + 2;
  runtime.schedule(orchestrationInput("market-btc", btcObservedAt, evidenceFor(110, btcObservedAt, "KRW-BTC")));
  assert.equal(runtime.calibrationProfile().sampleCount, 1, "wrong-market data must not remove the pending BTC calibration window");
  await waitForRuntime(runtime);
});

test("a late ticker outside the audited resolution window cannot be mislabeled as the five-minute outcome", async () => {
  let runtimeNow = firstObservedAt + 100;
  modelCompletedAt = firstObservedAt + 2;
  const runtime = createCloudAiRuntime({ NUSA_AI_ENABLED: "true" }, provider, runtimeOptions(() => runtimeNow));
  const first = evidenceFor(100, firstObservedAt);
  runtime.schedule(orchestrationInput("late-first", firstObservedAt, first));
  await waitForRuntime(runtime);
  assert.equal(runtime.calibrationProfile().sampleCount, 0);

  const lateObservedAt = firstObservedAt + 2 + AI_CALIBRATION_HORIZON_MS + AI_CALIBRATION_RESOLUTION_GRACE_MS + 1;
  runtimeNow = lateObservedAt + 100;
  modelCompletedAt = lateObservedAt + 2;
  const late = evidenceFor(150, lateObservedAt);
  runtime.schedule(orchestrationInput("late-second", lateObservedAt, late));
  assert.equal(runtime.calibrationProfile().sampleCount, 0, "late verified data must expire the missed window without calibration credit");
  await waitForRuntime(runtime);
  assert.equal(runtime.calibrationProfile().sampleCount, 0);
});

test("unverified or tampered market evidence cannot create calibration credit", async () => {
  let runtimeNow = firstObservedAt + 100;
  modelCompletedAt = firstObservedAt + 2;
  const runtime = createCloudAiRuntime({ NUSA_AI_ENABLED: "true" }, provider, { now: () => runtimeNow, minimumCadenceMs: 0 });
  const verified = evidenceFor(100, firstObservedAt);
  const untrustedEvidence = [{ ...verified.evidence[0], sourceReference: "unverified-feed" }, verified.evidence[1]];
  assert.equal(runtime.schedule(orchestrationInput("untrusted", firstObservedAt, { evidence: untrustedEvidence, evidenceMaterializations: verified.evidenceMaterializations })), true);
  await waitForRuntime(runtime);
  assert.equal(runtime.latestCalibrationPrediction(), null);
  assert.equal(runtime.calibrationProfile(), null);

  runtimeNow = secondObservedAt + 100;
  modelCompletedAt = secondObservedAt + 2;
  const second = evidenceFor(110, secondObservedAt);
  const tamperedMaterializations = [{ ...second.evidenceMaterializations[0], payload: { ...second.evidenceMaterializations[0].payload, price: 999 } }, second.evidenceMaterializations[1]];
  runtime.schedule(orchestrationInput("tampered", secondObservedAt, { evidence: second.evidence, evidenceMaterializations: tamperedMaterializations }));
  await waitForRuntime(runtime);
  assert.equal(runtime.latestCalibrationPrediction(), null);
  assert.equal(runtime.calibrationProfile(), null);
});

test("custom outcome definitions remain unresolved unless they match the audited automatic resolver", async () => {
  let runtimeNow = firstObservedAt + 100;
  modelCompletedAt = firstObservedAt + 2;
  const runtime = createCloudAiRuntime({ NUSA_AI_ENABLED: "true" }, provider, {
    now: () => runtimeNow,
    minimumCadenceMs: 0,
    calibration: { outcomeDefinitionId: "custom-outcome", outcomeDefinitionVersion: "1", horizonMs: 100, policy: { minimumSamples: 1, minimumBucketSamples: 1 } }
  });
  const first = evidenceFor(100, firstObservedAt);
  runtime.schedule(orchestrationInput("custom-first", firstObservedAt, first));
  await waitForRuntime(runtime);
  assert.ok(runtime.latestCalibrationPrediction());
  runtimeNow = secondObservedAt + 100;
  modelCompletedAt = secondObservedAt + 2;
  const second = evidenceFor(110, secondObservedAt);
  runtime.schedule(orchestrationInput("custom-second", secondObservedAt, second));
  assert.equal(runtime.calibrationProfile().sampleCount, 0);
});
