const test = require("node:test");
const assert = require("node:assert/strict");
const { aiSha256 } = require("../dist/packages/contracts/src/aiInference.js");
const { TransportModelProvider } = require("../dist/apps/cloud/src/ai/modelProvider.js");
const { NVersionStrategyEvaluator } = require("../dist/apps/cloud/src/ai/nVersionStrategyEvaluator.js");

const payload = Object.freeze({ market: "KRW-BTC", price: 100, source: "UPBIT_PUBLIC_TICKER" });
const digest = aiSha256(payload);
const input = (id) => ({
  comparisonRunId: `eval-${id}`,
  decisionId: `decision-${id}`,
  evaluatedAt: 10,
  evidence: [{ evidenceId: "e-1", evidenceType: "market-data", sourceReference: "upbit-public-ticker", observedAt: 1, validUntil: 100, quality: "verified", contentDigest: digest, lineageReferences: [] }],
  evidenceMaterializations: [{ evidenceId: "e-1", contentDigest: digest, payload }]
});
const proposal = (overrides = {}) => ({
  strategyVersionId: "strategy-preview",
  decision: "candidate",
  rationaleClaims: ["market evidence supports research review"],
  assumptions: ["paper only"],
  uncertainty: "medium",
  rawProbability: 0.7,
  expectedEffect: "research review",
  costSensitivity: "unknown",
  capacitySensitivity: "unknown",
  ...overrides
});
const policy = Object.freeze({
  schemaVersion: 1,
  policyId: "AI007_EVAL",
  policyVersion: "1",
  groups: Object.freeze([
    Object.freeze({ groupId: "a", providerId: "provider-a", modelVersionId: "model-a", modelFamilyId: "family-a" }),
    Object.freeze({ groupId: "b", providerId: "provider-b", modelVersionId: "model-b", modelFamilyId: "family-b" })
  ]),
  minIndependentGroups: 2,
  maxProbabilityDelta: 0.15,
  minEvidenceReferenceOverlap: 0.5,
  minAssumptionOverlap: 0.5,
  requireUncertaintyAgreement: true,
  inferenceBudget: Object.freeze({ schemaVersion: 1, policyId: "AI007_EVAL_BUDGET", policyVersion: "1", maxModelCalls: 2, maxTotalAttempts: 2, maxCumulativeOutputTokens: 4096, maxInputBytes: 1024 * 1024, maxWallClockMs: 30000, requireUsageAccounting: false })
});

function provider(providerId, modelVersionId, structuredPayload, evidenceReferences = ["e-1"]) {
  return new TransportModelProvider(providerId, modelVersionId, async (request) => {
    const output = { schemaVersion: 1, role: "STRATEGY_PROPOSER", evidenceReferences, payload: structuredPayload };
    return { requestId: request.requestId, providerId: request.providerId, modelVersionId: request.modelVersionId, promptArtifactDigest: request.promptArtifactDigest, contextHash: request.contextHash, inputHash: request.inputHash, structuredOutput: output, outputHash: aiSha256(output), startedAt: 1000, completedAt: 1000 };
  });
}

async function evaluateScenario(id, primaryPayload, independentPayload, secondEvidence = ["e-1"]) {
  // Baseline is the pre-AI-007 observable surface: one primary provider output. It has no independent
  // observation with which to detect cross-provider contradiction, so cross-provider detection is false.
  const baselineDetectedCrossProviderConflict = false;
  const evaluator = new NVersionStrategyEvaluator([
    { groupId: "a", provider: provider("provider-a", "model-a", primaryPayload) },
    { groupId: "b", provider: provider("provider-b", "model-b", independentPayload, secondEvidence) }
  ], policy, { maxRetries: 0, now: () => 1000 });
  const result = await evaluator.run(input(id));
  return { baselineDetectedCrossProviderConflict, result };
}

test("AI-007 improves adversarial cross-provider conflict observability from 0/5 to 5/5 without authority gain", async () => {
  const scenarios = [
    ["decision", proposal(), proposal({ decision: "no_action" })],
    ["probability", proposal({ rawProbability: 0.9 }), proposal({ rawProbability: 0.3 })],
    ["assumptions", proposal({ assumptions: ["trend continues"] }), proposal({ assumptions: ["mean reversion"] })],
    ["uncertainty", proposal({ uncertainty: "low" }), proposal({ uncertainty: "high" })],
    ["evidence", proposal(), proposal(), ["e-2"]]
  ];
  let baselineDetected = 0;
  let nVersionDetected = 0;
  for (const [id, first, second, refs] of scenarios) {
    const { baselineDetectedCrossProviderConflict, result } = await evaluateScenario(id, first, second, refs);
    if (baselineDetectedCrossProviderConflict) baselineDetected += 1;
    if (result.comparisonState === "DISAGREEMENT" && result.trustDisposition === "ABSTAIN") nVersionDetected += 1;
    assert.equal(result.liveAuthority, "NONE");
    assert.equal(result.realOrderAuthority, false);
    assert.equal(result.realTransferAuthority, false);
    assert.equal(result.productionMutationAllowed, false);
  }
  assert.equal(baselineDetected, 0);
  assert.equal(nVersionDetected, 5);
  assert.ok(nVersionDetected > baselineDetected);
});

test("AI-007 does not mislabel matched independent fixtures as an intelligence gain", async () => {
  const { result } = await evaluateScenario("agreement", proposal({ rawProbability: 0.7 }), proposal({ rawProbability: 0.72 }));
  assert.equal(result.comparisonState, "CONSENSUS");
  assert.equal(result.trustDisposition, "NO_UPLIFT", "agreement is evidence only and must not manufacture confidence");
  assert.equal(result.inferenceResources.modelCalls, 2);
  assert.equal(result.productionMutationAllowed, false);
});
