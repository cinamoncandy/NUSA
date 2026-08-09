const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");
const { SqliteAiCalibrationDurableStore } = require("../dist/packages/storage/src/aiCalibrationDurability.js");
const {
  OutcomeCalibrationLedger,
  createCalibrationOutcome,
  createCalibrationPrediction
} = require("../dist/apps/cloud/src/ai/outcomeCalibration.js");
const { CalibrationDurabilityRuntime } = require("../dist/apps/cloud/src/ai/calibrationDurabilityRuntime.js");
const { projectAiReadOnly } = require("../dist/apps/cloud/src/ai/projection.js");

const digest = "a".repeat(64);
const horizonMs = 5 * 60 * 1_000;
const graceMs = 60_000;
const predictedAt = 1_700_000_000_000;
const dueAt = predictedAt + horizonMs;
const cohort = Object.freeze({
  providerId: "openai",
  modelVersionId: "model-v1",
  promptArtifactId: "nusa.ai.strategy_proposer",
  promptArtifactVersion: "1.0.0",
  promptArtifactDigest: digest,
  outcomeDefinitionId: "UPBIT_PUBLIC_PRICE_HIGHER_AFTER_5M",
  outcomeDefinitionVersion: "1"
});

const prediction = (id, rawProbability = 0.8) => createCalibrationPrediction({
  predictionId: id,
  orchestrationRunId: `run-${id}`,
  proposalId: `proposal-${id}`,
  agentId: "ai-strategy-proposer",
  role: "STRATEGY_PROPOSER",
  ...cohort,
  targetId: "KRW-BTC",
  anchorValue: 100,
  anchorObservedAt: predictedAt - 10,
  anchorEvidenceReference: `anchor-${id}`,
  rawProbability,
  predictedAt,
  horizonMs,
  provenance: "VERIFIED_RUNTIME"
});

const outcome = (item, result = true) => createCalibrationOutcome({
  predictionId: item.predictionId,
  predictionContentHash: item.contentHash,
  outcomeDefinitionId: item.outcomeDefinitionId,
  outcomeDefinitionVersion: item.outcomeDefinitionVersion,
  outcome: result,
  resolvedValue: result ? 101 : 99,
  resolvedAt: dueAt,
  evidenceReferences: [`evidence-${item.predictionId}`],
  provenance: "VERIFIED_RUNTIME"
});

const tempDb = () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "nusa-ai-calibration-"));
  return { directory, filename: path.join(directory, "calibration.sqlite") };
};

const cleanup = (directory) => fs.rmSync(directory, { recursive: true, force: true });

test("durable calibration journal is idempotent, canonical, secret-minimized, and replayable", () => {
  const { directory, filename } = tempDb();
  try {
    const store = new SqliteAiCalibrationDurableStore(filename);
    const first = prediction("p1");
    const second = prediction("p2", 0.7);
    store.appendPrediction(first, predictedAt + 1);
    store.appendPrediction(first, predictedAt + 1);
    store.appendOutcomeAndResolve(outcome(first), dueAt);
    store.appendOutcomeAndResolve(outcome(first), dueAt);
    store.appendPrediction({ ...second, rawPrompt: "PRIVATE_PROMPT_BODY", apiKey: "example-key" }, predictedAt + 2);

    const replay = store.replay();
    assert.equal(replay.predictions.length, 2);
    assert.equal(replay.outcomes.length, 1);
    assert.equal(replay.eventCount, 3, "exact duplicate replay must not append a new durable event");
    assert.equal(replay.headHash.length, 64);
    assert.throws(() => store.appendPrediction(prediction("p2", 0.6), predictedAt + 3), /conflicting durable calibration prediction replay/);
    store.close();

    const raw = new DatabaseSync(filename);
    const payloads = raw.prepare("SELECT payload_json FROM ai_calibration_durability_events ORDER BY sequence").all().map((row) => String(row.payload_json));
    raw.close();
    assert.equal(payloads.some((payload) => payload.includes("PRIVATE_PROMPT_BODY") || payload.includes("example-key")), false, "non-canonical secret-like extras must never be persisted");
  } finally {
    cleanup(directory);
  }
});

