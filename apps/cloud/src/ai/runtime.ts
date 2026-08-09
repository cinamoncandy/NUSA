import fs from "node:fs";
import path from "node:path";
import { aiSha256, type AiCalibrationOutcome, type AiCalibrationPrediction, type AiCalibrationProfile, type AiReadOnlyProjection, type ModelProvider } from "../../../../packages/contracts/src/aiInference";
import { SqliteDatabase } from "../../../../packages/storage/src/index";
import { SqliteAiCalibrationStore, type AiCalibrationDurableSnapshot } from "../../../../packages/storage/src/aiCalibrationStore";
import { createModelProviderFromEnvironment } from "./modelProvider";
import { MultiAgentOrchestrator, type AiOrchestrationInput, type AiOrchestrationResult } from "./multiAgentOrchestrator";
import { createVerifiedRuntimeCalibrationPrediction } from "./calibrationBridge";
import { createCalibrationOutcome, OutcomeCalibrationLedger, type CalibrationPolicy } from "./outcomeCalibration";
import { projectAiReadOnly } from "./projection";

export const AI_CALIBRATION_OUTCOME_DEFINITION_ID = "UPBIT_PUBLIC_PRICE_HIGHER_AFTER_5M";
export const AI_CALIBRATION_OUTCOME_DEFINITION_VERSION = "1";
export const AI_CALIBRATION_HORIZON_MS = 5 * 60 * 1_000;
/** The audited 5-minute outcome accepts only a narrowly bounded observation after its due time. */
export const AI_CALIBRATION_RESOLUTION_GRACE_MS = 60_000;

export interface CloudAiRuntime {
  readonly enabled: boolean;
  readonly orchestrator: MultiAgentOrchestrator;
  schedule(input: AiOrchestrationInput): boolean;
  latest(now?: number): AiOrchestrationResult | null;
  latestProjection(now?: number): AiReadOnlyProjection | null;
  latestCalibrationPrediction(): AiCalibrationPrediction | null;
  calibrationProfile(): AiCalibrationProfile | null;
  isInFlight(): boolean;
  readonly liveAuthority: "NONE";
  readonly productionMutationAllowed: false;
}

export interface CloudAiCalibrationOptions {
  readonly outcomeDefinitionId: string;
  readonly outcomeDefinitionVersion: string;
  readonly horizonMs: number;
  readonly policy?: CalibrationPolicy;
}

export interface CloudAiCalibrationPersistence {
  recover(): AiCalibrationDurableSnapshot;
  recordPrediction(prediction: AiCalibrationPrediction): void;
  recordOutcome(outcome: AiCalibrationOutcome): void;
  expirePrediction(prediction: AiCalibrationPrediction): void;
}

export interface CloudAiRuntimeOptions {
  readonly now?: () => number;
  readonly minimumCadenceMs?: number;
  readonly maximumResultAgeMs?: number;
  readonly calibration?: CloudAiCalibrationOptions;
  readonly calibrationPersistence?: CloudAiCalibrationPersistence;
}

interface VerifiedMarketAnchor {
  readonly targetId: string;
  readonly value: number;
  readonly observedAt: number;
  readonly evidenceReference: string;
}

interface PendingPrediction {
  readonly prediction: AiCalibrationPrediction;
}

interface PersistenceResolution {
  readonly persistence?: CloudAiCalibrationPersistence;
  readonly healthy: boolean;
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

function zeroAuthority(result: AiOrchestrationResult): boolean {
  return result.liveAuthority === "NONE" && result.realOrderAuthority === false && result.realTransferAuthority === false && result.productionMutationAllowed === false && (result.governanceDecision == null || (result.governanceDecision.realOrderAuthority === false && result.governanceDecision.realTransferAuthority === false && result.governanceDecision.productionMutationAllowed === false));
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
    return Object.freeze({ targetId: payload.market.trim(), value: payload.price, observedAt, evidenceReference: evidence.evidenceId });
  }
  return null;
}

function supportsAutomaticResolution(calibration: CloudAiCalibrationOptions): boolean {
  return calibration.outcomeDefinitionId === AI_CALIBRATION_OUTCOME_DEFINITION_ID
    && calibration.outcomeDefinitionVersion === AI_CALIBRATION_OUTCOME_DEFINITION_VERSION
    && calibration.horizonMs === AI_CALIBRATION_HORIZON_MS;
}

