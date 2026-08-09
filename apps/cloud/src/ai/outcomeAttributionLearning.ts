import {
  aiSha256,
  isAiSha256,
  type AiCalibrationCohortKey
} from "../../../../packages/contracts/src/aiInference";
import type {
  AiAttributionBenchmarkMetrics,
  AiAttributionBenchmarkObservation,
  AiAttributionCandidate,
  AiAttributionCause,
  AiAttributionEpisode,
  AiAttributionPartition,
  AiAttributionPolicy,
  AiAttributionRequest,
  AiAttributionSignals,
  AiObservedEvidenceIdentity
} from "../../../../packages/contracts/src/aiOutcomeAttribution";
import {
  OutcomeCalibrationLedger,
  verifyCalibrationOutcome,
  verifyCalibrationPrediction
} from "./outcomeCalibration";

const requiredText = (value: unknown, field: string): string => {
  if (typeof value !== "string" || value.trim() === "") throw new Error(`${field} is required`);
  return value.trim();
};

const sha256 = (value: unknown, field: string): string => {
  if (!isAiSha256(value)) throw new Error(`${field} must be sha256`);
  return value.toLowerCase();
};

const nonNegativeInteger = (value: unknown, field: string): number => {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) throw new Error(`${field} must be a non-negative safe integer`);
  return value;
};

const positiveInteger = (value: unknown, field: string): number => {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1) throw new Error(`${field} must be a positive safe integer`);
  return value;
};

const uniqueTexts = (values: readonly string[], field: string): readonly string[] => Object.freeze(
  [...new Set(values.map((value) => requiredText(value, field)))].sort()
);

const forbiddenMemoryText = /(authorization|bearer\s|api[_-]?key|credential|private[_-]?key|access[_-]?key|secret[_-]?key)/i;

function assertSecretFree(value: unknown): void {
  const serialized = JSON.stringify(value);
  if (forbiddenMemoryText.test(serialized)) throw new Error("attribution payload contains forbidden secret-like material");
}

export function normalizeAiAttributionPolicy(policy: AiAttributionPolicy): AiAttributionPolicy {
  if (policy.schemaVersion !== 1) throw new Error("AI attribution policy schemaVersion is unsupported");
  const allowedCauses = Object.freeze([...new Set(policy.allowedCauses)]);
  const valid = new Set<AiAttributionCause>([
    "EVIDENCE_GAP",
    "DATA_QUALITY_FAILURE",
    "MODEL_DISAGREEMENT",
    "CALIBRATION_MISS",
    "SCENARIO_SENSITIVITY_MISS",
    "REGIME_SHIFT_CANDIDATE",
    "UNRESOLVED"
  ]);
  if (allowedCauses.length === 0 || allowedCauses.some((cause) => !valid.has(cause))) throw new Error("AI attribution policy allowedCauses are invalid");
  const holdoutPercent = positiveInteger(policy.holdoutPercent, "holdoutPercent");
  if (holdoutPercent >= 100) throw new Error("holdoutPercent must be below 100");
  return Object.freeze({
    schemaVersion: 1,
    policyId: requiredText(policy.policyId, "policyId"),
    policyVersion: requiredText(policy.policyVersion, "policyVersion"),
    allowedCauses,
    holdoutSalt: requiredText(policy.holdoutSalt, "holdoutSalt"),
    holdoutPercent,
    defaultEpisodeTtlMs: positiveInteger(policy.defaultEpisodeTtlMs, "defaultEpisodeTtlMs")
  });
}

export function aiAttributionPolicyIdentity(policy: AiAttributionPolicy): string {
  const normalized = normalizeAiAttributionPolicy(policy);
  return aiSha256({
    schemaVersion: normalized.schemaVersion,
    policyId: normalized.policyId,
    policyVersion: normalized.policyVersion,
    allowedCauses: [...normalized.allowedCauses].sort(),
    holdoutSalt: normalized.holdoutSalt,
    holdoutPercent: normalized.holdoutPercent,
    defaultEpisodeTtlMs: normalized.defaultEpisodeTtlMs
  });
}

