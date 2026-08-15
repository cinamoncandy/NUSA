import { aiSha256, type AiCalibrationPrediction, type AiCalibrationProfile, type AiReadOnlyProjection, type ModelProvider } from "../../../../packages/contracts/src/aiInference";
import type { AiCalibrationDurabilityHealth, AiCalibrationDurableStore } from "../../../../packages/contracts/src/aiCalibrationDurability";
import type { AiProviderComparisonResult, AiProviderPoolPolicy } from "../../../../packages/contracts/src/aiProviderDiversity";
import type { AiExplanationVerificationResult } from "../../../../packages/contracts/src/aiExplanationFaithfulness";
import type { AiAttributionPolicy, AiLessonProjection, AiObservedEvidenceIdentity } from "../../../../packages/contracts/src/aiOutcomeAttribution";
import { SqliteAiCalibrationDurableStore } from "../../../../packages/storage/src/aiCalibrationDurability";
import { SqliteAiOutcomeAttributionMemory } from "../../../../packages/storage/src/aiOutcomeAttributionMemory";
import { DEFAULT_CLOUD_STATE_DB_PATH } from "../cloudRuntimeConfig";
import { createModelProviderFromEnvironment, createNVersionProviderPoolFromEnvironment, type NVersionProviderEnvironmentPool } from "./modelProvider";
import { MultiAgentOrchestrator, type AiOrchestrationInput, type AiOrchestrationResult } from "./multiAgentOrchestrator";
import { NVersionStrategyEvaluator, type NVersionStrategyInput } from "./nVersionStrategyEvaluator";
import { createVerifiedRuntimeCalibrationPrediction } from "./calibrationBridge";
import { createCalibrationOutcome, OutcomeCalibrationLedger, type CalibrationPolicy } from "./outcomeCalibration";
import { CalibrationDurabilityRuntime } from "./calibrationDurabilityRuntime";
import { buildAiExplanationEnvelope } from "./explanationEnvelopeBridge";
import { verifyAiExplanation } from "./explanationFaithfulnessVerifier";
import { normalizeAiInferenceBudgetPolicy } from "./inferenceResourceLedger";
import { aiAttributionCalibrationCohortIdentity, aiAttributionEvidenceSnapshotIdentity, GovernedOutcomeAttributionEngine } from "./outcomeAttributionLearning";
import { projectAiReadOnly } from "./projection";

/**
 * Fixed policy for the runtime attribution episodes recorded automatically on calibration outcome
 * resolution (see resolvePending). holdoutPercent/holdoutSalt are inert here -- this runtime path
 * never calls assignAiAttributionPartition; only the offline research benchmark path partitions.
 */
const AI_ATTRIBUTION_POLICY: AiAttributionPolicy = Object.freeze({
  schemaVersion: 1,
  policyId: "NUSA_AI_ATTRIBUTION_POLICY_V1",
  policyVersion: "1",
  allowedCauses: Object.freeze(["EVIDENCE_GAP", "DATA_QUALITY_FAILURE", "MODEL_DISAGREEMENT", "CALIBRATION_MISS", "SCENARIO_SENSITIVITY_MISS", "REGIME_SHIFT_CANDIDATE", "UNRESOLVED"] as const),
  holdoutSalt: "nusa-cloud-ai-runtime-attribution-v1",
  holdoutPercent: 1,
  defaultEpisodeTtlMs: 24 * 60 * 60 * 1_000
});

export const AI_CALIBRATION_OUTCOME_DEFINITION_ID = "UPBIT_PUBLIC_PRICE_HIGHER_AFTER_5M";
export const AI_CALIBRATION_OUTCOME_DEFINITION_VERSION = "1";
export const AI_CALIBRATION_HORIZON_MS = 5 * 60 * 1_000;
/** The audited 5-minute outcome accepts only a narrowly bounded observation after its due time. */
export const AI_CALIBRATION_RESOLUTION_GRACE_MS = 60_000;

export type CloudAiOrchestrationResult = AiOrchestrationResult & {
  readonly providerComparison?: AiProviderComparisonResult;
  readonly explanationVerification?: AiExplanationVerificationResult;
  readonly recentLessonCount?: number;
};

