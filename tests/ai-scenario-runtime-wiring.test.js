const test = require("node:test");
const assert = require("node:assert/strict");
const { aiSha256 } = require("../dist/packages/contracts/src/aiInference.js");
const { TransportModelProvider } = require("../dist/apps/cloud/src/ai/modelProvider.js");
const { InferenceResourceLedger } = require("../dist/apps/cloud/src/ai/inferenceResourceLedger.js");
const { CloudAiScenarioRunner, CLOUD_AI_SCENARIO_PRICE_SHOCK_DIMENSION } = require("../dist/apps/cloud/src/ai/scenarioOrchestratorRunner.js");
const { ScenarioCounterfactualEvaluator } = require("../dist/apps/cloud/src/ai/scenarioCounterfactualEvaluator.js");
const { createCloudAiRuntime } = require("../dist/apps/cloud/src/ai/runtime.js");
const { buildCloudRuntimeAiEvidence } = require("../dist/apps/cloud/src/ai/cloudRuntimeEvidence.js");

const budget = Object.freeze({ schemaVersion: 1, policyId: "TEST_SCENARIO_BUDGET", policyVersion: "1", maxModelCalls: 8, maxTotalAttempts: 8, maxCumulativeOutputTokens: 8192, maxInputBytes: 1024 * 1024, maxWallClockMs: 90_000, requireUsageAccounting: false });

// Reports rawProbability=0.8 when the market price it actually receives is >= 100, 0.2 otherwise --
// this is how the tests prove the price the runner constructs really carries the shock through.
// The scenario runner only ever sends STRATEGY_PROPOSER requests, but createCloudAiRuntime's
// primary orchestrator sends all 4 roles, so this fixture must answer every role validly.
function priceSensitiveProvider() {
  return new TransportModelProvider("scenario-fixture", "model-1", async (request) => {
    let payload;
    if (request.role === "EVIDENCE_PRODUCER") payload = { observations: [{ claim: "market state is grounded", claimType: "fact", evidenceReferences: [request.input.evidence[0].evidenceId], freshnessStatus: "fresh" }], missingEvidence: [], evidenceBundleHash: request.input.evidenceBundleHash };
    else if (request.role === "STRATEGY_PROPOSER") { const price = request.input.evidence[0].payload.price; payload = { strategyVersionId: "scenario-test", decision: "candidate", rationaleClaims: ["price-sensitive claim"], assumptions: [], uncertainty: "low", rawProbability: price >= 100 ? 0.8 : 0.2 }; }
    else if (request.role === "ADVERSARIAL_CRITIC") payload = { reviewedProposalHash: request.input.proposalHash, counterClaims: [], failedAssumptions: [], missingTests: [], alternativeExplanations: [], severity: "low" };
    else payload = { result: "verified", hardDenies: [], warnings: [], missingRequirements: [], requiredEscalations: [], policyReferences: ["risk-policy-1"] };
    const output = { schemaVersion: 1, role: request.role, evidenceReferences: [request.input.evidence[0].evidenceId], payload };
    return { requestId: request.requestId, providerId: request.providerId, modelVersionId: request.modelVersionId, promptArtifactDigest: request.promptArtifactDigest, contextHash: request.contextHash, inputHash: request.inputHash, structuredOutput: output, outputHash: aiSha256(output), startedAt: 1, completedAt: 2 };
  });
}

test("CloudAiScenarioRunner applies the price shock and shares the caller's resource ledger", async () => {
  const runner = new CloudAiScenarioRunner(priceSensitiveProvider(), { now: () => 1_000 });
  const resources = new InferenceResourceLedger(budget, 1_000);
  const baselineMaterialization = { scenarioId: "baseline", kind: "BASELINE", baselineIdentity: "b".repeat(64), scenarioIdentity: "c".repeat(64), derivedInputs: Object.freeze({ "market.market": "KRW-BTC", "market.price": 100 }), interventions: Object.freeze([]), provenance: "OBSERVED_BASELINE" };
  const baselineOutput = await runner.runScenario(baselineMaterialization, resources);
  assert.equal(baselineOutput.projection.rawProbability, 0.8);

  const shockedMaterialization = { ...baselineMaterialization, scenarioId: "shock", scenarioIdentity: "d".repeat(64), kind: "HYPOTHETICAL", derivedInputs: Object.freeze({ "market.market": "KRW-BTC", "market.price": 100, [CLOUD_AI_SCENARIO_PRICE_SHOCK_DIMENSION]: -0.5 }), provenance: "HYPOTHETICAL" };
  const shockedOutput = await runner.runScenario(shockedMaterialization, resources);
  assert.equal(shockedOutput.projection.rawProbability, 0.2);

  // Both calls spent from the single ledger passed in -- never a private one of the runner's own.
  const snapshot = resources.snapshot(1_000);
  assert.equal(snapshot.modelCalls, 2);
  assert.equal(snapshot.health, "HEALTHY");
});

