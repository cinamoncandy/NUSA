const test = require("node:test");
const assert = require("node:assert/strict");
const { aiSha256 } = require("../dist/packages/contracts/src/aiInference.js");
const { TransportModelProvider } = require("../dist/apps/cloud/src/ai/modelProvider.js");
const { createCloudAiRuntime, AI_CALIBRATION_OUTCOME_DEFINITION_ID, attributionScope } = require("../dist/apps/cloud/src/ai/runtime.js");
const { buildCloudRuntimeAiEvidence } = require("../dist/apps/cloud/src/ai/cloudRuntimeEvidence.js");

const proposalSeed = { strategyVersionId: "attribution-wiring", decision: "candidate", rationaleClaims: ["grounded public market evidence"], assumptions: ["PAPER only"], uncertainty: "uncalibrated", rawProbability: 0.7 };

function grounded(price, at, lessons = []) {
  return buildCloudRuntimeAiEvidence({ code: "KRW-BTC", trade_price: price, trade_timestamp: at, signed_change_rate: 0.01, acc_trade_volume: 5 }, { mode: "PAPER", killSwitchActive: false, tradingAllowed: true, overallHealth: "HEALTHY", p0State: "CLOSED", observedAt: at }, lessons);
}

function input(price, at, id) {
  const bundle = grounded(price, at);
  return { orchestrationRunId: id, decisionId: `${id}:decision`, evaluatedAt: at, evidence: bundle.evidence, evidenceMaterializations: bundle.evidenceMaterializations, policyVersionIds: ["AI_ZERO_AUTHORITY_POLICY_V1"], certificationIds: [], controlPlaneStateId: "cloud:PAPER:ACTIVE:CLOSED", contextValidForMs: 120_000 };
}

// Run timestamps stay close to the current schedule-time clock (small offsets past it), so a
// prediction's predictedAt (the proposer run's completedAt) lands near the tick that created it --
// exactly like production, where the model completes shortly after the tick that scheduled it.
function requestCapturingProvider(observedRequests, clock) {
  let offset = 0;
  return new TransportModelProvider("attribution-fixture", "model-1", async (request) => {
    observedRequests.push(request);
    let payload;
    if (request.role === "EVIDENCE_PRODUCER") payload = { observations: [{ claim: "market state is grounded", claimType: "fact", evidenceReferences: [request.input.evidence[0].evidenceId], freshnessStatus: "fresh" }], missingEvidence: [], evidenceBundleHash: request.input.evidenceBundleHash };
    if (request.role === "STRATEGY_PROPOSER") payload = proposalSeed;
    if (request.role === "ADVERSARIAL_CRITIC") payload = { reviewedProposalHash: request.input.proposalHash, counterClaims: [], failedAssumptions: [], missingTests: [], alternativeExplanations: [], severity: "low" };
    if (request.role === "RISK_VERIFIER") payload = { result: "verified", hardDenies: [], warnings: [], missingRequirements: [], requiredEscalations: [], policyReferences: ["risk-policy-1"] };
    const output = { schemaVersion: 1, role: request.role, evidenceReferences: request.input.evidence.map((item) => item.evidenceId), payload };
    offset += 1; const startedAt = clock.value + offset;
    offset += 1; const completedAt = clock.value + offset;
    return { requestId: request.requestId, providerId: request.providerId, modelVersionId: request.modelVersionId, promptArtifactDigest: request.promptArtifactDigest, contextHash: request.contextHash, inputHash: request.inputHash, structuredOutput: output, outputHash: aiSha256(output), startedAt, completedAt };
  });
}

async function settle(runtime) {
  for (let attempt = 0; attempt < 50 && runtime.isInFlight(); attempt += 1) await new Promise((resolve) => setImmediate(resolve));
  assert.equal(runtime.isInFlight(), false);
}

