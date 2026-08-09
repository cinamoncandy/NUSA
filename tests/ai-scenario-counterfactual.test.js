const test = require("node:test");
const assert = require("node:assert/strict");
const { aiSha256 } = require("../dist/packages/contracts/src/aiInference.js");
const { ScenarioCounterfactualEvaluator } = require("../dist/apps/cloud/src/ai/scenarioCounterfactualEvaluator.js");

const payload = Object.freeze({ market: "KRW-BTC", price: 100, source: "UPBIT_PUBLIC_TICKER" });
const digest = aiSha256(payload);
const baseline = (overrides = {}) => ({
  decisionId: "decision-1",
  evaluatedAt: 1000,
  evidence: [Object.freeze({ evidenceId: "e-1", evidenceType: "market-data", sourceReference: "upbit:ticker", observedAt: 900, validUntil: 2000, quality: "verified", contentDigest: digest, lineageReferences: [] })],
  evidenceMaterializations: [Object.freeze({ evidenceId: "e-1", contentDigest: digest, payload })],
  derivedInputs: Object.freeze({ priceShockPct: 0, volatilityShockPct: 0 }),
  ...overrides
});

const budget = (overrides = {}) => Object.freeze({
  schemaVersion: 1,
  policyId: "TEST_SCENARIO_BUDGET",
  policyVersion: "1",
  maxModelCalls: 8,
  maxTotalAttempts: 8,
  maxCumulativeOutputTokens: 8192,
  maxInputBytes: 1024 * 1024,
  maxWallClockMs: 90000,
  requireUsageAccounting: false,
  ...overrides
});

const policy = (overrides = {}) => Object.freeze({
  schemaVersion: 1,
  policyId: "TEST_SCENARIO_POLICY",
  policyVersion: "1",
  allowedDimensions: Object.freeze(["priceShockPct", "volatilityShockPct"]),
  maxScenarioCount: 4,
  maxProbabilityDeltaForRobust: 0.1,
  inferenceBudget: budget(),
  ...overrides
});

const definitions = () => [
  Object.freeze({ scenarioId: "baseline", kind: "BASELINE", interventions: Object.freeze([]) }),
  Object.freeze({ scenarioId: "down-10", kind: "HYPOTHETICAL", interventions: Object.freeze([Object.freeze({ dimension: "priceShockPct", value: -10, horizonMs: 3600000 })]) })
];

const projection = (overrides = {}) => Object.freeze({
  decision: "candidate",
  rawProbability: 0.7,
  uncertainty: "medium",
  assumptions: Object.freeze(["paper-only evaluation"]),
  rationaleClaims: Object.freeze(["verified market evidence"]),
  evidenceReferences: Object.freeze(["e-1"]),
  ...overrides
});

function harness(run) {
  const calls = [];
  const runner = {
    runScenario: async (scenario, resources) => {
      calls.push(scenario);
      if (!resources.reserveCall(`scenario:${scenario.scenarioIdentity}`, 1000)) throw new Error("resource blocked");
      return run(scenario);
    }
  };
  return { evaluator: new ScenarioCounterfactualEvaluator(policy(), runner, { now: () => 1000 }), calls };
}

test("material counterfactual change is detected as sensitive without authority or learning uplift", async () => {
  const h = harness((scenario) => ({ projection: scenario.kind === "BASELINE" ? projection() : projection({ decision: "no_action", rawProbability: 0.4, uncertainty: "high" }) }));
  const result = await h.evaluator.run("scenario-sensitive", baseline(), definitions());
  assert.equal(result.robustnessState, "SENSITIVE");
  assert.equal(result.trustDisposition, "REDUCE");
  assert.equal(result.metrics.changedDecisionCount, 1);
  assert.equal(result.metrics.maxProbabilityDelta, 0.29999999999999993);
  assert.equal(result.calibrationCreditAllowed, false);
  assert.equal(result.realizedEvidenceAllowed, false);
  assert.equal(result.learningCreditAllowed, false);
  assert.equal(result.liveAuthority, "NONE");
  assert.equal(result.productionMutationAllowed, false);
});