test("ScenarioCounterfactualEvaluator classifies the price-shock scenario as SENSITIVE through the real runner", async () => {
  const runner = new CloudAiScenarioRunner(priceSensitiveProvider(), { now: () => 2_000 });
  const policy = Object.freeze({ schemaVersion: 1, policyId: "TEST", policyVersion: "1", allowedDimensions: Object.freeze([CLOUD_AI_SCENARIO_PRICE_SHOCK_DIMENSION]), maxScenarioCount: 2, maxProbabilityDeltaForRobust: 0.1, inferenceBudget: budget });
  const evaluator = new ScenarioCounterfactualEvaluator(policy, runner, { now: () => 2_000 });
  const payload = Object.freeze({ market: "KRW-BTC", price: 100, source: "UPBIT_PUBLIC_TICKER" });
  const digest = aiSha256(payload);
  const baseline = { decisionId: "decision-1", evaluatedAt: 2_000, evidence: [Object.freeze({ evidenceId: "e-1", evidenceType: "market-data", sourceReference: "upbit-public-ticker", observedAt: 2_000, validUntil: 3_000, quality: "verified", contentDigest: digest, lineageReferences: [] })], evidenceMaterializations: [Object.freeze({ evidenceId: "e-1", contentDigest: digest, payload })], derivedInputs: Object.freeze({ "market.market": "KRW-BTC", "market.price": 100 }) };
  const definitions = [
    Object.freeze({ scenarioId: "baseline", kind: "BASELINE", interventions: Object.freeze([]) }),
    Object.freeze({ scenarioId: "shock", kind: "HYPOTHETICAL", interventions: Object.freeze([Object.freeze({ dimension: CLOUD_AI_SCENARIO_PRICE_SHOCK_DIMENSION, value: -0.5, horizonMs: 300_000 })]) })
  ];
  const result = await evaluator.run("experiment-1", baseline, definitions);
  assert.equal(result.robustnessState, "SENSITIVE");
  assert.equal(result.trustDisposition, "REDUCE");
  assert.equal(result.calibrationCreditAllowed, false);
  assert.equal(result.learningCreditAllowed, false);
  assert.equal(result.liveAuthority, "NONE");
});

test("createCloudAiRuntime opt-in scenario evaluation is exposed read-only after a completed cycle", async () => {
  const clock = { value: 5_000 };
  const provider = priceSensitiveProvider();
  const runtime = createCloudAiRuntime({ NUSA_AI_ENABLED: "true", NUSA_AI_SCENARIO_ENABLED: "true" }, provider, { now: () => clock.value, minimumCadenceMs: 0 });
  const bundle = buildCloudRuntimeAiEvidence({ code: "KRW-BTC", trade_price: 100, trade_timestamp: clock.value, signed_change_rate: 0.01, acc_trade_volume: 5 }, { mode: "PAPER", killSwitchActive: false, tradingAllowed: true, overallHealth: "HEALTHY", p0State: "CLOSED", observedAt: clock.value });
  const input = { orchestrationRunId: "scenario-runtime-1", decisionId: "scenario-runtime-1:decision", evaluatedAt: clock.value, evidence: bundle.evidence, evidenceMaterializations: bundle.evidenceMaterializations, policyVersionIds: ["AI_ZERO_AUTHORITY_POLICY_V1"], certificationIds: [], controlPlaneStateId: "cloud:PAPER:ACTIVE:CLOSED", contextValidForMs: 120_000 };
  assert.equal(runtime.schedule(input), true);
  for (let attempt = 0; attempt < 50 && (runtime.isInFlight() || runtime.isScenarioEvaluationInFlight()); attempt += 1) await new Promise((resolve) => setImmediate(resolve));
  assert.equal(runtime.isInFlight(), false);
  assert.equal(runtime.isScenarioEvaluationInFlight(), false);

  const scenario = runtime.latestScenarioEvaluation(clock.value);
  assert.ok(scenario);
  assert.equal(scenario.liveAuthority, "NONE");
  assert.equal(scenario.productionMutationAllowed, false);
  assert.equal(scenario.calibrationCreditAllowed, false);

  const projection = runtime.latestProjection(clock.value);
  assert.ok(projection);
  assert.equal(projection.scenarioRobustnessState, scenario.robustnessState);
  assert.equal(projection.liveAuthority, "NONE");
  assert.equal(projection.productionMutationAllowed, false);
});

test("scenario evaluation stays disabled by default (no env flag, no injected evaluator)", async () => {
  const clock = { value: 6_000 };
  const runtime = createCloudAiRuntime({ NUSA_AI_ENABLED: "true" }, priceSensitiveProvider(), { now: () => clock.value, minimumCadenceMs: 0 });
  const bundle = buildCloudRuntimeAiEvidence({ code: "KRW-BTC", trade_price: 100, trade_timestamp: clock.value, signed_change_rate: 0.01, acc_trade_volume: 5 }, { mode: "PAPER", killSwitchActive: false, tradingAllowed: true, overallHealth: "HEALTHY", p0State: "CLOSED", observedAt: clock.value });
  const input = { orchestrationRunId: "scenario-disabled-1", decisionId: "scenario-disabled-1:decision", evaluatedAt: clock.value, evidence: bundle.evidence, evidenceMaterializations: bundle.evidenceMaterializations, policyVersionIds: ["AI_ZERO_AUTHORITY_POLICY_V1"], certificationIds: [], controlPlaneStateId: "cloud:PAPER:ACTIVE:CLOSED", contextValidForMs: 120_000 };
  assert.equal(runtime.schedule(input), true);
  for (let attempt = 0; attempt < 50 && runtime.isInFlight(); attempt += 1) await new Promise((resolve) => setImmediate(resolve));
  assert.equal(runtime.latestScenarioEvaluation(clock.value), null);
  assert.equal(runtime.latestProjection(clock.value)?.scenarioRobustnessState, "NOT_EVALUATED");
});