/** How many prior structural lessons (see applicableLessons) were actually fed into this run's evidence. */
export const NUSA_AI_LEARNING_MEMORY_SOURCE = "nusa-ai-outcome-attribution-memory";
function countLessonEvidence(input: AiOrchestrationInput): number {
  const item = (input.evidenceMaterializations ?? []).find((candidate) => input.evidence.some((evidence) => evidence.evidenceId === candidate.evidenceId && evidence.sourceReference === NUSA_AI_LEARNING_MEMORY_SOURCE));
  const lessons = item?.payload.lessons;
  return Array.isArray(lessons) ? lessons.length : 0;
}

export interface CloudAiRuntime {
  readonly enabled: boolean;
  readonly orchestrator: MultiAgentOrchestrator;
  schedule(input: AiOrchestrationInput): boolean;
  latest(now?: number): CloudAiOrchestrationResult | null;
  latestProjection(now?: number): AiReadOnlyProjection | null;
  latestProviderComparison(now?: number): AiProviderComparisonResult | null;
  latestExplanationVerification(now?: number): AiExplanationVerificationResult | null;
  /** Prior structural lessons for this exact target/outcome scope, advisory-only, never authority. */
  applicableLessons(scope: string, now?: number): readonly AiLessonProjection[];
  latestCalibrationPrediction(): AiCalibrationPrediction | null;
  calibrationProfile(): AiCalibrationProfile | null;
  calibrationDurabilityHealth(): AiCalibrationDurabilityHealth;
  isInFlight(): boolean;
  isProviderComparisonInFlight(): boolean;
  readonly liveAuthority: "NONE";
  readonly productionMutationAllowed: false;
}

export interface CloudAiCalibrationOptions {
  readonly outcomeDefinitionId: string;
  readonly outcomeDefinitionVersion: string;
  readonly horizonMs: number;
  readonly policy?: CalibrationPolicy;
}

export interface CloudAiRuntimeOptions {
  readonly now?: () => number;
  readonly minimumCadenceMs?: number;
  readonly maximumResultAgeMs?: number;
  readonly calibration?: CloudAiCalibrationOptions;
  /** Explicit test/composition injection. Production Cloud auto-composes SQLite from its state DB path. */
  readonly durableCalibrationStore?: AiCalibrationDurableStore;
  /** Undefined auto-composes explicit environment N-version config; null explicitly disables it. */
  readonly nVersionEvaluator?: Pick<NVersionStrategyEvaluator, "run"> | null;
}

interface VerifiedMarketAnchor {
  readonly targetId: string;
  readonly value: number;
  readonly observedAt: number;
  readonly evidenceReference: string;
  readonly contentDigest: string;
}

interface PendingPrediction {
  readonly prediction: AiCalibrationPrediction;
  /**
   * The exact verified evidence identity the prediction was anchored to, captured at schedule
   * time. Recovered predictions (loaded from durable storage after a restart) never have this --
   * the durable store retains the prediction/outcome, not the original evidence bundle -- so
   * attribution episodes are skipped for those rather than guessed at.
   */
  readonly predictionEvidence: AiObservedEvidenceIdentity | null;
}

const DEFAULT_CALIBRATION: CloudAiCalibrationOptions = Object.freeze({
  outcomeDefinitionId: AI_CALIBRATION_OUTCOME_DEFINITION_ID,
  outcomeDefinitionVersion: AI_CALIBRATION_OUTCOME_DEFINITION_VERSION,
  horizonMs: AI_CALIBRATION_HORIZON_MS,
  policy: Object.freeze({ minimumSamples: 20, minimumBucketSamples: 5, bucketCount: 10, maximumExpectedCalibrationError: 0.15, maximumBrierScore: 0.25 })
});

function duration(value: number | undefined, fallback: number, name: string): number {
  const resolved = value ?? fallback;
  if (!Number.isSafeInteger(resolved) || resolved < 0) throw new Error(`${name} must be a non-negative safe integer`);
  return resolved;
}

