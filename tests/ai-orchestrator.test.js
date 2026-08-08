const test = require("node:test");
const assert = require("node:assert/strict");
const { aiSha256 } = require("../dist/packages/contracts/src/aiInference.js");
const { TransportModelProvider } = require("../dist/apps/cloud/src/ai/modelProvider.js");
const { MultiAgentOrchestrator } = require("../dist/apps/cloud/src/ai/multiAgentOrchestrator.js");
const { projectAiReadOnly } = require("../dist/apps/cloud/src/ai/projection.js");
const { SqliteDatabase, SqliteMultiAgentGovernanceStore } = require("../dist/packages/storage/src/index.js");

const proposalSeed = { strategyVersionId: "strategy-preview", decision: "candidate", rationaleClaims: ["market evidence supports review"], assumptions: ["paper-only evaluation"], uncertainty: "medium", expectedEffect: "research review", costSensitivity: "unknown", capacitySensitivity: "unknown" };
const marketPayload = Object.freeze({ market: "KRW-BTC", price: 100, changeRate: 0.01, source: "UPBIT_PUBLIC_TICKER" });
const fixture = (evidenceId = "e-1", payload = marketPayload, overrides = {}) => {
  const contentDigest = aiSha256(payload);
  return {
    evidence: { evidenceId, evidenceType: "market-data", sourceReference: `market-feed:${evidenceId}`, observedAt: 1, validUntil: 100, quality: "verified", contentDigest, lineageReferences: [], ...overrides },
    materialization: { evidenceId, contentDigest, payload }
  };
};
const baseFixture = fixture();
const input = (overrides = {}) => ({ orchestrationRunId: "orchestration-1", decisionId: "decision-1", evaluatedAt: 10, evidence: [baseFixture.evidence], evidenceMaterializations: [baseFixture.materialization], ...overrides });

const observedRequests = [];
const provider = new TransportModelProvider("fixture-model", "model-backed-test", async (request) => {
  observedRequests.push(request);
  let payload;
  if (request.role === "EVIDENCE_PRODUCER") payload = { observations: [{ claim: "verified market state", claimType: "fact", evidenceReferences: ["e-1"], freshnessStatus: "fresh" }], missingEvidence: [], evidenceBundleHash: request.input.evidenceBundleHash };
  if (request.role === "STRATEGY_PROPOSER") payload = proposalSeed;
  if (request.role === "ADVERSARIAL_CRITIC") payload = { reviewedProposalHash: request.input.proposalHash, counterClaims: ["paper evidence is not live evidence"], failedAssumptions: [], missingTests: ["out-of-sample review"], alternativeExplanations: ["noise"], severity: "low" };
  if (request.role === "RISK_VERIFIER") payload = { result: "verified", hardDenies: [], warnings: ["AI cannot alter deterministic risk"], missingRequirements: [], requiredEscalations: [], policyReferences: ["risk-policy-1"] };
  const output = { schemaVersion: 1, role: request.role, evidenceReferences: ["e-1"], payload };
  return { requestId: request.requestId, providerId: request.providerId, modelVersionId: request.modelVersionId, promptArtifactDigest: request.promptArtifactDigest, contextHash: request.contextHash, inputHash: request.inputHash, structuredOutput: output, outputHash: aiSha256(output), startedAt: 1, completedAt: 2 };
});

