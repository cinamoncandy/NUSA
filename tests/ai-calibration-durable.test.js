const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { aiSha256 } = require("../dist/packages/contracts/src/aiInference.js");
const { SqliteDatabase } = require("../dist/packages/storage/src/index.js");
const { SqliteAiCalibrationStore } = require("../dist/packages/storage/src/aiCalibrationStore.js");
const { createCalibrationPrediction, createCalibrationOutcome } = require("../dist/apps/cloud/src/ai/outcomeCalibration.js");
const { TransportModelProvider } = require("../dist/apps/cloud/src/ai/modelProvider.js");
const { buildCloudRuntimeAiEvidence } = require("../dist/apps/cloud/src/ai/cloudRuntimeEvidence.js");
const {
  createCloudAiRuntime,
  AI_CALIBRATION_OUTCOME_DEFINITION_ID,
  AI_CALIBRATION_OUTCOME_DEFINITION_VERSION,
  AI_CALIBRATION_HORIZON_MS,
  AI_CALIBRATION_RESOLUTION_GRACE_MS
} = require("../dist/apps/cloud/src/ai/runtime.js");

const firstObservedAt = 1_700_000_000_000;
const secondObservedAt = firstObservedAt + AI_CALIBRATION_HORIZON_MS + 10;
let modelCompletedAt = firstObservedAt + 2;

const withDatabaseFile = async (fn) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "nusa-ai-calibration-"));
  const filename = path.join(directory, "calibration.sqlite");
  try { await fn(filename); }
  finally { fs.rmSync(directory, { recursive: true, force: true }); }
};

const predictionFor = (id, predictedAt = firstObservedAt, anchorValue = 100) => createCalibrationPrediction({
  predictionId: id,
  orchestrationRunId: `orchestration-${id}`,
  proposalId: `proposal-${id}`,
  agentId: "strategy-proposer",
  role: "STRATEGY_PROPOSER",
  providerId: "openai",
  modelVersionId: "model-v1",
  promptArtifactId: "nusa.ai.strategy_proposer",
  promptArtifactVersion: "1.0.0",
  promptArtifactDigest: "a".repeat(64),
  outcomeDefinitionId: AI_CALIBRATION_OUTCOME_DEFINITION_ID,
  outcomeDefinitionVersion: AI_CALIBRATION_OUTCOME_DEFINITION_VERSION,
  targetId: "KRW-BTC",
  anchorValue,
  anchorObservedAt: predictedAt - 1,
  anchorEvidenceReference: `evidence-${id}`,
  rawProbability: 0.8,
  predictedAt,
  horizonMs: AI_CALIBRATION_HORIZON_MS,
  provenance: "VERIFIED_RUNTIME"
});

const evidenceFor = (price, observedAt, market = "KRW-BTC") => buildCloudRuntimeAiEvidence({
  code: market,
  trade_price: price,
  trade_timestamp: observedAt,
  signed_change_rate: 0.01,
  acc_trade_volume: 100
}, {
  mode: "PAPER",
  killSwitchActive: false,
  tradingAllowed: true,
  overallHealth: "HEALTHY",
  p0State: "CLOSED",
  observedAt
});

const provider = new TransportModelProvider("openai", "model-v1", async (request) => {
  const marketEvidenceId = request.input.evidence[0].evidenceId;
  let payload;
  if (request.role === "EVIDENCE_PRODUCER") payload = { observations: [{ claim: "verified market state", claimType: "fact", evidenceReferences: [marketEvidenceId], freshnessStatus: "fresh" }], missingEvidence: [], evidenceBundleHash: request.input.evidenceBundleHash };
  if (request.role === "STRATEGY_PROPOSER") payload = { strategyVersionId: "strategy-preview", decision: "candidate", rationaleClaims: ["candidate"], assumptions: ["paper only"], uncertainty: "medium", rawProbability: 0.8, expectedEffect: "research", costSensitivity: "unknown", capacitySensitivity: "unknown" };
  if (request.role === "ADVERSARIAL_CRITIC") payload = { reviewedProposalHash: request.input.proposalHash, counterClaims: [], failedAssumptions: [], missingTests: [], alternativeExplanations: [], severity: "low" };
  if (request.role === "RISK_VERIFIER") payload = { result: "verified", hardDenies: [], warnings: [], missingRequirements: [], requiredEscalations: [], policyReferences: ["risk-policy"] };
  const output = { schemaVersion: 1, role: request.role, evidenceReferences: [marketEvidenceId], payload };
  return { requestId: request.requestId, providerId: request.providerId, modelVersionId: request.modelVersionId, promptArtifactDigest: request.promptArtifactDigest, contextHash: request.contextHash, inputHash: request.inputHash, structuredOutput: output, outputHash: aiSha256(output), startedAt: modelCompletedAt - 1, completedAt: modelCompletedAt };
});

