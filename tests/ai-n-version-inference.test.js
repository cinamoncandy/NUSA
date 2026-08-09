const test = require("node:test");
const assert = require("node:assert/strict");
const { aiSha256 } = require("../dist/packages/contracts/src/aiInference.js");
const { NVersionInferenceRunner } = require("../dist/apps/cloud/src/ai/nVersionInference.js");

const budget = (overrides = {}) => ({
  schemaVersion: 1,
  policyId: "AI_N_VERSION_TEST_BUDGET",
  policyVersion: "1.0.0",
  maxModelCalls: 4,
  maxTotalAttempts: 4,
  maxCumulativeOutputTokens: 4096,
  maxInputBytes: 1024 * 1024,
  maxWallClockMs: 60_000,
  requireUsageAccounting: false,
  ...overrides
});

const pool = (groups, overrides = {}) => ({
  schemaVersion: 1,
  policyId: "AI_N_VERSION_TEST_POOL",
  policyVersion: "1.0.0",
  minimumIndependentGroups: 2,
  maximumProbabilityDelta: 0.1,
  groups,
  ...overrides
});

const group = (groupId, providerId, modelVersionId, lineageId) => ({ groupId, providerId, modelVersionId, lineageId });

const template = Object.freeze({
  role: "STRATEGY_PROPOSER",
  promptArtifactId: "nusa.ai.strategy_proposer",
  promptArtifactVersion: "1.0.0",
  promptArtifactDigest: "a".repeat(64),
  instructions: "Use only verified evidence. Return structured research output with zero authority.",
  contextHash: "b".repeat(64),
  inputHash: "c".repeat(64),
  input: Object.freeze({ evidenceBundleHash: "d".repeat(64), evidence: [] }),
  maxOutputBytes: 32_768,
  maxTokens: 1024,
  timeoutMs: 5_000
});

const output = (decision = "candidate", rawProbability = 0.6, uncertainty = "medium", assumptions = ["paper-only"]) => Object.freeze({
  schemaVersion: 1,
  role: "STRATEGY_PROPOSER",
  evidenceReferences: Object.freeze(["evidence-1"]),
  payload: Object.freeze({ decision, rawProbability, uncertainty, assumptions: Object.freeze(assumptions) })
});

const provider = (providerId, modelVersionId, structuredOutput = output(), behavior = "ok") => ({
  providerId,
  modelVersionId,
  infer: async (request) => {
    if (behavior === "fail") throw new Error("provider unavailable");
    return Object.freeze({
      requestId: request.requestId,
      providerId: request.providerId,
      modelVersionId: request.modelVersionId,
      promptArtifactDigest: request.promptArtifactDigest,
      contextHash: request.contextHash,
      inputHash: request.inputHash,
      structuredOutput,
      outputHash: aiSha256(structuredOutput),
      usage: Object.freeze({ inputTokens: 10, outputTokens: 20, totalTokens: 30 }),
      startedAt: 1,
      completedAt: 2
    });
  }
});

const validate = (value) => value;

const monotonicNow = () => {
  let now = 100;
  return () => now++;
};

test("two genuinely independent providers can emit bounded zero-authority consensus", async () => {
  const policy = pool([
    group("alpha", "provider-a", "model-a", "lineage-a"),
    group("beta", "provider-b", "model-b", "lineage-b")
  ]);
  const providers = new Map([
    ["alpha", provider("provider-a", "model-a")],
    ["beta", provider("provider-b", "model-b")]
  ]);
  const result = await new NVersionInferenceRunner(policy, providers, budget(), 0, monotonicNow()).execute("consensus", template, validate);
  assert.equal(result.state, "CONSENSUS");
  assert.deepEqual(result.eligibleIndependentGroupIds, ["alpha", "beta"]);
  assert.equal(result.resourceSnapshot.modelCalls, 2);
  assert.equal(result.resourceSnapshot.attempts, 2);
  assert.equal(result.liveAuthority, "NONE");
  assert.equal(result.realOrderAuthority, false);
  assert.equal(result.realTransferAuthority, false);
  assert.equal(result.productionMutationAllowed, false);
});