test("grounded model requests carry exact prompt instructions and verified evidence payloads without pretending same-model roles are independent", async () => {
  observedRequests.length = 0;
  const result = await new MultiAgentOrchestrator(provider, { enabled: true, maxRetries: 0 }).run(input());
  assert.equal(result.status, "COMPLETED");
  assert.ok(result.governanceDecision);
  assert.equal(result.governanceDecision.result, "incomplete");
  assert.equal(result.governanceDecision.realOrderAuthority, false);
  assert.equal(result.governanceDecision.realTransferAuthority, false);
  assert.equal(result.governanceDecision.productionMutationAllowed, false);
  assert.equal(result.runs.length, 4);
  assert.equal(result.agents.every((agent) => agent.allowedToolCapabilities.includes("READ_EVIDENCE")), true);
  assert.equal(result.agents.every((agent) => agent.modelVersionId === "model-backed-test"), true);
  assert.equal(result.independence.independent, false);
  assert.ok(result.independence.reasonCodes.includes("CORRELATED_MODEL_VERSION"));
  assert.ok(result.independence.reasonCodes.includes("CORRELATED_AGENT_GROUP"));
  assert.match(observedRequests[0].instructions, /verified evidence payloads/i);
  assert.equal(observedRequests[0].input.evidence[0].payload.price, 100);
  assert.equal(observedRequests[0].input.evidence[0].contentDigest, baseFixture.evidence.contentDigest);
  const projection = projectAiReadOnly(result);
  assert.equal(projection.status, "INCOMPLETE");
  assert.equal(projection.confidence, 0);
  assert.equal(projection.calibrationStatus, "UNKNOWN");
  assert.equal(projection.liveAuthority, "NONE");
  assert.equal(projection.productionMutationAllowed, false);
});

test("governance events persist through the existing multi-agent SQLite ledger", async () => {
  const db = new SqliteDatabase(":memory:");
  try {
    const store = new SqliteMultiAgentGovernanceStore(db);
    const orchestrator = new MultiAgentOrchestrator(provider, { enabled: true, maxRetries: 0, eventSink: store });
    const result = await orchestrator.run(input({ orchestrationRunId: "persisted", decisionId: "persisted" }));
    assert.equal(result.status, "COMPLETED");
    store.verify();
    assert.equal(store.list().length, 5);
    await orchestrator.run(input({ orchestrationRunId: "persisted", decisionId: "persisted" }));
    assert.equal(store.list().length, 5);
  } finally {
    db.close();
  }
});

test("missing, tampered, sensitive, or model-mismatched evidence fails closed", async () => {
  let calls = 0;
  const probe = new TransportModelProvider("probe", "model", async () => { calls += 1; throw new Error("should not run"); });
  const missing = await new MultiAgentOrchestrator(probe, { enabled: true, maxRetries: 0 }).run(input({ orchestrationRunId: "missing-grounding", decisionId: "missing-grounding", evidenceMaterializations: [] }));
  assert.deepEqual(missing.failureCodes, ["EVIDENCE_MISSING"]);
  assert.equal(calls, 0);

  const tampered = await new MultiAgentOrchestrator(probe, { enabled: true, maxRetries: 0 }).run(input({ orchestrationRunId: "tampered-grounding", decisionId: "tampered-grounding", evidenceMaterializations: [{ ...baseFixture.materialization, payload: { ...marketPayload, price: 999 } }] }));
  assert.deepEqual(tampered.failureCodes, ["EVIDENCE_DIGEST_MISMATCH"]);
  assert.equal(calls, 0);

  const sensitivePayload = { market: "KRW-BTC", authorization: "Bearer should-never-reach-model" };
  const sensitiveFixture = fixture("e-1", sensitivePayload);
  const sensitive = await new MultiAgentOrchestrator(probe, { enabled: true, maxRetries: 0 }).run(input({ orchestrationRunId: "sensitive-grounding", decisionId: "sensitive-grounding", evidence: [sensitiveFixture.evidence], evidenceMaterializations: [sensitiveFixture.materialization] }));
  assert.deepEqual(sensitive.failureCodes, ["SENSITIVE_EVIDENCE"]);
  assert.equal(calls, 0);

  const wrongBundleProvider = new TransportModelProvider("fixture", "model", async (request) => {
    const output = { schemaVersion: 1, role: request.role, evidenceReferences: ["e-1"], payload: { observations: [], missingEvidence: [], evidenceBundleHash: "a".repeat(64) } };
    return { requestId: request.requestId, providerId: request.providerId, modelVersionId: request.modelVersionId, promptArtifactDigest: request.promptArtifactDigest, contextHash: request.contextHash, inputHash: request.inputHash, structuredOutput: output, outputHash: aiSha256(output), startedAt: 1, completedAt: 2 };
  });
  const wrongBundle = await new MultiAgentOrchestrator(wrongBundleProvider, { enabled: true, maxRetries: 0 }).run(input({ orchestrationRunId: "wrong-bundle", decisionId: "wrong-bundle" }));
  assert.deepEqual(wrongBundle.failureCodes, ["EVIDENCE_DIGEST_MISMATCH"]);
  assert.equal(wrongBundle.productionMutationAllowed, false);
});

