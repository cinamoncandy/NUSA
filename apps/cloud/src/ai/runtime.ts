import { aiSha256, type AiCalibrationPrediction, type AiCalibrationProfile, type AiReadOnlyProjection, type ModelProvider } from "../../../../packages/contracts/src/aiInference";
import type { AiCalibrationDurabilityHealth, AiCalibrationDurableStore } from "../../../../packages/contracts/src/aiCalibrationDurability";
import type { AiProviderComparisonResult, AiProviderPoolPolicy } from "../../../../packages/contracts/src/aiProviderDiversity";
import type { AiExplanationVerificationResult } from "../../../../packages/contracts/src/aiExplanationFaithfulness";
import type { AiAttributionPolicy, AiLessonProjection, AiObservedEvidenceIdentity } from "../../../../packages/contracts/src/aiOutcomeAttribution";
import type { AiScenarioBaseline, AiScenarioDefinition, AiScenarioPolicy, AiScenarioReasoningResult } from "../../../../packages/contracts/src/aiScenarioReasoning";
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
import { ScenarioCounterfactualEvaluator, type AiScenarioRunner } from "./scenarioCounterfactualEvaluator";
import { CLOUD_AI_SCENARIO_PRICE_SHOCK_DIMENSION, CloudAiScenarioRunner } from "./scenarioOrchestratorRunner";

/**
 * Sole opt-in scenario: a bounded -2% price shock over the same 5-minute horizon as calibration.
 * This is an illustrative, policy-declared stress check -- never a prediction of a specific real
 * event -- so the evaluator can compare the primary decision against one concrete hypothetical.
 */
const AI_SCENARIO_POLICY: AiScenarioPolicy = Object.freeze({
  schemaVersion: 1,
  policyId: "NUSA_AI_SCENARIO_PRICE_SHOCK_POLICY_V1",
  policyVersion: "1",
  allowedDimensions: Object.freeze([CLOUD_AI_SCENARIO_PRICE_SHOCK_DIMENSION]),
  maxScenarioCount: 2,
  maxProbabilityDeltaForRobust: 0.2,
  inferenceBudget: Object.freeze({
    schemaVersion: 1,
    policyId: "NUSA_AI_SCENARIO_RESOURCE_BUDGET_V1",
    policyVersion: "1",
    maxModelCalls: 2,
    maxTotalAttempts: 2,
    maxCumulativeOutputTokens: 4096,
    maxInputBytes: 512 * 1024,
    maxWallClockMs: 20_000,
    requireUsageAccounting: true
  })
});

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
  readonly scenarioEvaluation?: AiScenarioReasoningResult;
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
  latestScenarioEvaluation(now?: number): AiScenarioReasoningResult | null;
  latestCalibrationPrediction(): AiCalibrationPrediction | null;
  calibrationProfile(): AiCalibrationProfile | null;
  calibrationDurabilityHealth(): AiCalibrationDurabilityHealth;
  isInFlight(): boolean;
  isProviderComparisonInFlight(): boolean;
  isScenarioEvaluationInFlight(): boolean;
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
  /** Undefined auto-composes a CloudAiScenarioRunner gated by NUSA_AI_SCENARIO_ENABLED; null explicitly disables it. */
  readonly scenarioEvaluator?: Pick<ScenarioCounterfactualEvaluator, "run"> | null;
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
  /**
   * Provider-comparison/scenario results captured at prediction time, but only when they are
   * actually correlated to this exact orchestration run (comparisonRunId/experimentId match) --
   * never "whatever happened to be latest" at prediction time, which could belong to a different
   * tick's evidence entirely. null means no correlated result was available yet when the
   * prediction was made, which is the honest, common case (these run concurrently and may not
   * have completed before the primary decision does).
   */
  readonly providerComparisonSnapshot: AiProviderComparisonResult | null;
  readonly scenarioSnapshot: AiScenarioReasoningResult | null;
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

