const test = require("node:test");
const assert = require("node:assert/strict");
const {
  OutcomeCalibrationLedger,
  createCalibrationOutcome,
  createCalibrationPrediction
} = require("../dist/apps/cloud/src/ai/outcomeCalibration.js");
const { CalibrationDurabilityRuntime } = require("../dist/apps/cloud/src/ai/calibrationDurabilityRuntime.js");

const digest = "b".repeat(64);
const horizonMs = 5 * 60 * 1_000;
const graceMs = 60_000;
const predictedAt = 1_700_100_000_000;
const dueAt = predictedAt + horizonMs;

const prediction = createCalibrationPrediction({
  predictionId: "future-chronology-prediction",
  orchestrationRunId: "future-chronology-run",
  proposalId: "future-chronology-proposal",
  agentId: "ai-strategy-proposer",
  role: "STRATEGY_PROPOSER",
  providerId: "openai",
  modelVersionId: "model-v1",
  promptArtifactId: "nusa.ai.strategy_proposer",
  promptArtifactVersion: "1.0.0",
  promptArtifactDigest: digest,
  outcomeDefinitionId: "UPBIT_PUBLIC_PRICE_HIGHER_AFTER_5M",
  outcomeDefinitionVersion: "1",
  targetId: "KRW-BTC",
  anchorValue: 100,
  anchorObservedAt: predictedAt - 10,
  anchorEvidenceReference: "future-chronology-anchor",
  rawProbability: 0.8,
  predictedAt,
  horizonMs,
  provenance: "VERIFIED_RUNTIME"
});

const outcome = createCalibrationOutcome({
  predictionId: prediction.predictionId,
  predictionContentHash: prediction.contentHash,
  outcomeDefinitionId: prediction.outcomeDefinitionId,
  outcomeDefinitionVersion: prediction.outcomeDefinitionVersion,
  outcome: true,
  resolvedValue: 101,
  resolvedAt: dueAt,
  evidenceReferences: ["future-chronology-outcome"],
  provenance: "VERIFIED_RUNTIME"
});

const replayStore = (replay) => ({
  replay: () => replay,
  appendPrediction: () => {},
  appendOutcomeAndResolve: () => {},
  expirePending: () => {}
});

const snapshot = ({ predictions = [], outcomes = [], expiredPending = [] }) => Object.freeze({
  schemaVersion: 1,
  predictions: Object.freeze(predictions),
  outcomes: Object.freeze(outcomes),
  expiredPending: Object.freeze(expiredPending),
  eventCount: predictions.length + outcomes.length + expiredPending.length,
  headHash: "0".repeat(64)
});

const assertReplayFailed = (replay, recoveryNow) => {
  const runtime = new CalibrationDurabilityRuntime(
    new OutcomeCalibrationLedger(),
    replayStore(replay),
    recoveryNow,
    graceMs
  );
  assert.equal(runtime.snapshot().status, "UNHEALTHY");
  assert.equal(runtime.snapshot().errorCode, "REPLAY_FAILED");
  assert.equal(runtime.trusted(), false);
  assert.equal(runtime.recovered().pendingPredictions.length, 0);
};

test("startup replay rejects durable predictions from the future", () => {
  assertReplayFailed(snapshot({ predictions: [prediction] }), predictedAt - 1);
});

test("startup replay rejects durable outcomes from the future", () => {
  assertReplayFailed(snapshot({ predictions: [prediction], outcomes: [outcome] }), dueAt - 1);
});

test("startup replay rejects durable expiry timestamps from the future", () => {
  const recoveryNow = dueAt + graceMs + 1;
  assertReplayFailed(snapshot({
    predictions: [prediction],
    expiredPending: [{
      predictionId: prediction.predictionId,
      predictionContentHash: prediction.contentHash,
      expiredAt: recoveryNow + 1
    }]
  }), recoveryNow);
});