test("aliases from the same provider cannot inflate independent consensus", async () => {
  const policy = pool([
    group("alpha", "provider-a", "model-a", "lineage-a"),
    group("alias", "provider-a", "model-b", "lineage-b")
  ]);
  const providers = new Map([
    ["alpha", provider("provider-a", "model-a")],
    ["alias", provider("provider-a", "model-b")]
  ]);
  const result = await new NVersionInferenceRunner(policy, providers, budget(), 0, monotonicNow()).execute("alias", template, validate);
  assert.equal(result.state, "INSUFFICIENT_INDEPENDENCE");
  assert.equal(result.eligibleIndependentGroupIds.length, 1);
  assert.ok(result.reasonCodes.includes("CORRELATED_OR_DUPLICATE_GROUPS_EXCLUDED"));
});

test("contradictory independent providers surface disagreement instead of cherry-picked consensus", async () => {
  const policy = pool([
    group("alpha", "provider-a", "model-a", "lineage-a"),
    group("beta", "provider-b", "model-b", "lineage-b")
  ]);
  const providers = new Map([
    ["alpha", provider("provider-a", "model-a", output("candidate", 0.8, "low"))],
    ["beta", provider("provider-b", "model-b", output("no_action", 0.35, "high"))]
  ]);
  const result = await new NVersionInferenceRunner(policy, providers, budget(), 0, monotonicNow()).execute("disagreement", template, validate);
  assert.equal(result.state, "DISAGREEMENT");
  assert.ok(result.disagreements.some((item) => item.field === "decision"));
  assert.ok(result.disagreements.some((item) => item.field === "rawProbability"));
  assert.ok(result.disagreements.some((item) => item.field === "uncertainty"));
  assert.equal(result.productionMutationAllowed, false);
});

test("partial provider failure remains incomplete and cannot be promoted to consensus", async () => {
  const policy = pool([
    group("alpha", "provider-a", "model-a", "lineage-a"),
    group("beta", "provider-b", "model-b", "lineage-b")
  ]);
  const providers = new Map([
    ["alpha", provider("provider-a", "model-a")],
    ["beta", provider("provider-b", "model-b", output(), "fail")]
  ]);
  const result = await new NVersionInferenceRunner(policy, providers, budget(), 0, monotonicNow()).execute("partial", template, validate);
  assert.equal(result.state, "INCOMPLETE");
  assert.ok(result.reasonCodes.includes("PARTIAL_PROVIDER_FAILURE"));
  assert.equal(result.completedGroupIds.length, 1);
});

test("all N-version fan-out consumes one shared WO-AI-006 style call budget", async () => {
  const policy = pool([
    group("alpha", "provider-a", "model-a", "lineage-a"),
    group("beta", "provider-b", "model-b", "lineage-b")
  ]);
  const providers = new Map([
    ["alpha", provider("provider-a", "model-a")],
    ["beta", provider("provider-b", "model-b")]
  ]);
  const result = await new NVersionInferenceRunner(policy, providers, budget({ maxModelCalls: 1 }), 0, monotonicNow()).execute("budget", template, validate);
  assert.equal(result.state, "INCOMPLETE");
  assert.equal(result.resourceSnapshot.health, "EXHAUSTED");
  assert.equal(result.resourceSnapshot.failureCode, "CALL_BUDGET_EXHAUSTED");
  assert.equal(result.resourceSnapshot.modelCalls, 1);
  assert.equal(result.completedGroupIds.length, 1);
});

test("provider configuration identity mismatch fails before any model call", () => {
  const policy = pool([
    group("alpha", "provider-a", "model-a", "lineage-a"),
    group("beta", "provider-b", "model-b", "lineage-b")
  ]);
  const providers = new Map([
    ["alpha", provider("provider-a", "wrong-model")],
    ["beta", provider("provider-b", "model-b")]
  ]);
  assert.throws(() => new NVersionInferenceRunner(policy, providers, budget()), /provider identity mismatch:alpha/);
});