function environmentPersistence(env: NodeJS.ProcessEnv, enabled: boolean): PersistenceResolution {
  if (!enabled) return Object.freeze({ healthy: true });
  const configured = env.NUSA_CLOUD_STATE_DB_PATH?.trim();
  if (!configured || configured === ":memory:") return Object.freeze({ healthy: true });
  try {
    const absolute = path.resolve(configured);
    const sourceRoot = path.resolve(process.cwd());
    const sourceTree = sourceRoot + path.sep;
    if (absolute === sourceRoot || absolute.startsWith(sourceTree)) throw new Error("AI calibration database must not be inside the source tree");
    fs.mkdirSync(path.dirname(absolute), { recursive: true });
    const database = new SqliteDatabase(absolute);
    return Object.freeze({ persistence: new SqliteAiCalibrationStore(database), healthy: true });
  } catch {
    return Object.freeze({ healthy: false });
  }
}

function newestPrediction(predictions: readonly AiCalibrationPrediction[]): AiCalibrationPrediction | null {
  let newest: AiCalibrationPrediction | null = null;
  for (const prediction of predictions) {
    if (newest == null || prediction.predictedAt > newest.predictedAt || (prediction.predictedAt === newest.predictedAt && prediction.predictionId > newest.predictionId)) newest = prediction;
  }
  return newest;
}

