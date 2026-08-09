const test = require("node:test");
const assert = require("node:assert/strict");
const { aiSha256 } = require("../dist/packages/contracts/src/aiInference.js");
const { TransportModelProvider } = require("../dist/apps/cloud/src/ai/modelProvider.js");
const { NVersionStrategyEvaluator } = require("../dist/apps/cloud/src/ai/nVersionStrategyEvaluator.js");

const marketPayload = Object.freeze({ market: "KRW-BTC", price: 100, changeRate: 0.01, source: "UPBIT_PUBLIC_TICKER" });
const fixture = (evidenceId = "e-1", payload = marketPayload) => {
  const contentDigest = aiSha256(payload);
  return {
    evidence: { evidenceId, evidenceType: "market-data", sourceReference: `market-feed:${evidenceId}`, observedAt: 1, validUntil: 100, quality: "verified", contentDigest, lineageReferences: [] },
    materialization: { evidenceId, contentDigest, payload }
  };
};
const baseFixture = fixture();
const input = (overrides = {}) => ({ comparisonRunId: "nversion-1", decisionId: "decision-1", evaluatedAt: 10, evidence: [baseFixture.evidence], evidenceMaterializations: [baseFixture.materialization], ...overrides });

const budget = (overrides = {}) => Object.freeze({
  schemaVersion: 1,
  policyId: "TEST_NVERSION_BUDGET",
  policyVersion: "1",
  maxModelCalls: 2,
  maxTotalAttempts: 4,
  maxCumulativeOutputTokens: 4096,
  maxInputBytes: 1024 * 1024,
  maxWallClockMs: 90000,
  requireUsageAccounting: false,
  ...overrides
});

const pool = (overrides = {}) => Object.freeze({
  schemaVersion: 1,
  policyId: "TEST_PROVIDER_POOL",
  policyVersion: "1",
  groups: Object.freeze([
    Object.freeze({ groupId: "openai-gpt", providerId: "openai", modelVersionId: "gpt-test", modelFamilyId: "gpt" }),
    Object.freeze({ groupId: "anthropic-claude", providerId: "anthropic", modelVersionId: "claude-test", modelFamilyId: "claude" })
  ]),
  minIndependentGroups: 2,
  maxProbabilityDelta: 0.15,
  minEvidenceReferenceOverlap: 1,
  minAssumptionOverlap: 0.5,
  requireUncertaintyAgreement: true,
  inferenceBudget: budget(),
  ...overrides
});

const proposal = (overrides = {}) => ({
  strategyVersionId: "strategy-preview",
  decision: "candidate",
  rationaleClaims: ["market evidence supports research review"],
  assumptions: ["paper-only evaluation"],
  uncertainty: "medium",
  rawProbability: 0.7,
  expectedEffect: "research review",
  costSensitivity: "unknown",
  capacitySensitivity: "unknown",
  ...overrides
});

function provider(providerId, modelVersionId, payloadFactory, observedRequests, observedCalls) {
  return new TransportModelProvider(providerId, modelVersionId, async (request) => {
    observedCalls.count += 1;
    observedRequests.push(request);
    const payload = payloadFactory(request);
    const output = { schemaVersion: 1, role: "STRATEGY_PROPOSER", evidenceReferences: ["e-1"], payload };
    return {
      requestId: request.requestId,
      providerId: request.providerId,
      modelVersionId: request.modelVersionId,
      promptArtifactDigest: request.promptArtifactDigest,
      contextHash: request.contextHash,
      inputHash: request.inputHash,
      structuredOutput: output,
      outputHash: aiSha256(output),
      startedAt: 1000,
      completedAt: 1000
    };
  });
}

function evaluator(openAiPayload = proposal(), anthropicPayload = proposal(), policy = pool()) {
  const requests = [];
  const calls = { count: 0 };
  const openai = provider("openai", "gpt-test", () => openAiPayload, requests, calls);
  const anthropic = provider("anthropic", "claude-test", () => anthropicPayload, requests, calls);
  return {
    evaluator: new NVersionStrategyEvaluator([
      { groupId: "openai-gpt", provider: openai },
      { groupId: "anthropic-claude", provider: anthropic }
    ], policy, { maxRetries: 0, now: () => 1000 }),
    requests,
    calls
  };
}

