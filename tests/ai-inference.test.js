const test = require("node:test");
const assert = require("node:assert/strict");
const { aiSha256 } = require("../dist/packages/contracts/src/aiInference.js");
const { TransportModelProvider, UnavailableModelProvider } = require("../dist/apps/cloud/src/ai/modelProvider.js");
const { AgentExecutor } = require("../dist/apps/cloud/src/ai/agentExecutor.js");
const { PromptArtifactRegistry, createDefaultPromptArtifactRegistry } = require("../dist/apps/cloud/src/ai/promptArtifactRegistry.js");
const { buildEvidenceBundle } = require("../dist/apps/cloud/src/ai/evidenceBundleBuilder.js");
const { createCloudAiRuntime } = require("../dist/apps/cloud/src/ai/runtime.js");
const { createAiHypothesisDraft } = require("../dist/apps/cloud/src/ai/researchHypothesisAgent.js");
const { createAiResearchReview } = require("../dist/apps/cloud/src/ai/researchReviewAgent.js");

const digest = "a".repeat(64);
const request = (overrides = {}) => ({ requestId: "request-1", role: "EVIDENCE_PRODUCER", providerId: "test", modelVersionId: "model-1", promptArtifactId: "prompt-1", promptArtifactVersion: "1.0.0", promptArtifactDigest: digest, contextHash: digest, inputHash: digest, input: Object.freeze({ evidenceIds: ["e-1"] }), maxOutputBytes: 1000, maxTokens: 100, timeoutMs: 50, attempt: 0, ...overrides });
const response = (req, output, overrides = {}) => ({ requestId: req.requestId, providerId: req.providerId, modelVersionId: req.modelVersionId, promptArtifactDigest: req.promptArtifactDigest, contextHash: req.contextHash, inputHash: req.inputHash, structuredOutput: output, outputHash: aiSha256(output), startedAt: 1, completedAt: 2, ...overrides });

test("model executor enforces output hash, size, and bounded failure behavior", async () => {
  const output = { schemaVersion: 1, role: "EVIDENCE_PRODUCER", evidenceReferences: ["e-1"], payload: { observations: [], missingEvidence: [] } };
  const provider = new TransportModelProvider("test", "model-1", async (req) => response(req, output));
  const executed = await new AgentExecutor(provider, 0).execute(request(), (value) => value);
  assert.equal(executed.ok, true);
  const tampered = new TransportModelProvider("test", "model-1", async (req) => response(req, output, { outputHash: digest }));
  const rejected = await new AgentExecutor(tampered, 0).execute(request(), (value) => value);
  assert.equal(rejected.ok, false);
  assert.equal(rejected.failure.code, "SCHEMA_VIOLATION");
  const unavailable = await new AgentExecutor(new UnavailableModelProvider(), 0).execute(request(), (value) => value);
  assert.equal(unavailable.ok, false);
  assert.equal(unavailable.failure.code, "PROVIDER_UNAVAILABLE");
  const timeout = await new AgentExecutor(new TransportModelProvider("test", "model-1", async () => new Promise(() => {})), 0).execute(request({ timeoutMs: 1 }), (value) => value);
  assert.equal(timeout.ok, false);
  assert.equal(timeout.failure.code, "TIMEOUT");
});

test("prompt registry rejects digest mismatch and registers immutable versions", () => {
  const registry = createDefaultPromptArtifactRegistry();
  const artifact = registry.get("nusa.ai.evidence_producer", "1.0.0");
  assert.ok(artifact);
  assert.equal(registry.assertDefinition(artifact.promptArtifactId, artifact.version, artifact.digest).digest, artifact.digest);
  assert.throws(() => registry.assertDefinition(artifact.promptArtifactId, artifact.version, digest), /PROMPT_DIGEST_MISMATCH/);
  const empty = new PromptArtifactRegistry();
  assert.throws(() => empty.register({ ...artifact, digest: digest, prohibitedCapabilities: [] }), /capability policy/);
});

test("evidence bundle exposes only verified evidence and rejects credential references", () => {
  const bundle = buildEvidenceBundle({ contextSnapshotId: "context-1", agentId: "agent-1", evidence: [{ evidenceId: "e-1", evidenceType: "market-data", sourceReference: "market-feed:1", observedAt: 1, validUntil: 100, quality: "verified", contentDigest: digest, lineageReferences: [] }], allowedEvidenceClasses: ["market-data"], evaluatedAt: 2, validUntil: 50, policyVersionIds: ["policy-1"], certificationIds: [], controlPlaneStateId: "control-1" });
  assert.equal(bundle.context.evidenceIds[0], "e-1");
  assert.equal(bundle.context.contextHash.length, 64);
  assert.throws(() => buildEvidenceBundle({ contextSnapshotId: "context-2", agentId: "agent-1", evidence: [{ evidenceId: "e-2", evidenceType: "market-data", sourceReference: "api-key:secret", observedAt: 1, validUntil: 100, quality: "verified", contentDigest: digest, lineageReferences: [] }], allowedEvidenceClasses: ["market-data"], evaluatedAt: 2, validUntil: 50, policyVersionIds: [], certificationIds: [], controlPlaneStateId: "control-1" }), /credential/);
});

test("default cloud AI runtime is disabled and cannot grant authority", () => {
  const runtime = createCloudAiRuntime({ NUSA_AI_ENABLED: "false" });
  assert.equal(runtime.enabled, false);
  assert.equal(runtime.productionMutationAllowed, false);
  return runtime.orchestrator.run({ orchestrationRunId: "run-1", decisionId: "decision-1", evaluatedAt: 10, evidence: [] }).then((result) => {
    assert.equal(result.status, "UNAVAILABLE");
    assert.equal(result.productionMutationAllowed, false);
    assert.equal(result.realOrderAuthority, false);
  });
});

test("AI research records are draft/evidence only", () => {
  const draft = createAiHypothesisDraft({ recordId: "h-1", researchId: "r-1", question: "question", hypothesis: "hypothesis", evidenceReferences: ["e-1"], modelVersionId: "model-1", promptArtifactDigest: digest, createdAt: "2026-08-08T00:00:00.000Z" });
  assert.equal(draft.payload.lifecycle, "DRAFT");
  assert.equal(draft.payload.productionMutationAllowed, false);
  const review = createAiResearchReview({ recordId: "e-1", researchId: "r-1", parentRecordIds: ["h-1"], conclusion: "review", evidenceReferences: ["e-1"], criticSeverity: "low", calibrationError: 0.1, createdAt: "2026-08-08T00:01:00.000Z" });
  assert.equal(review.stage, "EVIDENCE");
  assert.equal(review.payload.promotionAllowed, false);
});
