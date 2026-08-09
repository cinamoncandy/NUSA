const test = require("node:test");
const assert = require("node:assert/strict");
const { createVerifiedRuntimeCalibrationPrediction } = require("../dist/apps/cloud/src/ai/calibrationBridge.js");
const { verifyCalibrationPrediction } = require("../dist/apps/cloud/src/ai/outcomeCalibration.js");

const digest = "a".repeat(64);
const promptArtifactId = "nusa.ai.strategy_proposer";
const result = (overrides = {}) => ({
  status: "COMPLETED", orchestrationRunId: "orchestration-1", governanceDecision: null, independence: null,
  agents: [{ agentId: "ai-strategy-proposer", modelVersionId: "model-v1", definitionVersion: "1.0.0", promptArtifactId, promptArtifactDigest: digest, correlatedGroupId: "model:openai:model-v1" }], contexts: [],
  runs: [{ agentRunId: "orchestration-1:run:ai-strategy-proposer", agentId: "ai-strategy-proposer", orchestrationRunId: "orchestration-1", agentDefinitionVersion: "1.0.0", modelVersionId: "model-v1", promptArtifactDigest: digest, contextSnapshotId: "ctx", inputHash: digest, outputHash: digest, status: "completed", schemaValidationPassed: true, evidenceValidationPassed: true, startedAt: 100, completedAt: 120 }],
  failureCodes: [], outputHashes: [], structuredOutputs: [{ schemaVersion: 1, role: "STRATEGY_PROPOSER", evidenceReferences: ["market-e-1"], payload: { rawProbability: 0.73 } }],
  liveAuthority: "NONE", realOrderAuthority: false, realTransferAuthority: false, productionMutationAllowed: false, ...overrides
});
const options = { providerId: "openai", outcomeDefinitionId: "next-period-positive", outcomeDefinitionVersion: "1", horizonMs: 60_000, targetId: "KRW-BTC", anchorValue: 100, anchorObservedAt: 100, anchorEvidenceReference: "market-e-1" };

test("verified proposer output becomes an immutable calibration prediction identity", () => {
  const prediction = createVerifiedRuntimeCalibrationPrediction(result(), options);
  assert.equal(prediction.predictionId, "orchestration-1:run:ai-strategy-proposer:proposal:next-period-positive@1");
  assert.equal(prediction.orchestrationRunId, "orchestration-1");
  assert.equal(prediction.proposalId, "orchestration-1:run:ai-strategy-proposer:proposal");
  assert.equal(prediction.agentId, "ai-strategy-proposer");
  assert.equal(prediction.role, "STRATEGY_PROPOSER");
  assert.equal(prediction.providerId, "openai");
  assert.equal(prediction.modelVersionId, "model-v1");
  assert.equal(prediction.promptArtifactId, promptArtifactId);
  assert.equal(prediction.promptArtifactVersion, "1.0.0");
  assert.equal(prediction.promptArtifactDigest, digest);
  assert.equal(prediction.targetId, "KRW-BTC");
  assert.equal(prediction.anchorValue, 100);
  assert.equal(prediction.anchorObservedAt, 100);
  assert.equal(prediction.anchorEvidenceReference, "market-e-1");
  assert.equal(prediction.rawProbability, 0.73);
  assert.equal(prediction.predictedAt, 120);
  assert.equal(prediction.horizonMs, 60_000);
  assert.equal(prediction.provenance, "VERIFIED_RUNTIME");
  assert.equal(verifyCalibrationPrediction(prediction), true);
});

test("bridge refuses incomplete, failed, missing, mismatched, ungrounded, or invalid proposer output", () => {
  assert.throws(() => createVerifiedRuntimeCalibrationPrediction(result({ status: "INCOMPLETE" }), options), /completed orchestration/);
  assert.throws(() => createVerifiedRuntimeCalibrationPrediction(result({ runs: [] }), options), /verified strategy proposer run/);
  assert.throws(() => createVerifiedRuntimeCalibrationPrediction(result({ agents: [] }), options), /verified strategy proposer run/);
  assert.throws(() => createVerifiedRuntimeCalibrationPrediction(result({ structuredOutputs: [] }), options), /verified strategy proposer run/);
  assert.throws(() => createVerifiedRuntimeCalibrationPrediction(result({ agents: [{ ...result().agents[0], promptArtifactDigest: "b".repeat(64) }] }), options), /identity mismatch/);
  assert.throws(() => createVerifiedRuntimeCalibrationPrediction(result({ agents: [{ ...result().agents[0], correlatedGroupId: "model:other:model-v1" }] }), options), /provider identity mismatch/);
  assert.throws(() => createVerifiedRuntimeCalibrationPrediction(result({ structuredOutputs: [{ schemaVersion: 1, role: "STRATEGY_PROPOSER", evidenceReferences: [], payload: { rawProbability: 0.7 } }] }), options), /anchor must be referenced/);
  assert.throws(() => createVerifiedRuntimeCalibrationPrediction(result({ structuredOutputs: [{ schemaVersion: 1, role: "STRATEGY_PROPOSER", evidenceReferences: ["market-e-1"], payload: { rawProbability: 2 } }] }), options), /within \[0,1\]/);
  assert.throws(() => createVerifiedRuntimeCalibrationPrediction(result(), { ...options, horizonMs: 0 }), /positive safe integer/);
  assert.throws(() => createVerifiedRuntimeCalibrationPrediction(result(), { ...options, anchorObservedAt: 121 }), /cannot postdate proposer completion/);
});