function requiredText(value: string, name: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(`${name} is required`);
  return normalized;
}

function calibrationOptions(value: CloudAiCalibrationOptions | undefined): CloudAiCalibrationOptions {
  const resolved = value ?? DEFAULT_CALIBRATION;
  if (!Number.isSafeInteger(resolved.horizonMs) || resolved.horizonMs < 1) throw new Error("AI calibration horizon must be a positive safe integer");
  return Object.freeze({
    outcomeDefinitionId: requiredText(resolved.outcomeDefinitionId, "AI calibration outcomeDefinitionId"),
    outcomeDefinitionVersion: requiredText(resolved.outcomeDefinitionVersion, "AI calibration outcomeDefinitionVersion"),
    horizonMs: resolved.horizonMs,
    policy: resolved.policy == null ? undefined : Object.freeze({ ...resolved.policy })
  });
}

function defaultNVersionPolicy(pool: NVersionProviderEnvironmentPool): AiProviderPoolPolicy {
  return Object.freeze({
    schemaVersion: 1,
    policyId: "NUSA_AI_NVERSION_PROVIDER_COMPARISON_V1",
    policyVersion: "1",
    groups: Object.freeze(pool.groups.map((group) => Object.freeze({
      groupId: group.groupId,
      providerId: group.providerId,
      modelVersionId: group.modelVersionId,
      modelFamilyId: group.modelFamilyId
    }))),
    minIndependentGroups: 2,
    maxProbabilityDelta: 0.2,
    minEvidenceReferenceOverlap: 0.5,
    minAssumptionOverlap: 0.25,
    requireUncertaintyAgreement: false,
    inferenceBudget: Object.freeze({
      schemaVersion: 1,
      policyId: "NUSA_AI_NVERSION_RESOURCE_BUDGET_V1",
      policyVersion: "1",
      maxModelCalls: 2,
      maxTotalAttempts: 4,
      maxCumulativeOutputTokens: 8192,
      maxInputBytes: 1024 * 1024,
      maxWallClockMs: 30_000,
      requireUsageAccounting: true
    })
  });
}

function zeroAuthority(result: AiOrchestrationResult): boolean {
  return result.liveAuthority === "NONE" && result.realOrderAuthority === false && result.realTransferAuthority === false && result.productionMutationAllowed === false && (result.governanceDecision == null || (result.governanceDecision.realOrderAuthority === false && result.governanceDecision.realTransferAuthority === false && result.governanceDecision.productionMutationAllowed === false));
}

function comparisonZeroAuthority(result: AiProviderComparisonResult): boolean {
  return result.liveAuthority === "NONE" && result.realOrderAuthority === false && result.realTransferAuthority === false && result.productionMutationAllowed === false;
}

function verifiedMarketAnchor(input: AiOrchestrationInput): VerifiedMarketAnchor | null {
  const materializations = input.evidenceMaterializations ?? [];
  for (const evidence of input.evidence) {
    if (evidence.evidenceType !== "market-data" || evidence.sourceReference !== "upbit-public-ticker" || evidence.quality !== "verified") continue;
    const materialization = materializations.find((candidate) => candidate.evidenceId === evidence.evidenceId);
    if (materialization == null || materialization.contentDigest !== evidence.contentDigest || aiSha256(materialization.payload) !== evidence.contentDigest) continue;
    const payload = materialization.payload;
    if (payload.source !== "UPBIT_PUBLIC_TICKER" || typeof payload.market !== "string" || !payload.market.trim() || typeof payload.price !== "number" || !Number.isFinite(payload.price) || payload.price <= 0 || typeof payload.observedAt !== "string") continue;
    const observedAt = Date.parse(payload.observedAt);
    if (!Number.isSafeInteger(observedAt) || observedAt <= 0 || observedAt !== evidence.observedAt) continue;
    return Object.freeze({ targetId: payload.market.trim(), value: payload.price, observedAt, evidenceReference: evidence.evidenceId, contentDigest: evidence.contentDigest });
  }
  return null;
}

