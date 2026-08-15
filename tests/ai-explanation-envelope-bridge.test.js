const test = require("node:test");
const assert = require("node:assert/strict");
const { aiSha256 } = require("../dist/packages/contracts/src/aiInference.js");
const { TransportModelProvider } = require("../dist/apps/cloud/src/ai/modelProvider.js");
const { MultiAgentOrchestrator } = require("../dist/apps/cloud/src/ai/multiAgentOrchestrator.js");
const { buildAiExplanationEnvelope } = require("../dist/apps/cloud/src/ai/explanationEnvelopeBridge.js");
const { verifyAiExplanation } = require("../dist/apps/cloud/src/ai/explanationFaithfulnessVerifier.js");
const { normalizeAiInferenceBudgetPolicy } = require("../dist/apps/cloud/src/ai/inferenceResourceLedger.js");

const proposalSeed = { strategyVersionId: "strategy-preview", decision: "candidate", rationaleClaims: ["market evidence supports review"], assumptions: ["paper-only evaluation"], uncertainty: "medium", rawProbability: 0.7, expectedEffect: "research review", costSensitivity: "unknown", capacitySensitivity: "unknown" };
const marketPayload = Object.freeze({ market: "KRW-BTC", price: 100, changeRate: 0.01, source: "UPBIT_PUBLIC_TICKER" });
const fixture = (evidenceId = "e-1", payload = marketPayload, overrides = {}) => {
  const contentDigest = aiSha256(payload);
  return {
    evidence: { evidenceId, evidenceType: "market-data", sourceReference: `market-feed:${evidenceId}`, observedAt: 1, validUntil: 1_000_000, quality: "verified", contentDigest, lineageReferences: [], ...overrides },
    materialization: { evidenceId, contentDigest, payload }
  };
};
const baseFixture = fixture();
const input = (overrides = {}) => ({ orchestrationRunId: "orchestration-1", decisionId: "decision-1", evaluatedAt: 10, evidence: [baseFixture.evidence], evidenceMaterializations: [baseFixture.materialization], ...overrides });

function providerWith(riskPayload) {
  return new TransportModelProvider("fixture-model", "model-backed-test", async (request) => {
    let payload;
    if (request.role === "EVIDENCE_PRODUCER") payload = { observations: [{ claim: "verified market state", claimType: "fact", evidenceReferences: ["e-1"], freshnessStatus: "fresh" }], missingEvidence: [], evidenceBundleHash: request.input.evidenceBundleHash };
    if (request.role === "STRATEGY_PROPOSER") payload = proposalSeed;
    if (request.role === "ADVERSARIAL_CRITIC") payload = { reviewedProposalHash: request.input.proposalHash, counterClaims: ["paper evidence is not live evidence"], failedAssumptions: [], missingTests: ["out-of-sample review"], alternativeExplanations: ["noise"], severity: "low" };
    if (request.role === "RISK_VERIFIER") payload = riskPayload(request);
    const output = { schemaVersion: 1, role: request.role, evidenceReferences: ["e-1"], payload };
    return { requestId: request.requestId, providerId: request.providerId, modelVersionId: request.modelVersionId, promptArtifactDigest: request.promptArtifactDigest, contextHash: request.contextHash, inputHash: request.inputHash, structuredOutput: output, outputHash: aiSha256(output), startedAt: 1, completedAt: 2 };
  });
}

const context = (overrides = {}) => ({ explanationId: "run-1:explanation", observedAt: 2, providerId: "fixture-model", resourcePolicy: normalizeAiInferenceBudgetPolicy(undefined), calibrationCohort: null, providerDisagreement: false, confidence: 0, scenarioIdentity: null, ...overrides });

