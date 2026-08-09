const test = require("node:test");
const assert = require("node:assert/strict");
const { mkdtempSync, rmSync } = require("node:fs");
const { join } = require("node:path");
const { tmpdir } = require("node:os");
const { createCalibrationOutcome, createCalibrationPrediction } = require("../dist/apps/cloud/src/ai/outcomeCalibration.js");
const {
  GovernedOutcomeAttributionEngine,
  aiAttributionCalibrationCohortIdentity,
  aiAttributionEvidenceSnapshotIdentity,
  assignAiAttributionPartition,
  assertAiAttributionHoldoutNoLeakage,
  assertSingleAttributionSignalAblation,
  scoreAiAttributionBenchmark,
  verifyAiAttributionEpisode
} = require("../dist/apps/cloud/src/ai/outcomeAttributionLearning.js");
const { SqliteAiOutcomeAttributionMemory } = require("../dist/packages/storage/src/aiOutcomeAttributionMemory.js");

const promptDigest = "a".repeat(64);
const anchorDigest = "b".repeat(64);
const outcomeDigest = "c".repeat(64);
const scenarioPolicyDigest = "d".repeat(64);
const scenarioBaselineDigest = "e".repeat(64);
const scenarioResultDigest = "f".repeat(64);
const horizonMs = 5 * 60 * 1000;
const predictedAt = 1000;
const dueAt = predictedAt + horizonMs;

const policy = Object.freeze({
  schemaVersion: 1,
  policyId: "WO-AI-009-TEST",
  policyVersion: "1",
  allowedCauses: Object.freeze([
    "EVIDENCE_GAP",
    "DATA_QUALITY_FAILURE",
    "MODEL_DISAGREEMENT",
    "CALIBRATION_MISS",
    "SCENARIO_SENSITIVITY_MISS",
    "REGIME_SHIFT_CANDIDATE",
    "UNRESOLVED"
  ]),
  holdoutSalt: "holdout-v1",
  holdoutPercent: 20,
  defaultEpisodeTtlMs: 60 * 60 * 1000
});

function prediction(id, rawProbability = 0.8, provenance = "VERIFIED_RUNTIME") {
  return createCalibrationPrediction({
    predictionId: id,
    orchestrationRunId: `run-${id}`,
    proposalId: `proposal-${id}`,
    agentId: "ai-strategy-proposer",
    role: "STRATEGY_PROPOSER",
    providerId: "openai",
    modelVersionId: "model-v1",
    promptArtifactId: "nusa.ai.strategy_proposer",
    promptArtifactVersion: "1.0.0",
    promptArtifactDigest: promptDigest,
    outcomeDefinitionId: "UPBIT_PUBLIC_PRICE_HIGHER_AFTER_5M",
    outcomeDefinitionVersion: "1",
    targetId: "KRW-BTC",
    anchorValue: 100,
    anchorObservedAt: 900,
    anchorEvidenceReference: `anchor-${id}`,
    rawProbability,
    predictedAt,
    horizonMs,
    provenance
  });
}

function outcome(predictionValue, result = false, provenance = predictionValue.provenance) {
  return createCalibrationOutcome({
    predictionId: predictionValue.predictionId,
    predictionContentHash: predictionValue.contentHash,
    outcomeDefinitionId: predictionValue.outcomeDefinitionId,
    outcomeDefinitionVersion: predictionValue.outcomeDefinitionVersion,
    outcome: result,
    resolvedValue: result ? 101 : 99,
    resolvedAt: dueAt,
    evidenceReferences: [`outcome-${predictionValue.predictionId}`],
    provenance
  });
}

function evidence(predictionValue, provenance = predictionValue.provenance) {
  return Object.freeze([
    Object.freeze({ evidenceId: predictionValue.anchorEvidenceReference, contentDigest: anchorDigest, provenance }),
    Object.freeze({ evidenceId: `outcome-${predictionValue.predictionId}`, contentDigest: outcomeDigest, provenance })
  ]);
}

function baseSignals(overrides = {}) {
  return Object.freeze({
    evidenceGapEvidenceReferences: Object.freeze([]),
    dataQualityFailureEvidenceReferences: Object.freeze([]),
    providerComparisonState: "CONSENSUS",
    calibrationStatus: "CALIBRATED",
    scenarioRobustnessState: null,
    regimeShiftEvidenceReferences: Object.freeze([]),
    counterEvidenceReferences: Object.freeze([]),
    modelSelfReportedCause: null,
    providerMajorityCause: null,
    ...overrides
  });
}