test("irrelevant perturbation remains robust but can never manufacture confidence uplift", async () => {
  const h = harness(() => ({ projection: projection({ rawProbability: 0.72 }) }));
  const result = await h.evaluator.run("scenario-robust", baseline(), definitions());
  assert.equal(result.robustnessState, "ROBUST");
  assert.equal(result.trustDisposition, "NO_UPLIFT");
  assert.equal(result.metrics.changedDecisionCount, 0);
  assert.equal(result.metrics.changedUncertaintyCount, 0);
});

test("equivalent scenario aliases are deduplicated before runner side effects", async () => {
  const h = harness(() => ({ projection: projection() }));
  const defs = [...definitions(), Object.freeze({ scenarioId: "alias", kind: "HYPOTHETICAL", interventions: Object.freeze([Object.freeze({ dimension: "priceShockPct", value: -10, horizonMs: 3600000 })]) })];
  const result = await h.evaluator.run("scenario-dedupe", baseline(), defs);
  assert.equal(result.metrics.duplicateScenarioCount, 1);
  assert.equal(h.calls.length, 2, "duplicate must be removed before runner/provider side effects");
  assert.equal(result.inferenceResources.modelCalls, 2);
});

test("observed evidence digest mutation fails before any scenario/provider side effect", async () => {
  const h = harness(() => ({ projection: projection() }));
  const corrupted = baseline({ evidenceMaterializations: [Object.freeze({ evidenceId: "e-1", contentDigest: digest, payload: { ...payload, price: 999 } })] });
  const result = await h.evaluator.run("scenario-corrupt", corrupted, definitions());
  assert.equal(result.robustnessState, "UNVERIFIED");
  assert.ok(result.metrics.reasonCodes.includes("INVALID_BASELINE"));
  assert.equal(h.calls.length, 0);
  assert.equal(result.inferenceResources.modelCalls, 0);
});

test("independent-provider disagreement inside a scenario forces contradictory abstention", async () => {
  const h = harness((scenario) => ({ projection: projection(), providerComparisonState: scenario.kind === "HYPOTHETICAL" ? "DISAGREEMENT" : "CONSENSUS" }));
  const result = await h.evaluator.run("scenario-contradiction", baseline(), definitions());
  assert.equal(result.robustnessState, "CONTRADICTORY");
  assert.equal(result.trustDisposition, "ABSTAIN");
  assert.ok(result.evaluations.some((item) => item.failureCode === "PROVIDER_DISAGREEMENT"));
});

test("one enclosing model-call budget blocks later scenario side effects", async () => {
  let sideEffects = 0;
  const runner = {
    runScenario: async (scenario, resources) => {
      if (!resources.reserveCall(`scenario:${scenario.scenarioIdentity}`, 1000)) throw new Error("resource blocked");
      sideEffects += 1;
      return { projection: projection() };
    }
  };
  const constrained = new ScenarioCounterfactualEvaluator(policy({ inferenceBudget: budget({ maxModelCalls: 1 }) }), runner, { now: () => 1000 });
  const result = await constrained.run("scenario-budget", baseline(), definitions());
  assert.equal(sideEffects, 1);
  assert.equal(result.robustnessState, "INCOMPLETE");
  assert.equal(result.inferenceResources.health, "EXHAUSTED");
  assert.equal(result.inferenceResources.failureCode, "CALL_BUDGET_EXHAUSTED");
});

test("exact replay is idempotent while changed scenario set fails closed without new side effects", async () => {
  const h = harness(() => ({ projection: projection() }));
  const first = await h.evaluator.run("scenario-replay", baseline(), definitions());
  const callsAfterFirst = h.calls.length;
  const same = await h.evaluator.run("scenario-replay", baseline(), definitions());
  assert.deepEqual(same, first);
  assert.equal(h.calls.length, callsAfterFirst);
  const changed = [...definitions(), Object.freeze({ scenarioId: "vol-up", kind: "HYPOTHETICAL", interventions: Object.freeze([Object.freeze({ dimension: "volatilityShockPct", value: 20, horizonMs: 3600000 })]) })];
  const conflict = await h.evaluator.run("scenario-replay", baseline(), changed);
  assert.equal(conflict.robustnessState, "UNVERIFIED");
  assert.ok(conflict.metrics.reasonCodes.includes("REPLAY_CONFLICT"));
  assert.equal(h.calls.length, callsAfterFirst);
});