/** Both identity formats are also used by scheduleProviderComparison/scheduleScenarioEvaluation below -- kept in one place so correlation checks can never drift from the identity actually assigned. */
function providerComparisonRunId(orchestrationRunId: string): string {
  return `${orchestrationRunId}:nversion`;
}
function scenarioExperimentId(orchestrationRunId: string): string {
  return `${orchestrationRunId}:scenario`;
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

/**
 * Extracts the real, already-verified market values a scenario baseline needs, straight from the
 * same evidence bundle the primary decision uses -- never a second, independently-fetched value.
 */
function deriveScenarioBaselineInputs(input: AiOrchestrationInput): Readonly<Record<string, string | number | boolean>> | null {
  const anchor = verifiedMarketAnchor(input);
  if (anchor == null) return null;
  const materialization = (input.evidenceMaterializations ?? []).find((item) => item.evidenceId === anchor.evidenceReference);
  const payload = materialization?.payload;
  if (payload == null) return null;
  const derived: Record<string, string | number | boolean> = { "market.market": anchor.targetId, "market.price": anchor.value };
  if (typeof payload.changeRate === "number" && Number.isFinite(payload.changeRate)) derived["market.changeRate"] = payload.changeRate;
  if (typeof payload.volume === "number" && Number.isFinite(payload.volume)) derived["market.volume"] = payload.volume;
  return Object.freeze(derived);
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
  const scenarioEnabled = env.NUSA_AI_SCENARIO_ENABLED?.trim().toLowerCase() === "true";
  const scenarioEvaluator: Pick<ScenarioCounterfactualEvaluator, "run"> | null = options.scenarioEvaluator === undefined
    ? scenarioEnabled
      ? new ScenarioCounterfactualEvaluator(AI_SCENARIO_POLICY, new CloudAiScenarioRunner(provider, { now }) as AiScenarioRunner, { now })
      : null
    : options.scenarioEvaluator;
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
  for (const prediction of durability.recovered().pendingPredictions) pendingPredictions.set(prediction.predictionId, Object.freeze({ prediction, predictionEvidence: null, providerComparisonSnapshot: null, scenarioSnapshot: null }));
  let attributionMemory: SqliteAiOutcomeAttributionMemory | null = null;
  try { attributionMemory = new SqliteAiOutcomeAttributionMemory(implicitDurabilityPath(env) ?? ":memory:"); }
  catch { attributionMemory = null; } // Learning memory is diagnostic-only and can never block AI scheduling.
  const attributionEngine = new GovernedOutcomeAttributionEngine(AI_ATTRIBUTION_POLICY);
  let inFlight = false;
  let comparisonInFlight = false;
  let scenarioInFlight = false;
  let lastScheduledAt = Number.NEGATIVE_INFINITY;
  let latestResult: AiOrchestrationResult | null = null;
  let latestCompletedAt: number | null = null;
  let latestExplanationVerificationResult: AiExplanationVerificationResult | null = null;
  let latestRecentLessonCount = 0;
  let latestComparison: AiProviderComparisonResult | null = null;
  let latestComparisonCompletedAt: number | null = null;
  let latestScenarioResult: AiScenarioReasoningResult | null = null;
  let latestScenarioCompletedAt: number | null = null;
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
        recordAttributionEpisode(prediction, outcome, pending.predictionEvidence, anchor, pending.providerComparisonSnapshot, pending.scenarioSnapshot);
      } catch {
        // Calibration is advisory-only. Malformed/conflicting outcomes cannot gain confidence.
      }
    }
  };

  /**
   * Only returns a provider-comparison/scenario result when it is actually correlated to the
   * given orchestration run (matching comparisonRunId/experimentId) -- these evaluations run
   * concurrently with the primary decision and may complete before, after, or not at all for any
   * given tick, so "whatever is currently latest" can silently belong to a different tick's
   * evidence. Correlation failure (including "hasn't completed yet") returns null, never a guess.
   */
  const correlatedProviderComparison = (orchestrationRunId: string): AiProviderComparisonResult | null =>
    latestComparison != null && latestComparison.comparisonRunId === providerComparisonRunId(orchestrationRunId) ? latestComparison : null;
  const correlatedScenarioResult = (orchestrationRunId: string): AiScenarioReasoningResult | null =>
    latestScenarioResult != null && latestScenarioResult.experimentId === scenarioExperimentId(orchestrationRunId) ? latestScenarioResult : null;

  /**
   * Turns a just-resolved prediction/outcome pair into a real, evidence-grounded attribution
   * episode and appends it to the learning-memory ledger. Every input here is data the calibration
   * path already verified (never fabricated): the prediction's own anchor evidence, the resolving
   * ticker's evidence, and whatever calibration/provider-comparison/scenario state was actually
   * correlated to this exact prediction's own decision (see correlatedProviderComparison/
   * correlatedScenarioResult above and their call sites in schedule()). Missing signals are left
   * null/empty rather than guessed, so the engine correctly reports UNRESOLVED/UNVERIFIED instead
   * of inventing a cause. This must never affect calibration, scheduling, or PAPER -- failures are
   * swallowed, matching the calibration catch above.
   */
  const recordAttributionEpisode = (
    prediction: AiCalibrationPrediction,
    outcome: ReturnType<typeof createCalibrationOutcome>,
    predictionEvidence: AiObservedEvidenceIdentity | null,
    anchor: VerifiedMarketAnchor,
    providerComparisonSnapshot: AiProviderComparisonResult | null,
    scenarioSnapshot: AiScenarioReasoningResult | null
  ): void => {
    if (attributionMemory == null || predictionEvidence == null) return;
    try {
      const observedEvidence: readonly AiObservedEvidenceIdentity[] = Object.freeze([
        predictionEvidence,
        Object.freeze({ evidenceId: anchor.evidenceReference, contentDigest: anchor.contentDigest, provenance: prediction.provenance })
      ]);
      const profile = currentProfile();
      // Scenario lineage requires the full AiAttributionScenarioLineage shape or nothing at all --
      // partially filling it, or setting signals.scenarioRobustnessState without it, fails closed
      // inside GovernedOutcomeAttributionEngine's own validation and the episode is simply dropped.
      const scenarioLineage = scenarioSnapshot == null ? undefined : Object.freeze({
        experimentId: scenarioSnapshot.experimentId,
        policyIdentity: scenarioSnapshot.policyIdentity,
        baselineIdentity: scenarioSnapshot.baselineIdentity,
        resultIdentity: aiSha256(scenarioSnapshot),
        robustnessState: scenarioSnapshot.robustnessState,
        provenance: "HYPOTHETICAL_ANALYSIS" as const
      });
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
          evidenceSnapshotIdentity: aiAttributionEvidenceSnapshotIdentity(prediction, outcome, observedEvidence),
          ...(scenarioLineage == null ? {} : { scenario: scenarioLineage })
        },
        signals: {
          evidenceGapEvidenceReferences: [],
          dataQualityFailureEvidenceReferences: [],
          providerComparisonState: providerComparisonSnapshot?.comparisonState ?? null,
          calibrationStatus: profile?.status ?? "UNKNOWN",
          scenarioRobustnessState: scenarioSnapshot?.robustnessState ?? null,
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

  /**
   * Runs the BASELINE scenario against a real observed intervention-free market and one bounded
   * HYPOTHETICAL price-shock scenario, both against the exact evidence this tick already produced.
   * Never blocks or alters the primary decision -- a robustness check, not a second opinion.
   */
  const scheduleScenarioEvaluation = (input: AiOrchestrationInput): void => {
    if (scenarioEvaluator == null || scenarioInFlight) return;
    const derivedInputs = deriveScenarioBaselineInputs(input);
    if (derivedInputs == null) return;
    const baseline: AiScenarioBaseline = Object.freeze({ decisionId: input.decisionId, evaluatedAt: input.evaluatedAt, evidence: input.evidence, evidenceMaterializations: input.evidenceMaterializations ?? [], derivedInputs });
    const definitions: readonly AiScenarioDefinition[] = Object.freeze([
      Object.freeze({ scenarioId: "baseline", kind: "BASELINE" as const, interventions: Object.freeze([]) }),
      Object.freeze({ scenarioId: "price-shock-down-2pct", kind: "HYPOTHETICAL" as const, interventions: Object.freeze([Object.freeze({ dimension: CLOUD_AI_SCENARIO_PRICE_SHOCK_DIMENSION, value: -0.02, horizonMs: AI_CALIBRATION_HORIZON_MS })]) })
    ]);
    scenarioInFlight = true;
    void scenarioEvaluator.run(`${input.orchestrationRunId}:scenario`, baseline, definitions).then((result) => {
      const completedAt = now();
      if (result.liveAuthority === "NONE" && result.realOrderAuthority === false && result.realTransferAuthority === false && result.productionMutationAllowed === false && Number.isSafeInteger(completedAt) && completedAt > 0) {
        latestScenarioResult = result;
        latestScenarioCompletedAt = completedAt;
      }
    }).catch(() => {
      // Scenario robustness is advisory-only and cannot disturb the primary AI or PAPER.
    }).finally(() => {
      scenarioInFlight = false;
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
    scheduleScenarioEvaluation(input);
    void orchestrator.run(input).then((result) => {
      const completedAt = now();
      if (result.status === "COMPLETED" && zeroAuthority(result) && Number.isSafeInteger(completedAt) && completedAt > 0) {
        latestResult = result;
        latestCompletedAt = completedAt;
        latestRecentLessonCount = countLessonEvidence(input);
        try {
          const profileForEnvelope = currentProfile();
          const correlatedComparison = correlatedProviderComparison(input.orchestrationRunId);
          const correlatedScenario = correlatedScenarioResult(input.orchestrationRunId);
          const hypotheticalScenario = correlatedScenario?.evaluations.find((item) => item.kind === "HYPOTHETICAL" && item.status === "COMPLETED");
          const envelope = buildAiExplanationEnvelope(input, result, {
            explanationId: `${result.orchestrationRunId}:explanation`,
            observedAt: completedAt,
            providerId: provider.providerId,
            resourcePolicy: result.inferenceResources?.policy ?? normalizeAiInferenceBudgetPolicy(undefined),
            calibrationCohort: profileForEnvelope?.status === "CALIBRATED" ? profileForEnvelope.cohort : null,
            providerDisagreement: correlatedComparison?.comparisonState === "DISAGREEMENT",
            confidence: profileForEnvelope?.status === "CALIBRATED" ? profileForEnvelope.effectiveConfidence : 0,
            scenarioIdentity: hypotheticalScenario?.scenarioIdentity ?? null
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
              predictionEvidence: Object.freeze({ evidenceId: anchor.evidenceReference, contentDigest: anchor.contentDigest, provenance: prediction.provenance }),
              providerComparisonSnapshot: correlatedProviderComparison(input.orchestrationRunId),
              scenarioSnapshot: correlatedScenarioResult(input.orchestrationRunId)
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

  const latestScenarioEvaluation = (at = now()): AiScenarioReasoningResult | null => {
    if (latestScenarioResult == null || latestScenarioCompletedAt == null || !Number.isSafeInteger(at) || at <= 0) return null;
    if (latestScenarioCompletedAt > at || at - latestScenarioCompletedAt > maximumResultAgeMs) return null;
    return latestScenarioResult;
  };

  const latest = (at = now()): CloudAiOrchestrationResult | null => {
    if (latestResult == null || latestCompletedAt == null || !Number.isSafeInteger(at) || at <= 0) return null;
    if (latestCompletedAt > at || at - latestCompletedAt > maximumResultAgeMs) return null;
    const providerComparison = latestProviderComparison(at);
    const explanationVerification = latestExplanationVerification(at);
    const scenarioEvaluation = latestScenarioEvaluation(at);
    return Object.freeze({
      ...latestResult,
      calibrationProfile: currentProfile(),
      calibrationDurabilityHealth: durability.snapshot(),
      recentLessonCount: latestRecentLessonCount,
      ...(providerComparison == null ? {} : { providerComparison }),
      ...(explanationVerification == null ? {} : { explanationVerification }),
      ...(scenarioEvaluation == null ? {} : { scenarioEvaluation })
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
    latestScenarioEvaluation,
    latestCalibrationPrediction: () => latestPrediction,
    calibrationProfile: currentProfile,
    calibrationDurabilityHealth: () => durability.snapshot(),
    isInFlight: () => inFlight,
    isProviderComparisonInFlight: () => comparisonInFlight,
    isScenarioEvaluationInFlight: () => scenarioInFlight,
    liveAuthority: "NONE" as const,
    productionMutationAllowed: false as const
  });
}