function request(id, overrides = {}) {
  const p = overrides.prediction ?? prediction(id, overrides.rawProbability ?? 0.8, overrides.provenance ?? "VERIFIED_RUNTIME");
  const o = overrides.outcome ?? outcome(p, overrides.outcomeResult ?? false, overrides.provenance ?? p.provenance);
  const observedEvidence = overrides.observedEvidence ?? evidence(p, p.provenance);
  const signals = overrides.signals ?? baseSignals();
  const scenario = overrides.scenario ?? null;
  return Object.freeze({
    episodeId: overrides.episodeId ?? `episode-${id}`,
    prediction: p,
    outcome: o,
    observedEvidence,
    lineage: Object.freeze({
      providerId: overrides.providerId ?? p.providerId,
      modelVersionId: overrides.modelVersionId ?? p.modelVersionId,
      promptArtifactId: overrides.promptArtifactId ?? p.promptArtifactId,
      promptArtifactVersion: overrides.promptArtifactVersion ?? p.promptArtifactVersion,
      promptArtifactDigest: overrides.promptArtifactDigest ?? p.promptArtifactDigest,
      calibrationCohortIdentity: overrides.calibrationCohortIdentity ?? aiAttributionCalibrationCohortIdentity(p),
      evidenceSnapshotIdentity: overrides.evidenceSnapshotIdentity ?? aiAttributionEvidenceSnapshotIdentity(p, o, observedEvidence),
      ...(scenario == null ? {} : { scenario })
    }),
    signals,
    scope: overrides.scope ?? "KRW-BTC:5m",
    createdAt: overrides.createdAt ?? 400000,
    ...(overrides.expiresAt == null ? {} : { expiresAt: overrides.expiresAt }),
    ...(overrides.supersedesEpisodeId == null ? {} : { supersedesEpisodeId: overrides.supersedesEpisodeId })
  });
}

function scenario(state = "SENSITIVE") {
  return Object.freeze({
    experimentId: "scenario-exp-1",
    policyIdentity: scenarioPolicyDigest,
    baselineIdentity: scenarioBaselineDigest,
    resultIdentity: scenarioResultDigest,
    robustnessState: state,
    provenance: "HYPOTHETICAL_ANALYSIS"
  });
}

test("single structural evidence-gap miss is identified and verified-runtime credit remains zero-authority", () => {
  const engine = new GovernedOutcomeAttributionEngine(policy);
  const episode = engine.analyze(request("single-gap", { signals: baseSignals({ evidenceGapEvidenceReferences: Object.freeze(["missing-macro-release"]) }) }));
  assert.equal(episode.strength, "IDENTIFIED");
  assert.equal(episode.primaryCause, "EVIDENCE_GAP");
  assert.equal(episode.realizedLearningCreditAllowed, true);
  assert.equal(episode.liveAuthority, "NONE");
  assert.equal(episode.realOrderAuthority, false);
  assert.equal(episode.realTransferAuthority, false);
  assert.equal(episode.productionMutationAllowed, false);
  assert.equal(verifyAiAttributionEpisode(episode), true);
});

test("ambiguous multi-cause evidence prefers unresolved over post-hoc certainty", () => {
  const engine = new GovernedOutcomeAttributionEngine(policy);
  const episode = engine.analyze(request("ambiguous", { signals: baseSignals({ evidenceGapEvidenceReferences: Object.freeze(["missing-news"]), dataQualityFailureEvidenceReferences: Object.freeze(["stale-ticker"]) }) }));
  assert.equal(episode.strength, "UNRESOLVED");
  assert.equal(episode.primaryCause, null);
  assert.equal(episode.candidates.length, 2);
  assert.ok(episode.reasonCodes.includes("AMBIGUOUS_MULTI_CAUSE"));
  assert.equal(episode.realizedLearningCreditAllowed, false);
});

test("model self-rating and provider majority are ignored as causal proof", () => {
  const engine = new GovernedOutcomeAttributionEngine(policy);
  const episode = engine.analyze(request("narrative", { signals: baseSignals({ modelSelfReportedCause: "REGIME_SHIFT_CANDIDATE", providerMajorityCause: "CALIBRATION_MISS" }) }));
  assert.equal(episode.strength, "UNRESOLVED");
  assert.equal(episode.primaryCause, null);
  assert.equal(episode.candidates.length, 0);
  assert.ok(episode.reasonCodes.includes("MODEL_SELF_REPORT_IGNORED_FOR_CAUSALITY"));
  assert.ok(episode.reasonCodes.includes("PROVIDER_MAJORITY_IGNORED_FOR_CAUSALITY"));
});