test("model failure and complete replay identity remain zero-authority", async () => {
  const unavailable = await new MultiAgentOrchestrator({ providerId: "down", modelVersionId: "down", infer: async () => { throw new Error("down"); } }, { enabled: true, maxRetries: 0 }).run(input({ orchestrationRunId: "down", decisionId: "down" }));
  assert.equal(unavailable.status, "UNAVAILABLE");
  assert.equal(unavailable.productionMutationAllowed, false);
  const orchestrator = new MultiAgentOrchestrator(provider, { enabled: true, maxRetries: 0 });
  const first = await orchestrator.run(input({ orchestrationRunId: "replay", decisionId: "replay" }));
  const same = await orchestrator.run(input({ orchestrationRunId: "replay", decisionId: "replay" }));
  assert.deepEqual(same, first);
  const changedFixture = fixture("e-2", { ...marketPayload, price: 101 });
  const evidenceConflict = await orchestrator.run(input({ orchestrationRunId: "replay", decisionId: "replay", evidence: [changedFixture.evidence], evidenceMaterializations: [changedFixture.materialization] }));
  assert.deepEqual(evidenceConflict.failureCodes, ["REPLAY_CONFLICT"]);
  const certificationConflict = await orchestrator.run(input({ orchestrationRunId: "replay", decisionId: "replay", certificationIds: ["new-certification"] }));
  assert.deepEqual(certificationConflict.failureCodes, ["REPLAY_CONFLICT"]);
  assert.equal(certificationConflict.realOrderAuthority, false);
});

test("malformed output, tool escalation, stale evidence, and missing critic fail closed", async () => {
  const malformed = new TransportModelProvider("fixture", "model", async (request) => ({ requestId: request.requestId, providerId: request.providerId, modelVersionId: request.modelVersionId, promptArtifactDigest: request.promptArtifactDigest, contextHash: request.contextHash, inputHash: request.inputHash, structuredOutput: "not-json-object", outputHash: aiSha256("not-json-object"), startedAt: 1, completedAt: 2 }));
  const malformedResult = await new MultiAgentOrchestrator(malformed, { enabled: true, maxRetries: 0 }).run(input({ orchestrationRunId: "malformed", decisionId: "malformed" }));
  assert.equal(malformedResult.status, "INCOMPLETE");
  assert.equal(malformedResult.productionMutationAllowed, false);

  const escalated = new TransportModelProvider("fixture", "model", async (request) => {
    const baseOutput = request.role === "EVIDENCE_PRODUCER"
      ? { observations: [{ claim: "verified", claimType: "fact", evidenceReferences: ["e-1"], freshnessStatus: "fresh" }], missingEvidence: [], evidenceBundleHash: request.input.evidenceBundleHash }
      : request.role === "STRATEGY_PROPOSER"
        ? { ...proposalSeed, requestedCapability: "ORDER" }
        : request.role === "ADVERSARIAL_CRITIC"
          ? { reviewedProposalHash: request.input.proposalHash, counterClaims: [], failedAssumptions: [], missingTests: [], alternativeExplanations: [], severity: "low" }
          : { result: "verified", hardDenies: [], warnings: [], missingRequirements: [], requiredEscalations: [], policyReferences: ["risk-policy"] };
    const output = { schemaVersion: 1, role: request.role, evidenceReferences: ["e-1"], payload: baseOutput };
    return { requestId: request.requestId, providerId: request.providerId, modelVersionId: request.modelVersionId, promptArtifactDigest: request.promptArtifactDigest, contextHash: request.contextHash, inputHash: request.inputHash, structuredOutput: output, outputHash: aiSha256(output), startedAt: 1, completedAt: 2 };
  });
  const escalation = await new MultiAgentOrchestrator(escalated, { enabled: true, maxRetries: 0 }).run(input({ orchestrationRunId: "escalation", decisionId: "escalation" }));
  assert.equal(escalation.status, "INCOMPLETE");
  assert.equal(escalation.realOrderAuthority, false);

  const staleFixture = fixture("e-stale", marketPayload, { validUntil: 2, quality: "stale" });
  const stale = await new MultiAgentOrchestrator(provider, { enabled: true, maxRetries: 0 }).run(input({ orchestrationRunId: "stale", decisionId: "stale", evidence: [staleFixture.evidence], evidenceMaterializations: [staleFixture.materialization] }));
  assert.equal(stale.status, "INCOMPLETE");
  assert.ok(stale.failureCodes.includes("CONTEXT_INVALID"));

  const noCritic = new TransportModelProvider("fixture", "model", async (request) => {
    const output = request.role === "ADVERSARIAL_CRITIC" ? { schemaVersion: 1, role: request.role, evidenceReferences: ["e-1"], payload: { missing: "critic" } } : request.role === "EVIDENCE_PRODUCER" ? { schemaVersion: 1, role: request.role, evidenceReferences: ["e-1"], payload: { observations: [], missingEvidence: [], evidenceBundleHash: request.input.evidenceBundleHash } } : request.role === "STRATEGY_PROPOSER" ? { schemaVersion: 1, role: request.role, evidenceReferences: ["e-1"], payload: proposalSeed } : { schemaVersion: 1, role: request.role, evidenceReferences: ["e-1"], payload: { result: "verified", hardDenies: [], warnings: [], missingRequirements: [], requiredEscalations: [], policyReferences: ["risk-policy"] } };
    return { requestId: request.requestId, providerId: request.providerId, modelVersionId: request.modelVersionId, promptArtifactDigest: request.promptArtifactDigest, contextHash: request.contextHash, inputHash: request.inputHash, structuredOutput: output, outputHash: aiSha256(output), startedAt: 1, completedAt: 2 };
  });
  const missingCritic = await new MultiAgentOrchestrator(noCritic, { enabled: true, maxRetries: 0 }).run(input({ orchestrationRunId: "critic", decisionId: "critic" }));
  assert.equal(missingCritic.status, "INCOMPLETE");
  assert.equal(missingCritic.productionMutationAllowed, false);
});