test("resolving a prediction records a real attribution episode that later runs can see as a lesson", async () => {
  const clock = { value: 1_000 };
  const observedRequests = [];
  const provider = requestCapturingProvider(observedRequests, clock);
  const runtime = createCloudAiRuntime({ NUSA_AI_ENABLED: "true" }, provider, { now: () => clock.value, minimumCadenceMs: 0 });
  const scope = attributionScope({ outcomeDefinitionId: AI_CALIBRATION_OUTCOME_DEFINITION_ID, targetId: "KRW-BTC" });

  // No episode exists yet: an empty lesson list, so no learning-memory evidence item is added.
  assert.deepEqual(runtime.applicableLessons(scope, clock.value), []);
  const priorBundle = grounded(100, clock.value, runtime.applicableLessons(scope, clock.value));
  assert.equal(priorBundle.evidence.some((item) => item.sourceReference === "nusa-ai-outcome-attribution-memory"), false);

  // Tick 1: schedule and complete the prediction that will later resolve.
  assert.equal(runtime.schedule(input(100, clock.value, "attribution-predict")), true);
  await settle(runtime);
  assert.ok(runtime.latestCalibrationPrediction());

  // Tick 2: a later verified ticker, past the 5-minute horizon but inside the resolution grace
  // window, resolves the prediction synchronously inside schedule()'s resolvePending() call.
  clock.value += 5 * 60 * 1_000 + 1_000;
  runtime.schedule(input(105, clock.value, "attribution-resolve"));

  const lessons = runtime.applicableLessons(scope, clock.value);
  assert.equal(lessons.length, 1);
  assert.equal(lessons[0].scope, scope);
  assert.equal(lessons[0].advisoryOnly, true);
  assert.equal(lessons[0].liveAuthority, "NONE");
  assert.equal(lessons[0].productionMutationAllowed, false);

  // The recorded lesson now shows up as a real, digest-bound "derived-calculation" evidence item
  // in a fresh evidence bundle for the same market -- exactly what a later tick would build.
  const nextBundle = grounded(106, clock.value, lessons);
  const lessonEvidence = nextBundle.evidence.find((item) => item.sourceReference === "nusa-ai-outcome-attribution-memory");
  assert.ok(lessonEvidence);
  assert.equal(lessonEvidence.evidenceType, "derived-calculation");
  const materialization = nextBundle.evidenceMaterializations.find((item) => item.evidenceId === lessonEvidence.evidenceId);
  assert.ok(materialization);
  assert.equal(aiSha256(materialization.payload), materialization.contentDigest);
  assert.equal(materialization.payload.lessons.length, 1);
  assert.equal(materialization.payload.lessons[0].episodeId, lessons[0].episodeId);

  // And that bundle, run through the real orchestrator, actually reaches the model input.
  observedRequests.length = 0;
  clock.value += 1_000;
  const runtimeForNextCycle = createCloudAiRuntime({ NUSA_AI_ENABLED: "true" }, provider, { now: () => clock.value, minimumCadenceMs: 0 });
  const nextInput = { orchestrationRunId: "attribution-next", decisionId: "attribution-next:decision", evaluatedAt: clock.value, evidence: nextBundle.evidence, evidenceMaterializations: nextBundle.evidenceMaterializations, policyVersionIds: ["AI_ZERO_AUTHORITY_POLICY_V1"], certificationIds: [], controlPlaneStateId: "cloud:PAPER:ACTIVE:CLOSED", contextValidForMs: 120_000 };
  assert.equal(runtimeForNextCycle.schedule(nextInput), true);
  await settle(runtimeForNextCycle);
  const evidenceProducerRequest = observedRequests.find((request) => request.role === "EVIDENCE_PRODUCER");
  assert.ok(evidenceProducerRequest);
  assert.ok(evidenceProducerRequest.input.evidence.some((item) => item.evidenceType === "derived-calculation"));
});

test("a decision cycle with no resolved history never adds a hollow lesson evidence item", () => {
  const bundle = grounded(100, 1_000, []);
  assert.equal(bundle.evidence.length, 2);
  assert.equal(bundle.evidence.some((item) => item.evidenceType === "derived-calculation"), false);
});