test("provider disagreement and scenario sensitivity are corroboration-only, not realized causal credit", () => {
  const engine = new GovernedOutcomeAttributionEngine(policy);
  const disagreement = engine.analyze(request("disagreement", { signals: baseSignals({ providerComparisonState: "DISAGREEMENT" }) }));
  assert.equal(disagreement.strength, "PARTIALLY_IDENTIFIED");
  assert.equal(disagreement.primaryCause, "MODEL_DISAGREEMENT");
  assert.equal(disagreement.realizedLearningCreditAllowed, false);

  const scenarioLineage = scenario("SENSITIVE");
  const sensitive = engine.analyze(request("scenario", { scenario: scenarioLineage, signals: baseSignals({ scenarioRobustnessState: "SENSITIVE" }) }));
  assert.equal(sensitive.strength, "PARTIALLY_IDENTIFIED");
  assert.equal(sensitive.primaryCause, "SCENARIO_SENSITIVITY_MISS");
  assert.equal(sensitive.realizedLearningCreditAllowed, false);
  assert.ok(sensitive.reasonCodes.includes("HYPOTHETICAL_SCENARIO_CORROBORATION_ONLY"));
});

test("scenario-sensitive and calibration-only misses remain distinguishable", () => {
  const engine = new GovernedOutcomeAttributionEngine(policy);
  const calibration = engine.analyze(request("calibration", { signals: baseSignals({ calibrationStatus: "DEGRADED" }) }));
  assert.equal(calibration.primaryCause, "CALIBRATION_MISS");
  assert.equal(calibration.strength, "PARTIALLY_IDENTIFIED");
  const scenarioOnly = engine.analyze(request("scenario-only", { scenario: scenario("SENSITIVE"), signals: baseSignals({ scenarioRobustnessState: "SENSITIVE" }) }));
  assert.equal(scenarioOnly.primaryCause, "SCENARIO_SENSITIVITY_MISS");
  const ambiguous = engine.analyze(request("scenario-plus-calibration", { scenario: scenario("SENSITIVE"), signals: baseSignals({ calibrationStatus: "DEGRADED", scenarioRobustnessState: "SENSITIVE" }) }));
  assert.equal(ambiguous.strength, "UNRESOLVED");
  assert.equal(ambiguous.primaryCause, null);
});

test("synthetic fixtures can test engine correctness but never receive realized-market learning credit", () => {
  const p = prediction("synthetic", 0.8, "SYNTHETIC_TEST");
  const episode = new GovernedOutcomeAttributionEngine(policy).analyze(request("synthetic", { prediction: p, outcome: outcome(p, false, "SYNTHETIC_TEST"), observedEvidence: evidence(p, "SYNTHETIC_TEST"), provenance: "SYNTHETIC_TEST", signals: baseSignals({ dataQualityFailureEvidenceReferences: Object.freeze(["fixture-bad-data"]) }) }));
  assert.equal(episode.strength, "IDENTIFIED");
  assert.equal(episode.primaryCause, "DATA_QUALITY_FAILURE");
  assert.equal(episode.sourceProvenance, "SYNTHETIC_TEST");
  assert.equal(episode.realizedLearningCreditAllowed, false);
  assert.ok(episode.reasonCodes.includes("SYNTHETIC_NO_REALIZED_LEARNING_CREDIT"));
});

test("prediction outcome evidence prompt provider model calibration and scenario lineage tampering fail closed", () => {
  const engine = new GovernedOutcomeAttributionEngine(policy);
  const valid = request("tamper", { signals: baseSignals({ evidenceGapEvidenceReferences: Object.freeze(["missing"] ) }) });
  assert.throws(() => engine.analyze({ ...valid, prediction: { ...valid.prediction, rawProbability: 0.1 } }), /prediction hash mismatch/);
  assert.throws(() => engine.analyze({ ...valid, outcome: { ...valid.outcome, resolvedValue: 123 } }), /outcome hash mismatch/);
  assert.throws(() => engine.analyze(request("provider-tamper", { providerId: "other-provider" })), /provider lineage mismatch/);
  assert.throws(() => engine.analyze(request("prompt-tamper", { promptArtifactDigest: "0".repeat(64) })), /prompt digest lineage mismatch/);
  assert.throws(() => engine.analyze(request("cohort-tamper", { calibrationCohortIdentity: "0".repeat(64) })), /calibration cohort lineage mismatch/);
  assert.throws(() => engine.analyze(request("evidence-tamper", { evidenceSnapshotIdentity: "0".repeat(64) })), /evidence snapshot lineage mismatch/);
  assert.throws(() => engine.analyze(request("scenario-tamper", { scenario: scenario("ROBUST"), signals: baseSignals({ scenarioRobustnessState: "SENSITIVE" }) })), /scenario attribution lineage state mismatch/);
});

test("exact duplicate attribution replay is idempotent and changed replay identity fails closed", () => {
  const engine = new GovernedOutcomeAttributionEngine(policy);
  const input = request("replay", { signals: baseSignals({ evidenceGapEvidenceReferences: Object.freeze(["missing"] ) }) });
  const first = engine.analyze(input);
  assert.equal(engine.analyze(input), first);
  assert.throws(() => engine.analyze({ ...input, signals: baseSignals({ dataQualityFailureEvidenceReferences: Object.freeze(["bad"] ) }) }), /replay conflict/);
});

