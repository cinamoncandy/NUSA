const test = require("node:test");
const assert = require("node:assert/strict");
const { aiSha256 } = require("../dist/packages/contracts/src/aiInference.js");
const { TransportModelProvider } = require("../dist/apps/cloud/src/ai/modelProvider.js");
const { createCloudAiRuntime, AI_CALIBRATION_OUTCOME_DEFINITION_ID, attributionScope } = require("../dist/apps/cloud/src/ai/runtime.js");
const { buildCloudRuntimeAiEvidence } = require("../dist/apps/cloud/src/ai/cloudRuntimeEvidence.js");

// STRATEGY_PROPOSER reports rawProbability=0.7 (predicts price will rise) when it sees a price
// >= 100, else 0.3 -- a 0.4 delta, comfortably past AI_SCENARIO_POLICY's 0.2
// maxProbabilityDeltaForRobust, so the -2% price-shock scenario always classifies SENSITIVE.
function sensitiveProvider(runClock) {
  return new TransportModelProvider("correlation-fixture", "model-1", async (request) => {
    let payload;
    if (request.role === "EVIDENCE_PRODUCER") payload = { observations: [{ claim: "market state is grounded", claimType: "fact", evidenceReferences: [request.input.evidence[0].evidenceId], freshnessStatus: "fresh" }], missingEvidence: [], evidenceBundleHash: request.input.evidenceBundleHash };
    else if (request.role === "STRATEGY_PROPOSER") { const price = request.input.evidence[0].payload.price; payload = { strategyVersionId: "correlation-test", decision: "candidate", rationaleClaims: ["price-sensitive claim"], assumptions: [], uncertainty: "low", rawProbability: price >= 100 ? 0.7 : 0.3 }; }
    else if (request.role === "ADVERSARIAL_CRITIC") payload = { reviewedProposalHash: request.input.proposalHash, counterClaims: [], failedAssumptions: [], missingTests: [], alternativeExplanations: [], severity: "low" };
    else payload = { result: "verified", hardDenies: [], warnings: [], missingRequirements: [], requiredEscalations: [], policyReferences: ["risk-policy-1"] };
    const output = { schemaVersion: 1, role: request.role, evidenceReferences: [request.input.evidence[0].evidenceId], payload };
    const startedAt = runClock.value; runClock.value += 1;
    const completedAt = runClock.value; runClock.value += 1;
    // AI_SCENARIO_POLICY.inferenceBudget.requireUsageAccounting is true, matching production --
    // a response with no usage would fail closed with USAGE_UNVERIFIED before ever reaching the
    // strategy-shift assertions this test actually cares about.
    const usage = { inputTokens: 10, outputTokens: 10, totalTokens: 20 };
    return { requestId: request.requestId, providerId: request.providerId, modelVersionId: request.modelVersionId, promptArtifactDigest: request.promptArtifactDigest, contextHash: request.contextHash, inputHash: request.inputHash, structuredOutput: output, outputHash: aiSha256(output), startedAt, completedAt, usage };
  });
}

async function settle(runtime) {
  for (let attempt = 0; attempt < 100 && (runtime.isInFlight() || runtime.isScenarioEvaluationInFlight()); attempt += 1) await new Promise((resolve) => setImmediate(resolve));
  assert.equal(runtime.isInFlight(), false);
  assert.equal(runtime.isScenarioEvaluationInFlight(), false);
}

function ticker(price, at) {
  return { code: "KRW-BTC", trade_price: price, trade_timestamp: at, signed_change_rate: 0.01, acc_trade_volume: 5 };
}
const safety = (at) => ({ mode: "PAPER", killSwitchActive: false, tradingAllowed: true, overallHealth: "HEALTHY", p0State: "CLOSED", observedAt: at });