function calibrationCohort(prediction: AiAttributionRequest["prediction"]): AiCalibrationCohortKey {
  return Object.freeze({
    providerId: requiredText(prediction.providerId, "providerId"),
    modelVersionId: requiredText(prediction.modelVersionId, "modelVersionId"),
    promptArtifactId: requiredText(prediction.promptArtifactId, "promptArtifactId"),
    promptArtifactVersion: requiredText(prediction.promptArtifactVersion, "promptArtifactVersion"),
    promptArtifactDigest: sha256(prediction.promptArtifactDigest, "promptArtifactDigest"),
    outcomeDefinitionId: requiredText(prediction.outcomeDefinitionId, "outcomeDefinitionId"),
    outcomeDefinitionVersion: requiredText(prediction.outcomeDefinitionVersion, "outcomeDefinitionVersion")
  });
}

export function aiAttributionCalibrationCohortIdentity(prediction: AiAttributionRequest["prediction"]): string {
  return aiSha256(calibrationCohort(prediction));
}

function normalizeObservedEvidence(values: readonly AiObservedEvidenceIdentity[], expectedProvenance: "VERIFIED_RUNTIME" | "SYNTHETIC_TEST"): readonly AiObservedEvidenceIdentity[] {
  if (values.length === 0) throw new Error("observed evidence is required");
  const byId = new Map<string, AiObservedEvidenceIdentity>();
  for (const value of values) {
    const normalized = Object.freeze({
      evidenceId: requiredText(value.evidenceId, "evidenceId"),
      contentDigest: sha256(value.contentDigest, "evidence contentDigest"),
      provenance: value.provenance
    });
    if (normalized.provenance !== expectedProvenance) throw new Error("observed evidence provenance mismatch");
    const prior = byId.get(normalized.evidenceId);
    if (prior != null && prior.contentDigest !== normalized.contentDigest) throw new Error("conflicting observed evidence identity");
    byId.set(normalized.evidenceId, normalized);
  }
  return Object.freeze([...byId.values()].sort((a, b) => a.evidenceId.localeCompare(b.evidenceId)));
}

export function aiAttributionEvidenceSnapshotIdentity(
  prediction: AiAttributionRequest["prediction"],
  outcome: AiAttributionRequest["outcome"],
  observedEvidence: readonly AiObservedEvidenceIdentity[]
): string {
  const normalized = normalizeObservedEvidence(observedEvidence, prediction.provenance);
  const ids = new Set(normalized.map((item) => item.evidenceId));
  if (!ids.has(requiredText(prediction.anchorEvidenceReference, "anchorEvidenceReference"))) throw new Error("prediction anchor evidence is missing from attribution snapshot");
  for (const reference of outcome.evidenceReferences) {
    if (!ids.has(requiredText(reference, "outcome evidenceReference"))) throw new Error("outcome evidence is missing from attribution snapshot");
  }
  return aiSha256({
    predictionAnchorEvidenceReference: prediction.anchorEvidenceReference,
    outcomeEvidenceReferences: uniqueTexts(outcome.evidenceReferences, "outcome evidenceReference"),
    observedEvidence: normalized
  });
}

function normalizedSignals(signals: AiAttributionSignals): AiAttributionSignals {
  return Object.freeze({
    evidenceGapEvidenceReferences: uniqueTexts(signals.evidenceGapEvidenceReferences, "evidence gap reference"),
    dataQualityFailureEvidenceReferences: uniqueTexts(signals.dataQualityFailureEvidenceReferences, "data quality reference"),
    providerComparisonState: signals.providerComparisonState,
    calibrationStatus: signals.calibrationStatus,
    scenarioRobustnessState: signals.scenarioRobustnessState,
    regimeShiftEvidenceReferences: uniqueTexts(signals.regimeShiftEvidenceReferences, "regime shift reference"),
    counterEvidenceReferences: uniqueTexts(signals.counterEvidenceReferences, "counterevidence reference"),
    modelSelfReportedCause: signals.modelSelfReportedCause,
    providerMajorityCause: signals.providerMajorityCause
  });
}

