import type {
  AiCalibrationDurabilityErrorCode,
  AiCalibrationDurabilityHealth,
  AiCalibrationDurableStore
} from "../../../../packages/contracts/src/aiCalibrationDurability";
import type { AiCalibrationOutcome, AiCalibrationPrediction } from "../../../../packages/contracts/src/aiInference";
import { OutcomeCalibrationLedger } from "./outcomeCalibration";

const disabledHealth = (): AiCalibrationDurabilityHealth => Object.freeze({
  status: "DISABLED",
  recoveredPredictionCount: 0,
  recoveredOutcomeCount: 0,
  recoveredPendingCount: 0,
  expiredPendingCount: 0,
  eventCount: 0,
  headHash: null
});

function safeLatestAllowed(prediction: AiCalibrationPrediction, graceMs: number): number {
  if (!Number.isSafeInteger(prediction.predictedAt) || prediction.predictedAt < 0) throw new Error("calibration predictedAt is invalid");
  if (!Number.isSafeInteger(prediction.horizonMs) || prediction.horizonMs < 1) throw new Error("calibration horizon is invalid");
  if (!Number.isSafeInteger(graceMs) || graceMs < 0) throw new Error("calibration grace is invalid");
  const latestAllowed = prediction.predictedAt + prediction.horizonMs + graceMs;
  if (!Number.isSafeInteger(latestAllowed)) throw new Error("calibration resolution window is invalid");
  return latestAllowed;
}

export interface CalibrationDurabilityRecovery {
  readonly pendingPredictions: readonly AiCalibrationPrediction[];
  readonly latestPrediction: AiCalibrationPrediction | null;
}

/**
 * Application-side recovery coordinator. The durable adapter stores only canonical metadata;
 * this layer replays every prediction/outcome through the existing semantic ledger so restart
 * recovery cannot bypass the runtime validators that gate calibration trust.
 */
export class CalibrationDurabilityRuntime {
  private health: AiCalibrationDurabilityHealth = disabledHealth();
  private recovery: CalibrationDurabilityRecovery = Object.freeze({ pendingPredictions: Object.freeze([]), latestPrediction: null });

  public constructor(
    private readonly ledger: OutcomeCalibrationLedger,
    private readonly store: AiCalibrationDurableStore | undefined,
    recoveryNow: number,
    private readonly graceMs: number,
    openFailure = false
  ) {
    if (openFailure) {
      this.health = this.failedHealth("OPEN_FAILED");
      return;
    }
    if (store == null) return;
    this.recover(recoveryNow);
  }

  public snapshot(): AiCalibrationDurabilityHealth { return this.health; }
  public recovered(): CalibrationDurabilityRecovery { return this.recovery; }
  public trusted(): boolean { return this.health.status !== "UNHEALTHY"; }

  public persistPrediction(prediction: AiCalibrationPrediction, recordedAt: number): boolean {
    if (this.health.status === "DISABLED") return true;
    if (this.store == null || this.health.status !== "HEALTHY") return false;
    try {
      this.store.appendPrediction(prediction, recordedAt);
      this.refreshHealth();
      return true;
    } catch {
      this.health = this.failedHealth("APPEND_FAILED");
      return false;
    }
  }

  public persistOutcome(outcome: AiCalibrationOutcome, recordedAt: number): boolean {
    if (this.health.status === "DISABLED") return true;
    if (this.store == null || this.health.status !== "HEALTHY") return false;
    try {
      this.store.appendOutcomeAndResolve(outcome, recordedAt);
      this.refreshHealth();
      return true;
    } catch {
      this.health = this.failedHealth("APPEND_FAILED");
      return false;
    }
  }

  public persistExpiry(prediction: AiCalibrationPrediction, expiredAt: number): boolean {
    try {
      if (!Number.isSafeInteger(expiredAt) || expiredAt <= safeLatestAllowed(prediction, this.graceMs)) {
        throw new Error("calibration pending expiry is premature");
      }
    } catch {
      if (this.health.status !== "DISABLED") this.health = this.failedHealth("EXPIRE_FAILED");
      return false;
    }
    if (this.health.status === "DISABLED") return true;
    if (this.store == null || this.health.status !== "HEALTHY") return false;
    try {
      this.store.expirePending({
        predictionId: prediction.predictionId,
        predictionContentHash: prediction.contentHash,
        expiredAt
      });
      this.refreshHealth();
      return true;
    } catch {
      this.health = this.failedHealth("EXPIRE_FAILED");
      return false;
    }
  }