test("holdout partition identity is deterministic and train-evaluation leakage fails the gate", () => {
  const train = [];
  const holdout = [];
  for (let i = 0; i < 10000 && (train.length < 2 || holdout.length < 2); i += 1) {
    const id = `case-${i}`;
    (assignAiAttributionPartition(policy, id) === "HOLDOUT" ? holdout : train).push(id);
  }
  assert.equal(train.length >= 2, true);
  assert.equal(holdout.length >= 2, true);
  assert.doesNotThrow(() => assertAiAttributionHoldoutNoLeakage(policy, train.slice(0, 2), holdout.slice(0, 2)));
  assert.throws(() => assertAiAttributionHoldoutNoLeakage(policy, [train[0]], [train[0]]), /leakage/);
  assert.throws(() => assertAiAttributionHoldoutNoLeakage(policy, [holdout[0]], [holdout[1]]), /training case assigned to holdout/);
});

test("governed ablation accepts exactly one changed signal dimension", () => {
  const before = baseSignals();
  const afterOne = baseSignals({ calibrationStatus: "DEGRADED" });
  assert.equal(assertSingleAttributionSignalAblation(before, afterOne), "calibrationStatus");
  assert.throws(() => assertSingleAttributionSignalAblation(before, before), /exactly one/);
  assert.throws(() => assertSingleAttributionSignalAblation(before, baseSignals({ calibrationStatus: "DEGRADED", providerComparisonState: "DISAGREEMENT" })), /exactly one/);
});

test("immutable sqlite learning memory survives restart, preserves history and retrieves only active advisory lessons", () => {
  const root = mkdtempSync(join(tmpdir(), "nusa-ai009-memory-"));
  const filename = join(root, "learning.db");
  try {
    const engine = new GovernedOutcomeAttributionEngine(policy);
    const first = engine.analyze(request("memory-1", { episodeId: "lesson-1", createdAt: 400000, expiresAt: 800000, signals: baseSignals({ evidenceGapEvidenceReferences: Object.freeze(["missing"] ) }) }));
    const second = engine.analyze(request("memory-2", { episodeId: "lesson-2", createdAt: 500000, expiresAt: 900000, supersedesEpisodeId: "lesson-1", signals: baseSignals({ dataQualityFailureEvidenceReferences: Object.freeze(["bad-data"] ) }) }));
    let store = new SqliteAiOutcomeAttributionMemory(filename);
    store.appendEpisode(first);
    store.appendEpisode(first);
    store.appendEpisode(second);
    assert.equal(store.replay().episodes.length, 2);
    let lessons = store.applicableLessons("KRW-BTC:5m", 600000);
    assert.equal(lessons.length, 1);
    assert.equal(lessons[0].episodeId, "lesson-2");
    assert.equal(lessons[0].advisoryOnly, true);
    assert.equal(lessons[0].liveAuthority, "NONE");
    assert.equal(lessons[0].productionMutationAllowed, false);
    store.close();

    store = new SqliteAiOutcomeAttributionMemory(filename);
    assert.equal(store.replay().episodes.length, 2);
    lessons = store.applicableLessons("KRW-BTC:5m", 950000);
    assert.equal(lessons.length, 0, "expired lessons must not be retrieved as active guidance");
    assert.throws(() => store.appendEpisode({ ...second, contentHash: "0".repeat(64) }), /content hash mismatch/);
    store.close();
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("secret-like content is rejected before durable learning memory creation", () => {
  const engine = new GovernedOutcomeAttributionEngine(policy);
  assert.throws(() => engine.analyze(request("secret", { scope: "Authorization: Bearer abc123", signals: baseSignals({ evidenceGapEvidenceReferences: Object.freeze(["missing"]) }) })), /secret-like material/);
});

test("benchmark metrics separate known-cause recovery, ambiguity abstention and false attribution", () => {
  const metrics = scoreAiAttributionBenchmark([
    { caseId: "known", expectedCause: "EVIDENCE_GAP", expectedAmbiguous: false, actualStrength: "IDENTIFIED", actualCause: "EVIDENCE_GAP" },
    { caseId: "ambiguous", expectedCause: null, expectedAmbiguous: true, actualStrength: "UNRESOLVED", actualCause: null },
    { caseId: "negative", expectedCause: null, expectedAmbiguous: false, actualStrength: "UNRESOLVED", actualCause: null }
  ]);
  assert.equal(metrics.knownCauseAccuracy, 1);
  assert.equal(metrics.ambiguityAbstentionAccuracy, 1);
  assert.equal(metrics.falseAttributionRate, 0);
  assert.equal(metrics.unresolvedRate, 2 / 3);
});