function candidate(
  cause: AiAttributionCause,
  supportingEvidenceReferences: readonly string[],
  counterEvidenceReferences: readonly string[],
  corroborationOnly: boolean
): AiAttributionCandidate {
  return Object.freeze({
    cause,
    supportingEvidenceReferences: uniqueTexts(supportingEvidenceReferences, "supporting evidence reference"),
    counterEvidenceReferences: uniqueTexts(counterEvidenceReferences, "counterevidence reference"),
    corroborationOnly
  });
}

function validateLineage(request: AiAttributionRequest): {
  readonly cohort: AiCalibrationCohortKey;
  readonly cohortIdentity: string;
  readonly evidenceSnapshotIdentity: string;
} {
  if (!verifyCalibrationPrediction(request.prediction)) throw new Error("attribution prediction hash mismatch");
  if (!verifyCalibrationOutcome(request.outcome)) throw new Error("attribution outcome hash mismatch");
  const semanticLedger = new OutcomeCalibrationLedger();
  semanticLedger.appendPrediction(request.prediction);
  semanticLedger.appendOutcome(request.outcome);
  if (request.prediction.provenance !== request.outcome.provenance) throw new Error("attribution prediction/outcome provenance mismatch");

  const lineage = request.lineage;
  if (requiredText(lineage.providerId, "lineage providerId") !== request.prediction.providerId) throw new Error("attribution provider lineage mismatch");
  if (requiredText(lineage.modelVersionId, "lineage modelVersionId") !== request.prediction.modelVersionId) throw new Error("attribution model lineage mismatch");
  if (requiredText(lineage.promptArtifactId, "lineage promptArtifactId") !== request.prediction.promptArtifactId) throw new Error("attribution prompt artifact lineage mismatch");
  if (requiredText(lineage.promptArtifactVersion, "lineage promptArtifactVersion") !== request.prediction.promptArtifactVersion) throw new Error("attribution prompt version lineage mismatch");
  if (sha256(lineage.promptArtifactDigest, "lineage promptArtifactDigest") !== request.prediction.promptArtifactDigest.toLowerCase()) throw new Error("attribution prompt digest lineage mismatch");

  const cohort = calibrationCohort(request.prediction);
  const cohortIdentity = aiSha256(cohort);
  if (sha256(lineage.calibrationCohortIdentity, "calibrationCohortIdentity") !== cohortIdentity) throw new Error("attribution calibration cohort lineage mismatch");

  const evidenceSnapshotIdentity = aiAttributionEvidenceSnapshotIdentity(request.prediction, request.outcome, request.observedEvidence);
  if (sha256(lineage.evidenceSnapshotIdentity, "evidenceSnapshotIdentity") !== evidenceSnapshotIdentity) throw new Error("attribution evidence snapshot lineage mismatch");

  if (lineage.scenario != null) {
    requiredText(lineage.scenario.experimentId, "scenario experimentId");
    sha256(lineage.scenario.policyIdentity, "scenario policyIdentity");
    sha256(lineage.scenario.baselineIdentity, "scenario baselineIdentity");
    sha256(lineage.scenario.resultIdentity, "scenario resultIdentity");
    if (lineage.scenario.provenance !== "HYPOTHETICAL_ANALYSIS") throw new Error("scenario attribution provenance is invalid");
    if (request.signals.scenarioRobustnessState !== lineage.scenario.robustnessState) throw new Error("scenario attribution lineage state mismatch");
  } else if (request.signals.scenarioRobustnessState != null) {
    throw new Error("scenario robustness signal is missing scenario lineage");
  }

  return Object.freeze({ cohort, cohortIdentity, evidenceSnapshotIdentity });
}

function predictionWasWrong(request: AiAttributionRequest): boolean {
  const predictedOutcome = request.prediction.rawProbability >= 0.5;
  return predictedOutcome !== request.outcome.outcome;
}