/** The same scope key is used to record an episode and to look up applicable lessons for it. */
export function attributionScope(prediction: Pick<AiCalibrationPrediction, "outcomeDefinitionId" | "targetId">): string {
  return `${prediction.outcomeDefinitionId}:${prediction.targetId}`;
}

function supportsAutomaticResolution(calibration: CloudAiCalibrationOptions): boolean {
  return calibration.outcomeDefinitionId === AI_CALIBRATION_OUTCOME_DEFINITION_ID
    && calibration.outcomeDefinitionVersion === AI_CALIBRATION_OUTCOME_DEFINITION_VERSION
    && calibration.horizonMs === AI_CALIBRATION_HORIZON_MS;
}

/**
 * Only the actual Cloud bootstrap gets implicit durability. Unit/library callers without the
 * mandatory dashboard bind/token environment keep the historical in-memory behavior unless a
 * store is explicitly injected.
 */
function implicitDurabilityPath(env: NodeJS.ProcessEnv): string | null {
  const port = env.NUSA_CLOUD_DASHBOARD_PORT?.trim();
  const token = env.NUSA_CLOUD_DASHBOARD_TOKEN?.trim();
  if (!port || !token) return null;
  return env.NUSA_CLOUD_STATE_DB_PATH?.trim() || DEFAULT_CLOUD_STATE_DB_PATH;
}