export function createCloudAiRuntime(env: NodeJS.ProcessEnv = process.env, provider: ModelProvider = createModelProviderFromEnvironment(env), options: CloudAiRuntimeOptions = {}): CloudAiRuntime {
  const enabled = env.NUSA_AI_ENABLED?.trim().toLowerCase() === "true";
  const now = options.now ?? Date.now;
  const minimumCadenceMs = duration(options.minimumCadenceMs, 30_000, "AI minimum cadence");
  const maximumResultAgeMs = duration(options.maximumResultAgeMs, 120_000, "AI maximum result age");
  const calibration = calibrationOptions(options.calibration);
  const resolvedPersistence = options.calibrationPersistence == null ? environmentPersistence(env, enabled) : Object.freeze({ persistence: options.calibrationPersistence, healthy: true });
  const calibrationPersistence = resolvedPersistence.persistence;
  const calibrationLedger = new OutcomeCalibrationLedger();
  const orchestrator = new MultiAgentOrchestrator(provider, { enabled });
  const pendingPredictions = new Map<string, PendingPrediction>();
  let calibrationHealthy = resolvedPersistence.healthy;
  let inFlight = false;
  let lastScheduledAt = Number.NEGATIVE_INFINITY;
  let latestResult: AiOrchestrationResult | null = null;
  let latestCompletedAt: number | null = null;
  let latestPrediction: AiCalibrationPrediction | null = null;

  const failCalibration = (): void => {
    calibrationHealthy = false;
    pendingPredictions.clear();
  };

  const recoverCalibration = (): void => {
    if (calibrationPersistence == null || !calibrationHealthy) return;
    try {
      const snapshot = calibrationPersistence.recover();
      for (const prediction of snapshot.predictions) calibrationLedger.appendPrediction(prediction);
      for (const outcome of snapshot.outcomes) calibrationLedger.appendOutcome(outcome);
      latestPrediction = newestPrediction(snapshot.predictions);
      const recoveryNow = now();
      if (!Number.isSafeInteger(recoveryNow) || recoveryNow <= 0) throw new Error("AI calibration recovery clock is invalid");
      const predictions = new Map(snapshot.predictions.map((prediction) => [prediction.predictionId, prediction] as const));
      const outcomes = new Set(snapshot.outcomes.map((outcome) => outcome.predictionId));
      for (const pending of snapshot.pending) {
        const prediction = predictions.get(pending.predictionId);
        if (prediction == null || prediction.contentHash !== pending.predictionContentHash || outcomes.has(pending.predictionId)) throw new Error("AI calibration durable pending linkage is invalid");
        if (supportsAutomaticResolution(calibration) && recoveryNow > prediction.predictedAt + prediction.horizonMs + AI_CALIBRATION_RESOLUTION_GRACE_MS) {
          calibrationPersistence.expirePrediction(prediction);
          continue;
        }
        pendingPredictions.set(prediction.predictionId, Object.freeze({ prediction }));
      }
    } catch {
      latestPrediction = null;
      failCalibration();
    }
  };

  recoverCalibration();

  const resolvePending = (anchor: VerifiedMarketAnchor | null): void => {
    if (anchor == null || !supportsAutomaticResolution(calibration) || !calibrationHealthy) return;
    for (const [predictionId, pending] of pendingPredictions) {
      const prediction = pending.prediction;
      if (prediction.targetId !== anchor.targetId) continue;
      const dueAt = prediction.predictedAt + prediction.horizonMs;
      if (anchor.observedAt > dueAt + AI_CALIBRATION_RESOLUTION_GRACE_MS) {
        try { calibrationPersistence?.expirePrediction(prediction); }
        catch { failCalibration(); return; }
        pendingPredictions.delete(predictionId);
        continue;
      }
      if (anchor.observedAt < dueAt) continue;
      try {
        const outcome = calibrationLedger.appendOutcome(createCalibrationOutcome({
          predictionId: prediction.predictionId,
          predictionContentHash: prediction.contentHash,
          outcomeDefinitionId: prediction.outcomeDefinitionId,
          outcomeDefinitionVersion: prediction.outcomeDefinitionVersion,
          outcome: anchor.value > prediction.anchorValue,
          resolvedValue: anchor.value,
          resolvedAt: anchor.observedAt,
          evidenceReferences: [anchor.evidenceReference],
          provenance: "VERIFIED_RUNTIME"
        }));
        calibrationPersistence?.recordOutcome(outcome);
        pendingPredictions.delete(predictionId);
      } catch {
        if (calibrationPersistence != null) failCalibration();
        // Calibration is advisory-only. A malformed/conflicting durable outcome can never gain confidence.
      }
    }
  };

  const schedule = (input: AiOrchestrationInput): boolean => {
    const anchor = verifiedMarketAnchor(input);
    resolvePending(anchor);
    const scheduledAt = now();
    if (!Number.isSafeInteger(scheduledAt) || scheduledAt <= 0) return false;
    if (!enabled || inFlight || scheduledAt - lastScheduledAt < minimumCadenceMs) return false;
    lastScheduledAt = scheduledAt;
    inFlight = true;
    void orchestrator.run(input).then((result) => {
      const completedAt = now();
      if (result.status === "COMPLETED" && zeroAuthority(result) && Number.isSafeInteger(completedAt) && completedAt > 0) {
        latestResult = result;
        latestCompletedAt = completedAt;
        if (anchor != null) {
          try {
            latestPrediction = calibrationLedger.appendPrediction(createVerifiedRuntimeCalibrationPrediction(result, {
              providerId: provider.providerId,
              outcomeDefinitionId: calibration.outcomeDefinitionId,
              outcomeDefinitionVersion: calibration.outcomeDefinitionVersion,
              horizonMs: calibration.horizonMs,
              targetId: anchor.targetId,
              anchorValue: anchor.value,
              anchorObservedAt: anchor.observedAt,
              anchorEvidenceReference: anchor.evidenceReference
            }));
            if (calibrationHealthy) {
              try { calibrationPersistence?.recordPrediction(latestPrediction); }
              catch { failCalibration(); }
            }
            if (calibrationHealthy) pendingPredictions.set(latestPrediction.predictionId, Object.freeze({ prediction: latestPrediction }));
          } catch {
            // A valid zero-authority AI result may remain readable, but no verified anchor means no calibration credit.
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
    if (latestPrediction == null || !calibrationHealthy) return null;
    try {
      return calibrationLedger.profile(latestPrediction, latestPrediction.rawProbability, calibration.policy);
    } catch {
      return null;
    }
  };

  const latest = (at = now()): AiOrchestrationResult | null => {
    if (latestResult == null || latestCompletedAt == null || !Number.isSafeInteger(at) || at <= 0) return null;
    if (latestCompletedAt > at || at - latestCompletedAt > maximumResultAgeMs) return null;
    return Object.freeze({ ...latestResult, calibrationProfile: currentProfile() }) as AiOrchestrationResult;
  };

  const latestProjection = (at = now()): AiReadOnlyProjection | null => {
    const result = latest(at);
    return result == null ? null : projectAiReadOnly(result);
  };

  return Object.freeze({
    enabled,
    orchestrator,
    schedule,
    latest,
    latestProjection,
    latestCalibrationPrediction: () => latestPrediction,
    calibrationProfile: currentProfile,
    isInFlight: () => inFlight,
    liveAuthority: "NONE" as const,
    productionMutationAllowed: false as const
  });
}