test("valid independent agreement emits consensus without confidence or mutation authority uplift", async () => {
  const harness = evaluator(proposal({ rawProbability: 0.70 }), proposal({ rawProbability: 0.72 }));
  const result = await harness.evaluator.run(input());
  assert.equal(result.comparisonState, "CONSENSUS");
  assert.equal(result.trustDisposition, "NO_UPLIFT");
  assert.equal(result.independentGroupCount, 2);
  assert.equal(result.completedGroupCount, 2);
  assert.equal(result.metrics.decisionAgreement, true);
  assert.equal(result.metrics.maxProbabilityDelta, 0.020000000000000018);
  assert.deepEqual(result.metrics.disagreementCodes, []);
  assert.equal(result.inferenceResources.modelCalls, 2);
  assert.equal(result.inferenceResources.attempts, 2);
  assert.equal(result.liveAuthority, "NONE");
  assert.equal(result.realOrderAuthority, false);
  assert.equal(result.realTransferAuthority, false);
  assert.equal(result.productionMutationAllowed, false);
  assert.equal(harness.requests.length, 2);
  assert.equal(harness.requests[0].inputHash, harness.requests[1].inputHash, "N-version providers must receive the same canonical model input");
  assert.equal(harness.requests[0].promptArtifactDigest, harness.requests[1].promptArtifactDigest, "N-version providers must use the same prompt identity");
  assert.equal(harness.requests[0].contextHash, harness.requests[1].contextHash, "N-version providers must use the same evidence context");
});

test("same-provider aliases cannot inflate independence or trigger provider calls", async () => {
  let calls = 0;
  const first = new TransportModelProvider("openai", "gpt-a", async () => { calls += 1; throw new Error("must not run"); });
  const second = new TransportModelProvider("openai", "gpt-b", async () => { calls += 1; throw new Error("must not run"); });
  const policy = pool({
    groups: Object.freeze([
      Object.freeze({ groupId: "alias-a", providerId: "openai", modelVersionId: "gpt-a", modelFamilyId: "gpt-a" }),
      Object.freeze({ groupId: "alias-b", providerId: "openai", modelVersionId: "gpt-b", modelFamilyId: "gpt-b" })
    ])
  });
  const subject = new NVersionStrategyEvaluator([{ groupId: "alias-a", provider: first }, { groupId: "alias-b", provider: second }], policy, { maxRetries: 0, now: () => 1000 });
  const result = await subject.run(input({ comparisonRunId: "same-provider" }));
  assert.equal(result.comparisonState, "INSUFFICIENT_INDEPENDENCE");
  assert.equal(result.independentGroupCount, 0);
  assert.equal(result.completedGroupCount, 0);
  assert.equal(calls, 0, "fake independence must fail before spending inference resources");
  assert.equal(result.inferenceResources.modelCalls, 0);
});

test("contradictory independent providers deterministically force disagreement and abstention", async () => {
  const harness = evaluator(
    proposal({ decision: "candidate", rawProbability: 0.82, uncertainty: "low", assumptions: ["trend persists"] }),
    proposal({ decision: "no_action", rawProbability: 0.35, uncertainty: "high", assumptions: ["trend mean-reverts"] })
  );
  const result = await harness.evaluator.run(input({ comparisonRunId: "contradiction" }));
  assert.equal(result.comparisonState, "DISAGREEMENT");
  assert.equal(result.trustDisposition, "ABSTAIN");
  assert.equal(result.metrics.decisionAgreement, false);
  assert.ok(result.metrics.disagreementCodes.includes("DECISION_MISMATCH"));
  assert.ok(result.metrics.disagreementCodes.includes("PROBABILITY_DELTA_EXCEEDED"));
  assert.ok(result.metrics.disagreementCodes.includes("ASSUMPTION_OVERLAP_LOW"));
  assert.ok(result.metrics.disagreementCodes.includes("UNCERTAINTY_MISMATCH"));
  assert.equal(result.productionMutationAllowed, false);
});