test("a completed candidate decision produces a PASS-eligible envelope with real evidence digests", async () => {
  const provider = providerWith(() => ({ result: "verified", hardDenies: [], warnings: [], missingRequirements: [], requiredEscalations: [], policyReferences: ["risk-policy-1"] }));
  const result = await new MultiAgentOrchestrator(provider, { enabled: true, maxRetries: 0 }).run(input());
  assert.equal(result.status, "COMPLETED");
  // A single-provider run is inherently correlated, so governance caps it at "incomplete" (never
  // "preview_candidate") -- that is a separate, deliberate independence gate. Faithfulness only
  // asks whether the model's own "candidate" claim is evidence-supported at its stated confidence.
  assert.equal(result.governanceDecision.result, "incomplete");
  const envelope = buildAiExplanationEnvelope(input(), result, context({ confidence: 0.6 }));
  assert.ok(envelope);
  assert.equal(envelope.abstained, false);
  assert.equal(envelope.claims.length, 1);
  assert.equal(envelope.claims[0].assertive, true);
  assert.equal(envelope.evidence[0].digest, baseFixture.evidence.contentDigest);
  assert.equal(envelope.lineage.replayIdentity, result.orchestrationRunId);
  assert.equal(envelope.attributionStrength, "UNRESOLVED");
  const verification = verifyAiExplanation(envelope);
  assert.equal(verification.verdict, "PASS");
  assert.equal(verification.claimStatuses[envelope.claims[0].claimId], "SUPPORTED");
  assert.equal(verification.productionMutationAllowed, false);
  assert.equal(verification.liveAuthority, "NONE");
});

test("a risk-denied decision marks the cited evidence as material counterevidence", async () => {
  const provider = providerWith(() => ({ result: "denied", hardDenies: ["e-1"], warnings: [], missingRequirements: [], requiredEscalations: [], policyReferences: ["risk-policy-1"] }));
  const result = await new MultiAgentOrchestrator(provider, { enabled: true, maxRetries: 0 }).run(input({ orchestrationRunId: "deny-run", decisionId: "deny-run" }));
  assert.equal(result.governanceDecision.result, "deny");
  // A deterministic risk veto is a governance-level outcome, not a change in what the model
  // itself claimed -- the proposer still said "candidate", so the explanation is still checked
  // as an assertive claim, and the cited evidence is correctly caught contradicting it.
  const envelope = buildAiExplanationEnvelope(input({ orchestrationRunId: "deny-run", decisionId: "deny-run" }), result, context({ confidence: 0.6 }));
  assert.ok(envelope);
  assert.equal(envelope.abstained, false);
  assert.equal(envelope.evidence[0].material, true);
  assert.deepEqual(envelope.evidence[0].contradictsClaimIds, [envelope.claims[0].claimId]);
  assert.equal(envelope.policy.materialCounterEvidenceIds.includes("e-1"), true);
  const verification = verifyAiExplanation(envelope);
  assert.equal(verification.verdict, "ABSTAIN");
  assert.equal(verification.claimStatuses[envelope.claims[0].claimId], "CONTRADICTED");
  assert.ok(verification.reasonCodes.includes("CONTRADICTED_CLAIM"));
});

test("an incomplete or unavailable orchestration result yields no envelope, never a throw", async () => {
  const down = await new MultiAgentOrchestrator({ providerId: "down", modelVersionId: "down", infer: async () => { throw new Error("down"); } }, { enabled: true, maxRetries: 0 }).run(input({ orchestrationRunId: "down", decisionId: "down" }));
  assert.equal(down.status, "UNAVAILABLE");
  assert.equal(buildAiExplanationEnvelope(input({ orchestrationRunId: "down", decisionId: "down" }), down, context()), null);

  const disabled = await new MultiAgentOrchestrator(providerWith(() => ({ result: "verified", hardDenies: [], warnings: [], missingRequirements: [], requiredEscalations: [], policyReferences: [] })), { enabled: false, maxRetries: 0 }).run(input({ orchestrationRunId: "disabled", decisionId: "disabled" }));
  assert.equal(disabled.status, "UNAVAILABLE");
  assert.equal(buildAiExplanationEnvelope(input({ orchestrationRunId: "disabled", decisionId: "disabled" }), disabled, context()), null);
});

test("envelope content digest is deterministic and excludes itself from its own hash", async () => {
  const provider = providerWith(() => ({ result: "verified", hardDenies: [], warnings: [], missingRequirements: [], requiredEscalations: [], policyReferences: [] }));
  const result = await new MultiAgentOrchestrator(provider, { enabled: true, maxRetries: 0 }).run(input({ orchestrationRunId: "digest-run", decisionId: "digest-run" }));
  const envelopeInput = input({ orchestrationRunId: "digest-run", decisionId: "digest-run" });
  const one = buildAiExplanationEnvelope(envelopeInput, result, context());
  const two = buildAiExplanationEnvelope(envelopeInput, result, context());
  assert.deepEqual(one, two);
  const { contentDigest, ...withoutDigest } = one;
  assert.equal(aiSha256(withoutDigest), contentDigest);
});
