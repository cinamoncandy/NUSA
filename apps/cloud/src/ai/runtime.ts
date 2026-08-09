import type { AiCalibrationOutcome, AiCalibrationPrediction, AiCalibrationProfile, AiReadOnlyProjection, ModelProvider } from "../../../../packages/contracts/src/aiInference";
import { createModelProviderFromEnvironment } from "./modelProvider";
import { MultiAgentOrchestrator, type AiOrchestrationInput, type AiOrchestrationResult } from "./multiAgentOrchestrator";
import { createVerifiedRuntimeCalibrationPrediction } from "./calibrationBridge";
import { OutcomeCalibrationLedger, type CalibrationPolicy } from "./outcomeCalibration";
import { projectAiReadOnly } from "./projection";

export interface CloudAiRuntime {
  readonly enabled: boolean;
  readonly orchestrator: MultiAgentOrchestrator;
  schedule(input: AiOrchestrationInput): boolean;
  latest(now?: number): AiOrchestrationResult | null;
  latestProjection(now?: number): AiReadOnlyProjection | null;
  latestCalibrationPrediction(): AiCalibrationPrediction | null;
  calibrationProfile(): AiCalibrationProfile | null;
  recordCalibrationOutcome(outcome: AiCalibrationOutcome): AiCalibrationOutcome;
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

export interface CloudAiRuntimeOptions {
  readonly now?: () => number;
  readonly minimumCadenceMs?: number;
  readonly maximumResultAgeMs?: number;
  readonly calibration?: CloudAiCalibrationOptions;
}

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

function calibrationOptions(value: CloudAiCalibrationOptions | undefined): CloudAiCalibrationOptions | undefined {
  if (value == null) return undefined;
  if (!Number.isSafeInteger(value.horizonMs) || value.horizonMs < 1) throw new Error("AI calibration horizon must be a positive safe integer");
  return Object.freeze({
    outcomeDefinitionId: requiredText(value.outcomeDefinitionId, "AI calibration outcomeDefinitionId"),
    outcomeDefinitionVersion: requiredText(value.outcomeDefinitionVersion, "AI calibration outcomeDefinitionVersion"),
    horizonMs: value.horizonMs,
    policy: value.policy == null ? undefined : Object.freeze({ ...value.policy })
  });
}

function zeroAuthority(result: AiOrchestrationResult): boolean {
  return result.liveAuthority === "NONE" && result.realOrderAuthority === false && result.realTransferAuthority === false && result.productionMutationAllowed === false && (result.governanceDecision == null || (result.governanceDecision.realOrderAuthority === false && result.governanceDecision.realTransferAuthority === false && result.governanceDecision.productionMutationAllowed === false));
}

export function createCloudAiRuntime(env: NodeJS.ProcessEnv = process.env, provider: ModelProvider = createModelProviderFromEnvironment(env), options: CloudAiRuntimeOptions = {}): CloudAiRuntime {
  const enabled = env.NUSA_AI_ENABLED?.trim().toLowerCase() === "true";
  const now = options.now ?? Date.now;
  const minimumCadenceMs = duration(options.minimumCadenceMs, 30_000, "AI minimum cadence");
  const maximumResultAgeMs = duration(options.maximumResultAgeMs, 120_000, "AI maximum result age");
  const calibration = calibrationOptions(options.calibration);
  const calibrationLedger = new OutcomeCalibrationLedger();
  const orchestrator = new MultiAgentOrchestrator(provider, { enabled });
  let inFlight = false;
  let lastScheduledAt = Number.NEGATIVE_INFINITY;
  let latestResult: AiOrchestrationResult | null = null;
  let latestCompletedAt: number | null = null;
  let latestPrediction: AiCalibrationPrediction | null = null;

  const schedule = (input: AiOrchestrationInput): boolean => {
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
        if (calibration != null) {
          try {
            latestPrediction = calibrationLedger.appendPrediction(createVerifiedRuntimeCalibrationPrediction(result, {
              providerId: provider.providerId,
              outcomeDefinitionId: calibration.outcomeDefinitionId,
              outcomeDefinitionVersion: calibration.outcomeDefinitionVersion,
              horizonMs: calibration.horizonMs
            }));
          } catch {
            // Calibration is analytical-only and fails closed. A valid zero-authority AI result may remain readable,
            // but it cannot acquire trusted confidence unless a verified prediction identity was recorded.
            latestPrediction = null;
          }
        }
      }
    }).catch(() => {
      // AI is isolated from PAPER. Existing validated AI state is retained until it naturally becomes stale.
    }).finally(() => {
      inFlight = false;
    });
    return true;
  };

  const latest = (at = now()): AiOrchestrationResult | null => {
    if (latestResult == null || latestCompletedAt == null || !Number.isSafeInteger(at) || at <= 0) return null;
    if (latestCompletedAt > at || at - latestCompletedAt > maximumResultAgeMs) return null;
    return latestResult;
  };

  const currentProfile = (): AiCalibrationProfile | null => {
    if (latestPrediction == null || calibration == null) return null;
    try {
      return calibrationLedger.profile(latestPrediction, latestPrediction.rawProbability, calibration.policy);
    } catch {
      return null;
    }
  };

  const latestProjection = (at = now()): AiReadOnlyProjection | null => {
    const result = latest(at);
    return result == null ? null : projectAiReadOnly(result, currentProfile());
  };

  const recordCalibrationOutcome = (outcome: AiCalibrationOutcome): AiCalibrationOutcome => calibrationLedger.appendOutcome(outcome);

  return Object.freeze({
    enabled,
    orchestrator,
    schedule,
    latest,
    latestProjection,
    latestCalibrationPrediction: () => latestPrediction,
    calibrationProfile: currentProfile,
    recordCalibrationOutcome,
    isInFlight: () => inFlight,
    liveAuthority: "NONE" as const,
    productionMutationAllowed: false as const
  });
}