test("partial provider failure stays incomplete instead of fabricating consensus", async () => {
  const requests = [];
  const calls = { count: 0 };
  const openai = provider("openai", "gpt-test", () => proposal(), requests, calls);
  const down = { providerId: "anthropic", modelVersionId: "claude-test", infer: async () => { calls.count += 1; throw new Error("provider down"); } };
  const subject = new NVersionStrategyEvaluator([{ groupId: "openai-gpt", provider: openai }, { groupId: "anthropic-claude", provider: down }], pool(), { maxRetries: 0, now: () => 1000 });
  const result = await subject.run(input({ comparisonRunId: "partial" }));
  assert.equal(result.comparisonState, "INCOMPLETE");
  assert.equal(result.completedGroupCount, 1);
  assert.equal(result.trustDisposition, "ABSTAIN");
  assert.equal(result.groups.find((group) => group.groupId === "anthropic-claude").status, "FAILED");
  assert.notEqual(result.comparisonState, "CONSENSUS");
  assert.equal(result.productionMutationAllowed, false);
});

test("provider identity mismatch fails closed before inference", async () => {
  let calls = 0;
  const aliased = { providerId: "not-openai", modelVersionId: "gpt-test", infer: async () => { calls += 1; throw new Error("must not run"); } };
  const anthropic = { providerId: "anthropic", modelVersionId: "claude-test", infer: async () => { calls += 1; throw new Error("must not run"); } };
  const subject = new NVersionStrategyEvaluator([{ groupId: "openai-gpt", provider: aliased }, { groupId: "anthropic-claude", provider: anthropic }], pool(), { maxRetries: 0, now: () => 1000 });
  const result = await subject.run(input({ comparisonRunId: "identity-mismatch" }));
  assert.equal(result.comparisonState, "UNVERIFIED");
  assert.equal(calls, 0);
  assert.ok(result.groups.some((group) => group.failureCode === "PROVIDER_IDENTITY_MISMATCH"));
});

test("all provider attempts share one call budget and later fan-out is blocked before side effect", async () => {
  const constrained = pool({ inferenceBudget: budget({ maxModelCalls: 1, maxTotalAttempts: 2, maxCumulativeOutputTokens: 4096 }) });
  const harness = evaluator(proposal(), proposal(), constrained);
  const result = await harness.evaluator.run(input({ comparisonRunId: "resource-bound" }));
  assert.equal(result.comparisonState, "INCOMPLETE");
  assert.equal(harness.calls.count, 1, "second provider must not be invoked after shared call budget exhaustion");
  assert.equal(result.inferenceResources.health, "EXHAUSTED");
  assert.equal(result.inferenceResources.failureCode, "CALL_BUDGET_EXHAUSTED");
  assert.equal(result.inferenceResources.modelCalls, 1);
  assert.equal(result.groups[1].status, "RESOURCE_BLOCKED");
});

test("exact replay is idempotent while changed evidence fails closed without another provider call", async () => {
  const harness = evaluator();
  const first = await harness.evaluator.run(input({ comparisonRunId: "replay" }));
  const callsAfterFirst = harness.calls.count;
  const same = await harness.evaluator.run(input({ comparisonRunId: "replay" }));
  assert.deepEqual(same, first);
  assert.equal(harness.calls.count, callsAfterFirst);

  const changed = fixture("e-2", { ...marketPayload, price: 101 });
  const conflict = await harness.evaluator.run(input({ comparisonRunId: "replay", evidence: [changed.evidence], evidenceMaterializations: [changed.materialization] }));
  assert.equal(conflict.comparisonState, "UNVERIFIED");
  assert.ok(conflict.metrics.disagreementCodes.includes("REPLAY_CONFLICT"));
  assert.equal(harness.calls.count, callsAfterFirst, "replay conflict must not invoke providers");
  assert.equal(conflict.liveAuthority, "NONE");
});

test("prohibited capability-shaped provider output is rejected and cannot create consensus", async () => {
  const harness = evaluator(proposal({ requestedCapability: "ORDER" }), proposal());
  const result = await harness.evaluator.run(input({ comparisonRunId: "tool-escalation" }));
  assert.equal(result.comparisonState, "INCOMPLETE");
  assert.equal(result.groups[0].status, "FAILED");
  assert.equal(result.realOrderAuthority, false);
  assert.equal(result.productionMutationAllowed, false);
});