test("risk denial is a deterministic veto and AI runtime contains no execution path", async () => {
  const denying = new TransportModelProvider("fixture", "model", async (request) => {
    const payload = request.role === "EVIDENCE_PRODUCER" ? { observations: [{ claim: "verified", claimType: "fact", evidenceReferences: ["e-1"], freshnessStatus: "fresh" }], missingEvidence: [], evidenceBundleHash: request.input.evidenceBundleHash } : request.role === "STRATEGY_PROPOSER" ? proposalSeed : request.role === "ADVERSARIAL_CRITIC" ? { reviewedProposalHash: request.input.proposalHash, counterClaims: [], failedAssumptions: [], missingTests: [], alternativeExplanations: [], severity: "none" } : { result: "denied", hardDenies: ["DETERMINISTIC_RISK_VETO"], warnings: [], missingRequirements: [], requiredEscalations: [], policyReferences: ["risk-policy"] };
    const output = { schemaVersion: 1, role: request.role, evidenceReferences: ["e-1"], payload };
    return { requestId: request.requestId, providerId: request.providerId, modelVersionId: request.modelVersionId, promptArtifactDigest: request.promptArtifactDigest, contextHash: request.contextHash, inputHash: request.inputHash, structuredOutput: output, outputHash: aiSha256(output), startedAt: 1, completedAt: 2 };
  });
  const result = await new MultiAgentOrchestrator(denying, { enabled: true, maxRetries: 0 }).run(input({ orchestrationRunId: "deny", decisionId: "deny" }));
  assert.equal(result.governanceDecision.result, "deny");
  assert.equal(result.governanceDecision.realOrderAuthority, false);
  assert.equal(result.governanceDecision.productionMutationAllowed, false);
  const projection = projectAiReadOnly(result);
  assert.equal(projection.status, "AVAILABLE");
  assert.equal(projection.confidence, 0);
  const fs = require("node:fs");
  const source = fs.readFileSync("apps/cloud/src/ai/multiAgentOrchestrator.ts", "utf8");
  assert.doesNotMatch(source, /PaperBroker|paperBroker|submitOrder\s*\(|cancelOrder\s*\(/i);
});