const waitForRuntime = async (runtime) => {
  for (let attempt = 0; attempt < 50 && runtime.isInFlight(); attempt += 1) await new Promise((resolve) => setImmediate(resolve));
  assert.equal(runtime.isInFlight(), false);
};

const orchestrationInput = (id, observedAt, bundle) => ({
  orchestrationRunId: `durable-${id}`,
  decisionId: `decision-${id}`,
  evaluatedAt: observedAt,
  evidence: bundle.evidence,
  evidenceMaterializations: bundle.evidenceMaterializations,
  policyVersionIds: ["AI_ZERO_AUTHORITY_POLICY_V1"],
  certificationIds: [],
  controlPlaneStateId: "test-paper-safe",
  contextValidForMs: 120_000
});

const runtimeOptions = (now, calibrationPersistence) => ({
  now,
  minimumCadenceMs: 0,
  maximumResultAgeMs: 10_000_000,
  calibrationPersistence,
  calibration: {
    outcomeDefinitionId: AI_CALIBRATION_OUTCOME_DEFINITION_ID,
    outcomeDefinitionVersion: AI_CALIBRATION_OUTCOME_DEFINITION_VERSION,
    horizonMs: AI_CALIBRATION_HORIZON_MS,
    policy: { minimumSamples: 1, minimumBucketSamples: 1, maximumExpectedCalibrationError: 1, maximumBrierScore: 1 }
  }
});

test("durable calibration store is append-only, idempotent, restart-safe, and secret-field minimizing", async () => withDatabaseFile(async (filename) => {
  const db1 = new SqliteDatabase(filename);
  const store1 = new SqliteAiCalibrationStore(db1);
  const prediction = predictionFor("prediction-1");
  store1.recordPrediction({ ...prediction, injectedSecret: "sk-test-must-not-persist" });
  store1.recordPrediction(prediction);
  const eventCount = db1.connection.prepare("SELECT COUNT(*) AS count FROM ai_calibration_events").get().count;
  assert.equal(Number(eventCount), 2, "exact prediction replay must not append duplicate events");
  const persistedPrediction = db1.connection.prepare("SELECT payload_json FROM ai_calibration_events WHERE event_type='PREDICTION'").get().payload_json;
  assert.equal(persistedPrediction.includes("sk-test-must-not-persist"), false);
  assert.equal(store1.recover().pending.length, 1);
  db1.close();

  const db2 = new SqliteDatabase(filename);
  const store2 = new SqliteAiCalibrationStore(db2);
  const recovered = store2.recover();
  assert.equal(recovered.predictions.length, 1);
  assert.equal(recovered.pending.length, 1);
  assert.equal(recovered.predictions[0].contentHash, prediction.contentHash);
  const outcome = createCalibrationOutcome({
    predictionId: prediction.predictionId,
    predictionContentHash: prediction.contentHash,
    outcomeDefinitionId: prediction.outcomeDefinitionId,
    outcomeDefinitionVersion: prediction.outcomeDefinitionVersion,
    outcome: true,
    resolvedValue: 110,
    resolvedAt: prediction.predictedAt + prediction.horizonMs + 10,
    evidenceReferences: ["resolved-ticker"],
    provenance: "VERIFIED_RUNTIME"
  });
  store2.recordOutcome(outcome);
  store2.recordOutcome(outcome);
  assert.equal(store2.recover().pending.length, 0);
  db2.close();

  const db3 = new SqliteDatabase(filename);
  const finalState = new SqliteAiCalibrationStore(db3).recover();
  assert.equal(finalState.predictions.length, 1);
  assert.equal(finalState.outcomes.length, 1);
  assert.equal(finalState.outcomes[0].contentHash, outcome.contentHash);
  assert.equal(finalState.pending.length, 0);
  db3.close();
}));

test("durable calibration store fails closed on payload or head corruption", async () => withDatabaseFile(async (filename) => {
  const db = new SqliteDatabase(filename);
  const store = new SqliteAiCalibrationStore(db);
  store.recordPrediction(predictionFor("corrupt-prediction"));
  db.connection.prepare("UPDATE ai_calibration_events SET payload_json=? WHERE sequence=1").run(JSON.stringify({ predictionId: "tampered" }));
  assert.throws(() => store.recover(), /calibration durable/);
  db.close();

  const cleanDb = new SqliteDatabase(filename + ".head");
  const cleanStore = new SqliteAiCalibrationStore(cleanDb);
  cleanStore.recordPrediction(predictionFor("head-prediction"));
  cleanDb.connection.prepare("UPDATE ai_calibration_state SET ledger_hash=? WHERE id=1").run("f".repeat(64));
  assert.throws(() => cleanStore.recover(), /state head mismatch/);
  cleanDb.close();
}));