function causesFromSignals(policy: AiAttributionPolicy, request: AiAttributionRequest): readonly AiAttributionCandidate[] {
  const signals = normalizedSignals(request.signals);
  const allowed = new Set(policy.allowedCauses);
  const result: AiAttributionCandidate[] = [];
  if (signals.evidenceGapEvidenceReferences.length > 0 && allowed.has("EVIDENCE_GAP")) {
    result.push(candidate("EVIDENCE_GAP", signals.evidenceGapEvidenceReferences, signals.counterEvidenceReferences, false));
  }
  if (signals.dataQualityFailureEvidenceReferences.length > 0 && allowed.has("DATA_QUALITY_FAILURE")) {
    result.push(candidate("DATA_QUALITY_FAILURE", signals.dataQualityFailureEvidenceReferences, signals.counterEvidenceReferences, false));
  }
  if (signals.providerComparisonState === "DISAGREEMENT" && allowed.has("MODEL_DISAGREEMENT")) {
    result.push(candidate("MODEL_DISAGREEMENT", ["provider-comparison:DISAGREEMENT"], signals.counterEvidenceReferences, true));
  }
  if (signals.calibrationStatus === "DEGRADED" && allowed.has("CALIBRATION_MISS")) {
    result.push(candidate("CALIBRATION_MISS", ["calibration:DEGRADED"], signals.counterEvidenceReferences, true));
  }
  if ((signals.scenarioRobustnessState === "SENSITIVE" || signals.scenarioRobustnessState === "CONTRADICTORY") && allowed.has("SCENARIO_SENSITIVITY_MISS")) {
    result.push(candidate("SCENARIO_SENSITIVITY_MISS", [`scenario:${signals.scenarioRobustnessState}`], signals.counterEvidenceReferences, true));
  }
  if (signals.regimeShiftEvidenceReferences.length > 0 && allowed.has("REGIME_SHIFT_CANDIDATE")) {
    result.push(candidate("REGIME_SHIFT_CANDIDATE", signals.regimeShiftEvidenceReferences, signals.counterEvidenceReferences, true));
  }
  return Object.freeze(result.sort((a, b) => a.cause.localeCompare(b.cause)));
}

function episodeContentHash(episode: Omit<AiAttributionEpisode, "contentHash">): string {
  return aiSha256(episode);
}

export function verifyAiAttributionEpisode(episode: AiAttributionEpisode): boolean {
  if (!isAiSha256(episode.contentHash)) return false;
  const { contentHash, ...withoutHash } = episode;
  try {
    assertSecretFree(withoutHash);
    return episodeContentHash(withoutHash) === contentHash.toLowerCase();
  } catch {
    return false;
  }
}

export class GovernedOutcomeAttributionEngine {
  private readonly policy: AiAttributionPolicy;
  private readonly policyIdentity: string;
  private readonly replay = new Map<string, { readonly replayIdentity: string; readonly episode: AiAttributionEpisode }>();

  public constructor(policy: AiAttributionPolicy) {
    this.policy = normalizeAiAttributionPolicy(policy);
    this.policyIdentity = aiAttributionPolicyIdentity(this.policy);
  }