export function createCloudAiRuntime(env: NodeJS.ProcessEnv = process.env, provider: ModelProvider = createModelProviderFromEnvironment(env), options: CloudAiRuntimeOptions = {}): CloudAiRuntime {
  const enabled = env.NUSA_AI_ENABLED?.trim().toLowerCase() === "true";
  const now = options.now ?? Date.now;
  const minimumCadenceMs = duration(options.minimumCadenceMs, 30_000, "AI minimum cadence");
  const maximumResultAgeMs = duration(options.maximumResultAgeMs, 120_000, "AI maximum result age");
  const calibration = calibrationOptions(options.calibration);
  const calibrationLedger = new OutcomeCalibrationLedger();
  const orchestrator = new MultiAgentOrchestrator(provider, { enabled });
  const environmentPool = options.nVersionEvaluator === undefined ? createNVersionProviderPoolFromEnvironment(env) : null;
  const nVersionEvaluator = options.nVersionEvaluator === undefined
    ? environmentPool == null
      ? null
      : new NVersionStrategyEvaluator(environmentPool.groups.map((group) => Object.freeze({ groupId: group.groupId, provider: group.provider })), defaultNVersionPolicy(environmentPool), { now })
    : options.nVersionEvaluator;
  const pendingPredictions = new Map<string, PendingPrediction>();
  let durableStore = options.durableCalibrationStore;
  let durabilityOpenFailure = false;
  if (durableStore == null) {
    const pathname = implicitDurabilityPath(env);
    if (pathname != null) {
      try { durableStore = new SqliteAiCalibrationDurableStore(pathname); }
      catch { durabilityOpenFailure = true; }
    }
  }
  const durability = new CalibrationDurabilityRuntime(calibrationLedger, durableStore, now(), AI_CALIBRATION_RESOLUTION_GRACE_MS, durabilityOpenFailure);
  for (const prediction of durability.recovered().pendingPredictions) pendingPredictions.set(prediction.predictionId, Object.freeze({ prediction, predictionEvidence: null }));
  let attributionMemory: SqliteAiOutcomeAttributionMemory | null = null;
  try { attributionMemory = new SqliteAiOutcomeAttributionMemory(implicitDurabilityPath(env) ?? ":memory:"); }
  catch { attributionMemory = null; } // Learning memory is diagnostic-only and can never block AI scheduling.
  const attributionEngine = new GovernedOutcomeAttributionEngine(AI_ATTRIBUTION_POLICY);
  let inFlight = false;
  let comparisonInFlight = false;
  let lastScheduledAt = Number.NEGATIVE_INFINITY;
  let latestResult: AiOrchestrationResult | null = null;
  let latestCompletedAt: number | null = null;
  let latestExplanationVerificationResult: AiExplanationVerificationResult | null = null;
  let latestRecentLessonCount = 0;
  let latestComparison: AiProviderComparisonResult | null = null;
  let latestComparisonCompletedAt: number | null = null;
  let latestPrediction: AiCalibrationPrediction | null = durability.recovered().latestPrediction;

  const resolvePending = (anchor: VerifiedMarketAnchor | null): void => {
    if (anchor == null || !supportsAutomaticResolution(calibration) || !durability.trusted()) return;
    for (const [predictionId, pending] of pendingPredictions) {
      const prediction = pending.prediction;
      if (prediction.targetId !== anchor.targetId) continue;
      const dueAt = prediction.predictedAt + prediction.horizonMs;
      // Only a verified ticker for the prediction's own market can resolve or expire its audited window.
      if (anchor.observedAt > dueAt + AI_CALIBRATION_RESOLUTION_GRACE_MS) {
        if (durability.persistExpiry(prediction, anchor.observedAt)) pendingPredictions.delete(predictionId);
        continue;
      }
      if (anchor.observedAt < dueAt) continue;
      try {
        const outcome = createCalibrationOutcome({
          predictionId: prediction.predictionId,
          predictionContentHash: prediction.contentHash,
          outcomeDefinitionId: prediction.outcomeDefinitionId,
          outcomeDefinitionVersion: prediction.outcomeDefinitionVersion,
          outcome: anchor.value > prediction.anchorValue,
          resolvedValue: anchor.value,
          resolvedAt: anchor.observedAt,
          evidenceReferences: [anchor.evidenceReference],
          provenance: "VERIFIED_RUNTIME"
        });
        // Validate semantics before the durable transaction. This keeps a rejected runtime outcome
        // from ever reaching durable history while still requiring persistence before trust.
        const verifier = new OutcomeCalibrationLedger();
        verifier.appendPrediction(prediction);
        verifier.appendOutcome(outcome);
        if (!durability.persistOutcome(outcome, anchor.observedAt)) continue;
        calibrationLedger.appendOutcome(outcome);
        pendingPredictions.delete(predictionId);
        recordAttributionEpisode(prediction, outcome, pending.predictionEvidence, anchor);
      } catch {
        // Calibration is advisory-only. Malformed/conflicting outcomes cannot gain confidence.
      }
    }
  };

  /**
   * Turns a just-resolved prediction/outcome pair into a real, evidence-grounded attribution
   * episode and appends it to the learning-memory ledger. Every input here is data the calibration
   * path already verified (never fabricated): the prediction's own anchor evidence, the resolving
   * ticker's evidence, and whatever calibration/provider-comparison state is actually known right
   * now. Missing signals are left null/empty rather than guessed, so the engine correctly reports
   * UNRESOLVED/UNVERIFIED instead of inventing a cause. This must never affect calibration,
   * scheduling, or PAPER -- failures are swallowed, matching the calibration catch above.
   */
  const recordAttributionEpisode = (
    prediction: AiCalibrationPrediction,
    outcome: ReturnType<typeof createCalibrationOutcome>,
    predictionEvidence: AiObservedEvidenceIdentity | null,
    anchor: VerifiedMarketAnchor
  ): void => {
    if (attributionMemory == null || predictionEvidence == null) return;
    try {
      const observedEvidence: readonly AiObservedEvidenceIdentity[] = Object.freeze([
        predictionEvidence,
        Object.freeze({ evidenceId: anchor.evidenceReference, contentDigest: anchor.contentDigest, provenance: prediction.provenance })
      ]);
      const profile = currentProfile();
      const episode = attributionEngine.analyze({
        episodeId: `${prediction.predictionId}:attribution`,
        prediction,
        outcome,
        observedEvidence,
        lineage: {
          providerId: prediction.providerId,
          modelVersionId: prediction.modelVersionId,
          promptArtifactId: prediction.promptArtifactId,
          promptArtifactVersion: prediction.promptArtifactVersion,
          promptArtifactDigest: prediction.promptArtifactDigest,
          calibrationCohortIdentity: aiAttributionCalibrationCohortIdentity(prediction),
          evidenceSnapshotIdentity: aiAttributionEvidenceSnapshotIdentity(prediction, outcome, observedEvidence)
        },
        signals: {
          evidenceGapEvidenceReferences: [],
          dataQualityFailureEvidenceReferences: [],
          providerComparisonState: null,
          calibrationStatus: profile?.status ?? "UNKNOWN",
          scenarioRobustnessState: null,
          regimeShiftEvidenceReferences: [],
          counterEvidenceReferences: [],
          modelSelfReportedCause: null,
          providerMajorityCause: null
        },
        scope: attributionScope(prediction),
        createdAt: outcome.resolvedAt
      });
      attributionMemory.appendEpisode(episode);
    } catch {
      // Attribution is diagnostic/advisory-only. A malformed or conflicting episode is dropped.
    }
  };

  const scheduleProviderComparison = (input: AiOrchestrationInput): void => {
    if (nVersionEvaluator == null || comparisonInFlight) return;
    const comparisonInput: NVersionStrategyInput = Object.freeze({
      comparisonRunId: `${input.orchestrationRunId}:nversion`,
      decisionId: input.decisionId,
      evaluatedAt: input.evaluatedAt,
      evidence: input.evidence,
      evidenceMaterializations: input.evidenceMaterializations,
      policyVersionIds: input.policyVersionIds,
      certificationIds: input.certificationIds,
      controlPlaneStateId: input.controlPlaneStateId,
      contextValidForMs: input.contextValidForMs
    });
    comparisonInFlight = true;
    void nVersionEvaluator.run(comparisonInput).then((result) => {
      const completedAt = now();
      if (comparisonZeroAuthority(result) && Number.isSafeInteger(completedAt) && completedAt > 0) {
        latestComparison = result;
        latestComparisonCompletedAt = completedAt;
      }
    }).catch(() => {
      // Independent-provider evidence is advisory-only and cannot disturb the primary AI or PAPER.
    }).finally(() => {
      comparisonInFlight = false;
    });
  };

  const schedule = (input: AiOrchestrationInput): boolean => {
    const anchor = verifiedMarketAnchor(input);
    resolvePending(anchor);
    const scheduledAt = now();
    if (!Number.isSafeInteger(scheduledAt) || scheduledAt <= 0) return false;
    if (!enabled || inFlight || scheduledAt - lastScheduledAt < minimumCadenceMs) return false;
    lastScheduledAt = scheduledAt;
    inFlight = true;
    scheduleProviderComparison(input);
    void orchestrator.run(input).then((result) => {
      const completedAt = now();
      if (result.status === "COMPLETED" && zeroAuthority(result) && Number.isSafeInteger(completedAt) && completedAt > 0) {
        latestResult = result;
        latestCompletedAt = completedAt;
        latestRecentLessonCount = countLessonEvidence(input);
        try {
          const profileForEnvelope = currentProfile();
          const envelope = buildAiExplanationEnvelope(input, result, {
            explanationId: `${result.orchestrationRunId}:explanation`,
            observedAt: completedAt,
            providerId: provider.providerId,
            resourcePolicy: result.inferenceResources?.policy ?? normalizeAiInferenceBudgetPolicy(undefined),
            calibrationCohort: profileForEnvelope?.status === "CALIBRATED" ? profileForEnvelope.cohort : null,
            providerDisagreement: latestComparison?.comparisonState === "DISAGREEMENT",
            confidence: profileForEnvelope?.status === "CALIBRATED" ? profileForEnvelope.effectiveConfidence : 0
          });
          latestExplanationVerificationResult = envelope == null ? null : verifyAiExplanation(envelope);
        } catch {
          // Explanation verification is diagnostic-only and can never block or alter the AI result.
          latestExplanationVerificationResult = null;
        }
        if (anchor != null && durability.trusted()) {
          try {
            const prediction = createVerifiedRuntimeCalibrationPrediction(result, {
              providerId: provider.providerId,
              outcomeDefinitionId: calibration.outcomeDefinitionId,
              outcomeDefinitionVersion: calibration.outcomeDefinitionVersion,
              horizonMs: calibration.horizonMs,
              targetId: anchor.targetId,
              anchorValue: anchor.value,
              anchorObservedAt: anchor.observedAt,
              anchorEvidenceReference: anchor.evidenceReference
            });
            const verifier = new OutcomeCalibrationLedger();
            verifier.appendPrediction(prediction);
            if (!durability.persistPrediction(prediction, completedAt)) {
              latestPrediction = null;
              return;
            }
            latestPrediction = calibrationLedger.appendPrediction(prediction);
            pendingPredictions.set(latestPrediction.predictionId, Object.freeze({
              prediction: latestPrediction,
              predictionEvidence: Object.freeze({ evidenceId: anchor.evidenceReference, contentDigest: anchor.contentDigest, provenance: prediction.provenance })
            }));
          } catch {
            // A valid zero-authority AI result may remain readable, but no durable/verified prediction means no calibration credit.
            latestPrediction = null;
          }
        } else {
          latestPrediction = null;
        }
      }
    }).catch(() => {
      // AI is isolated from PAPER. Existing validated AI state is retained until it naturally becomes stale.
    }).finally(() => {
      inFlight = false;
    });
    return true;
  };

  const currentProfile = (): AiCalibrationProfile | null => {
    if (latestPrediction == null || !durability.trusted()) return null;
    try {
      return calibrationLedger.profile(latestPrediction, latestPrediction.rawProbability, calibration.policy);
    } catch {
      return null;
    }
  };

  const latestProviderComparison = (at = now()): AiProviderComparisonResult | null => {
    if (latestComparison == null || latestComparisonCompletedAt == null || !Number.isSafeInteger(at) || at <= 0) return null;
    if (latestComparisonCompletedAt > at || at - latestComparisonCompletedAt > maximumResultAgeMs) return null;
    return latestComparison;
  };

  const latestExplanationVerification = (at = now()): AiExplanationVerificationResult | null => {
    if (latestExplanationVerificationResult == null || latestCompletedAt == null || !Number.isSafeInteger(at) || at <= 0) return null;
    if (latestCompletedAt > at || at - latestCompletedAt > maximumResultAgeMs) return null;
    return latestExplanationVerificationResult;
  };

  const latest = (at = now()): CloudAiOrchestrationResult | null => {
    if (latestResult == null || latestCompletedAt == null || !Number.isSafeInteger(at) || at <= 0) return null;
    if (latestCompletedAt > at || at - latestCompletedAt > maximumResultAgeMs) return null;
    const providerComparison = latestProviderComparison(at);
    const explanationVerification = latestExplanationVerification(at);
    return Object.freeze({
      ...latestResult,
      calibrationProfile: currentProfile(),
      calibrationDurabilityHealth: durability.snapshot(),
      recentLessonCount: latestRecentLessonCount,
      ...(providerComparison == null ? {} : { providerComparison }),
      ...(explanationVerification == null ? {} : { explanationVerification })
    }) as CloudAiOrchestrationResult;
  };

  const latestProjection = (at = now()): AiReadOnlyProjection | null => {
    const result = latest(at);
    return result == null ? null : projectAiReadOnly(result);
  };

  const applicableLessons = (scope: string, at = now()): readonly AiLessonProjection[] => {
    if (attributionMemory == null) return Object.freeze([]);
    try { return attributionMemory.applicableLessons(scope, at); }
    catch { return Object.freeze([]); } // Learning memory is diagnostic-only and never blocks scheduling.
  };

  return Object.freeze({
    enabled,
    orchestrator,
    schedule,
    latest,
    latestProjection,
    latestProviderComparison,
    latestExplanationVerification,
    applicableLessons,
    latestCalibrationPrediction: () => latestPrediction,
    calibrationProfile: currentProfile,
    calibrationDurabilityHealth: () => durability.snapshot(),
    isInFlight: () => inFlight,
    isProviderComparisonInFlight: () => comparisonInFlight,
    liveAuthority: "NONE" as const,
    productionMutationAllowed: false as const
  });
}