test("restart replay preserves cohort calibration and expires stale pending predictions without credit", () => {
  const { directory, filename } = tempDb();
  try {
    const first = prediction("resolved", 0.8);
    const pending = prediction("pending", 0.8);
    const store1 = new SqliteAiCalibrationDurableStore(filename);
    store1.appendPrediction(first, predictedAt + 1);
    store1.appendOutcomeAndResolve(outcome(first), dueAt);
    store1.appendPrediction(pending, predictedAt + 2);
    store1.close();

    const store2 = new SqliteAiCalibrationDurableStore(filename);
    const ledger2 = new OutcomeCalibrationLedger();
    const recovery2 = new CalibrationDurabilityRuntime(ledger2, store2, dueAt + 10, graceMs);
    assert.equal(recovery2.snapshot().status, "HEALTHY");
    assert.equal(recovery2.snapshot().recoveredPredictionCount, 2);
    assert.equal(recovery2.snapshot().recoveredOutcomeCount, 1);
    assert.equal(recovery2.snapshot().recoveredPendingCount, 1);
    const profile2 = ledger2.profile(cohort, 0.8, { minimumSamples: 1, minimumBucketSamples: 1, maximumExpectedCalibrationError: 1, maximumBrierScore: 1 });
    assert.equal(profile2.sampleCount, 1);
    assert.equal(profile2.status, "CALIBRATED");
    assert.equal(profile2.effectiveConfidence, 0.8);
    store2.close();

    const store3 = new SqliteAiCalibrationDurableStore(filename);
    const ledger3 = new OutcomeCalibrationLedger();
    const recovery3 = new CalibrationDurabilityRuntime(ledger3, store3, dueAt + graceMs + 1, graceMs);
    assert.equal(recovery3.snapshot().status, "HEALTHY");
    assert.equal(recovery3.snapshot().recoveredPendingCount, 0);
    assert.equal(recovery3.snapshot().expiredPendingCount, 1);
    assert.equal(store3.replay().expiredPending[0].predictionId, "pending");
    const profile3 = ledger3.profile(cohort, 0.8, { minimumSamples: 1, minimumBucketSamples: 1, maximumExpectedCalibrationError: 1, maximumBrierScore: 1 });
    assert.equal(profile3.sampleCount, 1, "stale pending expiry must not create calibration credit");
    store3.close();
  } finally {
    cleanup(directory);
  }
});

test("tampered durable history fails closed and projection exposes zero trusted confidence", () => {
  const { directory, filename } = tempDb();
  try {
    const first = prediction("tamper", 0.8);
    const store1 = new SqliteAiCalibrationDurableStore(filename);
    store1.appendPrediction(first, predictedAt + 1);
    store1.appendOutcomeAndResolve(outcome(first), dueAt);
    store1.close();

    const raw = new DatabaseSync(filename);
    raw.prepare("UPDATE ai_calibration_durability_events SET payload_json = ? WHERE sequence = 1").run("{}");
    raw.close();

    const store2 = new SqliteAiCalibrationDurableStore(filename);
    const ledger = new OutcomeCalibrationLedger();
    const recovery = new CalibrationDurabilityRuntime(ledger, store2, dueAt + 10, graceMs);
    assert.equal(recovery.snapshot().status, "UNHEALTHY");
    assert.equal(recovery.snapshot().errorCode, "REPLAY_FAILED");
    assert.equal(recovery.trusted(), false);

    const trustedLedger = new OutcomeCalibrationLedger();
    trustedLedger.appendPrediction(first);
    trustedLedger.appendOutcome(outcome(first));
    const profile = trustedLedger.profile(cohort, 0.8, { minimumSamples: 1, minimumBucketSamples: 1, maximumExpectedCalibrationError: 1, maximumBrierScore: 1 });
    const result = {
      status: "COMPLETED",
      structuredOutputs: [{ role: "STRATEGY_PROPOSER", evidenceReferences: [], payload: { rawProbability: 0.8, rationaleClaims: [] } }],
      runs: [{ agentId: "ai-strategy-proposer", modelVersionId: "model-v1", promptArtifactDigest: digest, completedAt: dueAt }],
      agents: [{ agentId: "ai-strategy-proposer", correlatedGroupId: "model:openai:model-v1", modelVersionId: "model-v1", promptArtifactId: "nusa.ai.strategy_proposer", definitionVersion: "1.0.0" }],
      governanceDecision: null,
      independence: { reasonCodes: [] }
    };
    const projection = projectAiReadOnly(result, profile, recovery.snapshot());
    assert.equal(projection.calibrationDurabilityStatus, "UNHEALTHY");
    assert.equal(projection.calibrationStatus, "UNVERIFIED");
    assert.equal(projection.rawProbability, 0.8);
    assert.equal(projection.calibratedProbability, null);
    assert.equal(projection.effectiveConfidence, 0);
    assert.equal(projection.confidence, 0);
    assert.equal(projection.liveAuthority, "NONE");
    assert.equal(projection.productionMutationAllowed, false);
    store2.close();
  } finally {
    cleanup(directory);
  }
});

test("durable append failure marks calibration unhealthy before in-memory trust can be granted", () => {
  const emptyReplay = Object.freeze({ schemaVersion: 1, predictions: Object.freeze([]), outcomes: Object.freeze([]), expiredPending: Object.freeze([]), eventCount: 0, headHash: "0".repeat(64) });
  const failingStore = {
    replay: () => emptyReplay,
    appendPrediction: () => { throw new Error("disk full"); },
    appendOutcomeAndResolve: () => { throw new Error("disk full"); },
    expirePending: () => { throw new Error("disk full"); }
  };
  const ledger = new OutcomeCalibrationLedger();
  const durability = new CalibrationDurabilityRuntime(ledger, failingStore, predictedAt + 100, graceMs);
  assert.equal(durability.snapshot().status, "HEALTHY");
  const first = prediction("append-failure");
  assert.equal(durability.persistPrediction(first, predictedAt + 101), false);
  assert.equal(durability.snapshot().status, "UNHEALTHY");
  assert.equal(durability.snapshot().errorCode, "APPEND_FAILED");
  assert.equal(durability.trusted(), false);
  const profile = ledger.profile(cohort, 0.8, { minimumSamples: 1, minimumBucketSamples: 1 });
  assert.equal(profile.sampleCount, 0, "failed durable append must not create trusted in-memory calibration history");
  assert.equal(profile.effectiveConfidence, 0);
});