test("cloud AI calibration survives restart and verified outcome credit remains deterministic", async () => withDatabaseFile(async (filename) => {
  let runtimeNow = firstObservedAt + 100;
  modelCompletedAt = firstObservedAt + 2;
  const db1 = new SqliteDatabase(filename);
  const runtime1 = createCloudAiRuntime({ NUSA_AI_ENABLED: "true" }, provider, runtimeOptions(() => runtimeNow, new SqliteAiCalibrationStore(db1)));
  const first = evidenceFor(100, firstObservedAt);
  assert.equal(runtime1.schedule(orchestrationInput("restart-first", firstObservedAt, first)), true);
  await waitForRuntime(runtime1);
  const firstPrediction = runtime1.latestCalibrationPrediction();
  assert.ok(firstPrediction);
  assert.equal(runtime1.calibrationProfile().sampleCount, 0);
  db1.close();

  runtimeNow = secondObservedAt + 100;
  modelCompletedAt = secondObservedAt + 2;
  const db2 = new SqliteDatabase(filename);
  const store2 = new SqliteAiCalibrationStore(db2);
  const runtime2 = createCloudAiRuntime({ NUSA_AI_ENABLED: "true" }, provider, runtimeOptions(() => runtimeNow, store2));
  assert.equal(runtime2.latestCalibrationPrediction().predictionId, firstPrediction.predictionId);
  assert.equal(runtime2.calibrationProfile().sampleCount, 0);
  const second = evidenceFor(110, secondObservedAt);
  assert.equal(runtime2.schedule(orchestrationInput("restart-second", secondObservedAt, second)), true);
  assert.equal(runtime2.calibrationProfile().sampleCount, 1, "recovered pending prediction must resolve from verified post-horizon ticker");
  await waitForRuntime(runtime2);
  assert.equal(runtime2.calibrationProfile().sampleCount, 1);
  db2.close();

  const db3 = new SqliteDatabase(filename);
  const runtime3 = createCloudAiRuntime({ NUSA_AI_ENABLED: "true" }, provider, runtimeOptions(() => runtimeNow + 100, new SqliteAiCalibrationStore(db3)));
  const replayed = runtime3.calibrationProfile();
  assert.ok(replayed);
  assert.equal(replayed.sampleCount, 1);
  assert.equal(replayed.status, "CALIBRATED");
  assert.equal(replayed.effectiveConfidence, 0.8);
  assert.equal(runtime3.liveAuthority, "NONE");
  assert.equal(runtime3.productionMutationAllowed, false);
  db3.close();
}));

test("restart expires stale pending prediction without calibration credit", async () => withDatabaseFile(async (filename) => {
  const prediction = predictionFor("stale-prediction");
  const db1 = new SqliteDatabase(filename);
  new SqliteAiCalibrationStore(db1).recordPrediction(prediction);
  db1.close();

  const db2 = new SqliteDatabase(filename);
  const store2 = new SqliteAiCalibrationStore(db2);
  const afterWindow = prediction.predictedAt + prediction.horizonMs + AI_CALIBRATION_RESOLUTION_GRACE_MS + 1;
  const runtime = createCloudAiRuntime({ NUSA_AI_ENABLED: "true" }, provider, runtimeOptions(() => afterWindow, store2));
  assert.equal(store2.recover().pending.length, 0);
  assert.equal(store2.recover().outcomes.length, 0);
  assert.equal(runtime.calibrationProfile().sampleCount, 0);
  assert.equal(runtime.calibrationProfile().effectiveConfidence, 0);
  db2.close();
}));

test("corrupt durable history makes calibration unavailable without changing AI authority", async () => withDatabaseFile(async (filename) => {
  const db = new SqliteDatabase(filename);
  const store = new SqliteAiCalibrationStore(db);
  store.recordPrediction(predictionFor("runtime-corrupt"));
  db.connection.prepare("UPDATE ai_calibration_state SET sequence=sequence+1 WHERE id=1").run();
  const runtime = createCloudAiRuntime({ NUSA_AI_ENABLED: "true" }, provider, runtimeOptions(() => firstObservedAt + 100, store));
  assert.equal(runtime.latestCalibrationPrediction(), null);
  assert.equal(runtime.calibrationProfile(), null);
  assert.equal(runtime.liveAuthority, "NONE");
  assert.equal(runtime.productionMutationAllowed, false);
  db.close();
}));