  private recover(recoveryNow: number): void {
    if (this.store == null) return;
    try {
      if (!Number.isSafeInteger(recoveryNow) || recoveryNow <= 0) throw new Error("calibration recovery time is invalid");
      let replay = this.store.replay();
      const predictionsById = new Map(replay.predictions.map((prediction) => [prediction.predictionId, prediction] as const));
      for (const prediction of replay.predictions) {
        if (!Number.isSafeInteger(prediction.predictedAt) || prediction.predictedAt > recoveryNow) {
          throw new Error("durable calibration prediction chronology is invalid");
        }
      }
      for (const outcome of replay.outcomes) {
        if (!Number.isSafeInteger(outcome.resolvedAt) || outcome.resolvedAt > recoveryNow) {
          throw new Error("durable calibration outcome chronology is invalid");
        }
      }
      for (const expiry of replay.expiredPending) {
        const prediction = predictionsById.get(expiry.predictionId);
        if (prediction == null) throw new Error("durable calibration expiry prediction is missing");
        if (expiry.predictionContentHash.toLowerCase() !== prediction.contentHash.toLowerCase()) throw new Error("durable calibration expiry linkage mismatch");
        if (!Number.isSafeInteger(expiry.expiredAt) || expiry.expiredAt > recoveryNow || expiry.expiredAt <= safeLatestAllowed(prediction, this.graceMs)) {
          throw new Error("durable calibration expiry chronology is invalid");
        }
      }
      for (const prediction of replay.predictions) this.ledger.appendPrediction(prediction);
      for (const outcome of replay.outcomes) this.ledger.appendOutcome(outcome);

      const terminal = new Set<string>([
        ...replay.outcomes.map((outcome) => outcome.predictionId),
        ...replay.expiredPending.map((expiry) => expiry.predictionId)
      ]);
      const pending: AiCalibrationPrediction[] = [];
      let expiredOnRecovery = false;
      for (const prediction of replay.predictions) {
        if (terminal.has(prediction.predictionId)) continue;
        if (recoveryNow > safeLatestAllowed(prediction, this.graceMs)) {
          this.store.expirePending({
            predictionId: prediction.predictionId,
            predictionContentHash: prediction.contentHash,
            expiredAt: recoveryNow
          });
          expiredOnRecovery = true;
          continue;
        }
        pending.push(prediction);
      }
      if (expiredOnRecovery) replay = this.store.replay();
      this.health = Object.freeze({
        status: "HEALTHY",
        recoveredPredictionCount: replay.predictions.length,
        recoveredOutcomeCount: replay.outcomes.length,
        recoveredPendingCount: pending.length,
        expiredPendingCount: replay.expiredPending.length,
        eventCount: replay.eventCount,
        headHash: replay.headHash
      });
      this.recovery = Object.freeze({
        pendingPredictions: Object.freeze(pending),
        latestPrediction: replay.predictions.at(-1) ?? null
      });
    } catch {
      this.health = this.failedHealth("REPLAY_FAILED");
      this.recovery = Object.freeze({ pendingPredictions: Object.freeze([]), latestPrediction: null });
    }
  }

  private refreshHealth(): void {
    if (this.store == null || this.health.status !== "HEALTHY") return;
    const replay = this.store.replay();
    const terminal = new Set<string>([
      ...replay.outcomes.map((outcome) => outcome.predictionId),
      ...replay.expiredPending.map((expiry) => expiry.predictionId)
    ]);
    const pendingCount = replay.predictions.reduce((count, prediction) => count + (terminal.has(prediction.predictionId) ? 0 : 1), 0);
    this.health = Object.freeze({
      status: "HEALTHY",
      recoveredPredictionCount: replay.predictions.length,
      recoveredOutcomeCount: replay.outcomes.length,
      recoveredPendingCount: pendingCount,
      expiredPendingCount: replay.expiredPending.length,
      eventCount: replay.eventCount,
      headHash: replay.headHash
    });
  }

  private failedHealth(errorCode: AiCalibrationDurabilityErrorCode): AiCalibrationDurabilityHealth {
    return Object.freeze({
      status: "UNHEALTHY",
      recoveredPredictionCount: this.health.recoveredPredictionCount,
      recoveredOutcomeCount: this.health.recoveredOutcomeCount,
      recoveredPendingCount: 0,
      expiredPendingCount: this.health.expiredPendingCount,
      eventCount: this.health.eventCount,
      headHash: this.health.headHash,
      errorCode
    });
  }
}
