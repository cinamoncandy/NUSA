import type { AiCalibrationOutcome, AiCalibrationPrediction } from "./aiInference";

export type AiCalibrationDurabilityStatus = "DISABLED" | "HEALTHY" | "UNHEALTHY";
export type AiCalibrationDurabilityErrorCode = "OPEN_FAILED" | "REPLAY_FAILED" | "APPEND_FAILED" | "EXPIRE_FAILED";

export interface AiCalibrationPendingExpiry {
  readonly predictionId: string;
  readonly predictionContentHash: string;
  readonly expiredAt: number;
}

export interface AiCalibrationDurableReplay {
  readonly schemaVersion: 1;
  readonly predictions: readonly AiCalibrationPrediction[];
  readonly outcomes: readonly AiCalibrationOutcome[];
  readonly expiredPending: readonly AiCalibrationPendingExpiry[];
  readonly eventCount: number;
  readonly headHash: string;
}

export interface AiCalibrationDurabilityHealth {
  readonly status: AiCalibrationDurabilityStatus;
  readonly recoveredPredictionCount: number;
  readonly recoveredOutcomeCount: number;
  readonly recoveredPendingCount: number;
  readonly expiredPendingCount: number;
  readonly eventCount: number;
  readonly headHash: string | null;
  readonly errorCode?: AiCalibrationDurabilityErrorCode;
}

/**
 * Zero-authority durable boundary for outcome calibration metadata only.
 * Implementations must never persist provider/broker credentials, raw prompts,
 * hidden reasoning, or raw evidence payloads.
 */
export interface AiCalibrationDurableStore {
  replay(): AiCalibrationDurableReplay;
  appendPrediction(prediction: AiCalibrationPrediction, recordedAt: number): void;
  appendOutcomeAndResolve(outcome: AiCalibrationOutcome, recordedAt: number): void;
  expirePending(expiry: AiCalibrationPendingExpiry): void;
  close?(): void;
}