test("a SENSITIVE scenario correlated to the predicting tick becomes a real attribution lesson (PARTIALLY_IDENTIFIED / SCENARIO_SENSITIVITY_MISS)", async () => {
  const clock = { value: 1_000 };
  const runClock = { value: 1_000 };
  const provider = sensitiveProvider(runClock);
  const runtime = createCloudAiRuntime({ NUSA_AI_ENABLED: "true", NUSA_AI_SCENARIO_ENABLED: "true" }, provider, { now: () => clock.value, minimumCadenceMs: 0 });
  const scope = attributionScope({ outcomeDefinitionId: AI_CALIBRATION_OUTCOME_DEFINITION_ID, targetId: "KRW-BTC" });

  // Tick 1: predicts price will rise (rawProbability 0.7). The concurrent scenario run classifies
  // SENSITIVE for this exact tick.
  const bundle1 = buildCloudRuntimeAiEvidence(ticker(100, clock.value), safety(clock.value));
  const input1 = { orchestrationRunId: "correlation-predict", decisionId: "correlation-predict:decision", evaluatedAt: clock.value, evidence: bundle1.evidence, evidenceMaterializations: bundle1.evidenceMaterializations, policyVersionIds: ["AI_ZERO_AUTHORITY_POLICY_V1"], certificationIds: [], controlPlaneStateId: "cloud:PAPER:ACTIVE:CLOSED", contextValidForMs: 120_000 };
  assert.equal(runtime.schedule(input1), true);
  await settle(runtime);
  assert.ok(runtime.latestCalibrationPrediction());
  const scenarioAtPrediction = runtime.latestScenarioEvaluation(clock.value);
  assert.ok(scenarioAtPrediction);
  assert.equal(scenarioAtPrediction.robustnessState, "SENSITIVE");

  // Tick 2: past the 5-minute horizon, price actually fell -- the "up" prediction was wrong.
  // resolvePending() runs synchronously at the top of schedule(), so the episode is recorded
  // before this call returns.
  clock.value += 5 * 60 * 1_000 + 1_000;
  const bundle2 = buildCloudRuntimeAiEvidence(ticker(95, clock.value), safety(clock.value));
  const input2 = { orchestrationRunId: "correlation-resolve", decisionId: "correlation-resolve:decision", evaluatedAt: clock.value, evidence: bundle2.evidence, evidenceMaterializations: bundle2.evidenceMaterializations, policyVersionIds: ["AI_ZERO_AUTHORITY_POLICY_V1"], certificationIds: [], controlPlaneStateId: "cloud:PAPER:ACTIVE:CLOSED", contextValidForMs: 120_000 };
  runtime.schedule(input2);

  const lessons = runtime.applicableLessons(scope, clock.value);
  assert.equal(lessons.length, 1);
  assert.equal(lessons[0].strength, "PARTIALLY_IDENTIFIED");
  assert.equal(lessons[0].primaryCause, "SCENARIO_SENSITIVITY_MISS");
  assert.equal(lessons[0].advisoryOnly, true);
  assert.equal(lessons[0].liveAuthority, "NONE");
  assert.equal(lessons[0].productionMutationAllowed, false);

  await settle(runtime);
});

test("a scenario result from a different tick is never attributed to this prediction (no false correlation)", async () => {
  const clock = { value: 2_000 };
  const runClock = { value: 2_000 };
  const provider = sensitiveProvider(runClock);
  // Scenario evaluation disabled here -- no scenario ever runs, so nothing should ever be
  // correlated regardless of what an unrelated runtime instance's latest scenario result was.
  const runtime = createCloudAiRuntime({ NUSA_AI_ENABLED: "true" }, provider, { now: () => clock.value, minimumCadenceMs: 0 });
  const scope = attributionScope({ outcomeDefinitionId: AI_CALIBRATION_OUTCOME_DEFINITION_ID, targetId: "KRW-BTC" });

  const bundle1 = buildCloudRuntimeAiEvidence(ticker(100, clock.value), safety(clock.value));
  const input1 = { orchestrationRunId: "no-scenario-predict", decisionId: "no-scenario-predict:decision", evaluatedAt: clock.value, evidence: bundle1.evidence, evidenceMaterializations: bundle1.evidenceMaterializations, policyVersionIds: ["AI_ZERO_AUTHORITY_POLICY_V1"], certificationIds: [], controlPlaneStateId: "cloud:PAPER:ACTIVE:CLOSED", contextValidForMs: 120_000 };
  assert.equal(runtime.schedule(input1), true);
  await settle(runtime);
  assert.equal(runtime.latestScenarioEvaluation(clock.value), null);

  clock.value += 5 * 60 * 1_000 + 1_000;
  const bundle2 = buildCloudRuntimeAiEvidence(ticker(95, clock.value), safety(clock.value));
  const input2 = { orchestrationRunId: "no-scenario-resolve", decisionId: "no-scenario-resolve:decision", evaluatedAt: clock.value, evidence: bundle2.evidence, evidenceMaterializations: bundle2.evidenceMaterializations, policyVersionIds: ["AI_ZERO_AUTHORITY_POLICY_V1"], certificationIds: [], controlPlaneStateId: "cloud:PAPER:ACTIVE:CLOSED", contextValidForMs: 120_000 };
  runtime.schedule(input2);

  const lessons = runtime.applicableLessons(scope, clock.value);
  assert.equal(lessons.length, 1);
  // No scenario ever ran, so the episode must not fabricate a scenario-based cause.
  assert.notEqual(lessons[0].primaryCause, "SCENARIO_SENSITIVITY_MISS");
  assert.equal(lessons[0].strength, "UNRESOLVED");
  assert.equal(lessons[0].primaryCause, null);

  await settle(runtime);
});