  public analyze(request: AiAttributionRequest): AiAttributionEpisode {
    const episodeId = requiredText(request.episodeId, "episodeId");
    const createdAt = nonNegativeInteger(request.createdAt, "createdAt");
    const expiresAt = request.expiresAt == null ? createdAt + this.policy.defaultEpisodeTtlMs : nonNegativeInteger(request.expiresAt, "expiresAt");
    if (!Number.isSafeInteger(expiresAt) || expiresAt <= createdAt) throw new Error("attribution expiry must follow creation");
    const scope = requiredText(request.scope, "scope");
    const supersedesEpisodeId = request.supersedesEpisodeId == null ? null : requiredText(request.supersedesEpisodeId, "supersedesEpisodeId");
    const lineage = validateLineage(request);
    const signals = normalizedSignals(request.signals);
    assertSecretFree({ scope, signals });

    const replayIdentity = aiSha256({
      policyIdentity: this.policyIdentity,
      predictionContentHash: request.prediction.contentHash,
      outcomeContentHash: request.outcome.contentHash,
      evidenceSnapshotIdentity: lineage.evidenceSnapshotIdentity,
      calibrationCohortIdentity: lineage.cohortIdentity,
      scenario: request.lineage.scenario ?? null,
      signals,
      scope,
      createdAt,
      expiresAt,
      supersedesEpisodeId
    });
    const prior = this.replay.get(episodeId);
    if (prior != null) {
      if (prior.replayIdentity !== replayIdentity) throw new Error("attribution replay conflict");
      return prior.episode;
    }

    const reasonCodes = new Set<string>();
    if (signals.modelSelfReportedCause != null) reasonCodes.add("MODEL_SELF_REPORT_IGNORED_FOR_CAUSALITY");
    if (signals.providerMajorityCause != null) reasonCodes.add("PROVIDER_MAJORITY_IGNORED_FOR_CAUSALITY");
    const miss = predictionWasWrong(request);
    let candidates = miss ? causesFromSignals(this.policy, request) : Object.freeze([] as AiAttributionCandidate[]);
    let strength: AiAttributionEpisode["strength"] = "UNRESOLVED";
    let primaryCause: AiAttributionEpisode["primaryCause"] = null;

    if (!miss) {
      reasonCodes.add("PREDICTION_NOT_MISS");
      candidates = Object.freeze([]);
    } else if (signals.providerComparisonState === "UNVERIFIED" || signals.scenarioRobustnessState === "UNVERIFIED") {
      strength = "UNVERIFIED";
      reasonCodes.add("CORROBORATING_EVIDENCE_UNVERIFIED");
    } else if (candidates.length === 0) {
      reasonCodes.add("NO_IDENTIFIABLE_CAUSE");
    } else if (candidates.length > 1) {
      reasonCodes.add("AMBIGUOUS_MULTI_CAUSE");
    } else {
      primaryCause = candidates[0]!.cause;
      strength = candidates[0]!.corroborationOnly ? "PARTIALLY_IDENTIFIED" : "IDENTIFIED";
      reasonCodes.add(strength === "IDENTIFIED" ? "SINGLE_CAUSE_STRUCTURALLY_IDENTIFIED" : "SINGLE_CAUSE_CORROBORATION_ONLY");
    }

    if (request.prediction.provenance === "SYNTHETIC_TEST") reasonCodes.add("SYNTHETIC_NO_REALIZED_LEARNING_CREDIT");
    if (request.lineage.scenario != null) reasonCodes.add("HYPOTHETICAL_SCENARIO_CORROBORATION_ONLY");

    const realizedLearningCreditAllowed = request.prediction.provenance === "VERIFIED_RUNTIME"
      && request.outcome.provenance === "VERIFIED_RUNTIME"
      && strength === "IDENTIFIED"
      && primaryCause != null
      && candidates.length === 1
      && candidates[0]!.corroborationOnly === false;

    const withoutHash: Omit<AiAttributionEpisode, "contentHash"> = Object.freeze({
      schemaVersion: 1,
      episodeId,
      policyIdentity: this.policyIdentity,
      replayIdentity,
      predictionId: request.prediction.predictionId,
      predictionContentHash: request.prediction.contentHash.toLowerCase(),
      outcomeContentHash: request.outcome.contentHash.toLowerCase(),
      evidenceSnapshotIdentity: lineage.evidenceSnapshotIdentity,
      calibrationCohortIdentity: lineage.cohortIdentity,
      calibrationCohort: lineage.cohort,
      scenario: request.lineage.scenario ?? null,
      strength,
      primaryCause,
      candidates,
      reasonCodes: Object.freeze([...reasonCodes].sort()),
      scope,
      createdAt,
      expiresAt,
      supersedesEpisodeId,
      sourceProvenance: request.prediction.provenance,
      realizedLearningCreditAllowed,
      liveAuthority: "NONE",
      realOrderAuthority: false,
      realTransferAuthority: false,
      productionMutationAllowed: false
    });
    assertSecretFree(withoutHash);
    const episode = Object.freeze({ ...withoutHash, contentHash: episodeContentHash(withoutHash) });
    this.replay.set(episodeId, Object.freeze({ replayIdentity, episode }));
    return episode;
  }
}

export function assignAiAttributionPartition(policyValue: AiAttributionPolicy, caseIdValue: string): AiAttributionPartition {
  const policy = normalizeAiAttributionPolicy(policyValue);
  const caseId = requiredText(caseIdValue, "benchmark caseId");
  const digest = aiSha256({ policyId: policy.policyId, policyVersion: policy.policyVersion, holdoutSalt: policy.holdoutSalt, caseId });
  const bucket = Number.parseInt(digest.slice(0, 8), 16) % 100;
  return bucket < policy.holdoutPercent ? "HOLDOUT" : "TRAIN";
}

export function assertAiAttributionHoldoutNoLeakage(
  policy: AiAttributionPolicy,
  trainingCaseIds: readonly string[],
  evaluationCaseIds: readonly string[]
): void {
  const train = new Set(uniqueTexts(trainingCaseIds, "training caseId"));
  const evaluation = new Set(uniqueTexts(evaluationCaseIds, "evaluation caseId"));
  for (const id of train) {
    if (evaluation.has(id)) throw new Error("attribution holdout leakage detected");
    if (assignAiAttributionPartition(policy, id) !== "TRAIN") throw new Error("training case assigned to holdout partition");
  }
  for (const id of evaluation) {
    if (assignAiAttributionPartition(policy, id) !== "HOLDOUT") throw new Error("evaluation case is not holdout partition");
  }
}

export function assertSingleAttributionSignalAblation(before: AiAttributionSignals, after: AiAttributionSignals): string {
  const left = normalizedSignals(before) as unknown as Record<string, unknown>;
  const right = normalizedSignals(after) as unknown as Record<string, unknown>;
  const changed = Object.keys(left).filter((key) => aiSha256(left[key]) !== aiSha256(right[key]));
  if (changed.length !== 1) throw new Error("attribution ablation must change exactly one governed signal dimension");
  return changed[0]!;
}

export function scoreAiAttributionBenchmark(observations: readonly AiAttributionBenchmarkObservation[]): AiAttributionBenchmarkMetrics {
  const cases = observations.map((item) => Object.freeze({
    caseId: requiredText(item.caseId, "benchmark caseId"),
    expectedCause: item.expectedCause,
    expectedAmbiguous: item.expectedAmbiguous,
    actualStrength: item.actualStrength,
    actualCause: item.actualCause
  }));
  if (new Set(cases.map((item) => item.caseId)).size !== cases.length) throw new Error("duplicate attribution benchmark caseId");
  const known = cases.filter((item) => item.expectedCause != null && !item.expectedAmbiguous);
  const knownCorrect = known.filter((item) => item.actualCause === item.expectedCause && (item.actualStrength === "IDENTIFIED" || item.actualStrength === "PARTIALLY_IDENTIFIED")).length;
  const ambiguous = cases.filter((item) => item.expectedAmbiguous);
  const ambiguousCorrect = ambiguous.filter((item) => item.actualStrength === "UNRESOLVED" && item.actualCause == null).length;
  const falseAttributionCount = cases.filter((item) => item.expectedCause == null && !item.expectedAmbiguous && item.actualCause != null).length;
  const unresolvedCount = cases.filter((item) => item.actualStrength === "UNRESOLVED" || item.actualStrength === "UNVERIFIED").length;
  return Object.freeze({
    caseCount: cases.length,
    knownCauseCount: known.length,
    knownCauseCorrect: knownCorrect,
    knownCauseAccuracy: known.length === 0 ? null : knownCorrect / known.length,
    ambiguousCaseCount: ambiguous.length,
    ambiguousAbstentionCorrect: ambiguousCorrect,
    ambiguityAbstentionAccuracy: ambiguous.length === 0 ? null : ambiguousCorrect / ambiguous.length,
    falseAttributionCount,
    falseAttributionRate: cases.length === 0 ? 0 : falseAttributionCount / cases.length,
    unresolvedCount,
    unresolvedRate: cases.length === 0 ? 0 : unresolvedCount / cases.length
  });
}
