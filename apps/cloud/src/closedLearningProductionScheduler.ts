import type { ClosedLearningCycleResult, ClosedLearningEvidenceIdentity, ClosedLearningLoopCoordinator } from "./closedLearningLoopCoordinator";

export interface ClosedLearningEvidenceSource {
  read(): ClosedLearningEvidenceIdentity | undefined;
}

export interface ClosedLearningProductionSchedulerOptions {
  readonly evidence: ClosedLearningEvidenceSource;
  readonly coordinator: Pick<ClosedLearningLoopCoordinator, "run">;
  readonly intervalMs?: number;
  readonly onResult?: (result: ClosedLearningCycleResult) => void;
  readonly onError?: (error: Error) => void;
  readonly setIntervalFn?: typeof setInterval;
  readonly clearIntervalFn?: typeof clearInterval;
}

const DEFAULT_INTERVAL_MS = 60_000;

/**
 * Serial production scheduler for the closed-learning coordinator. It does not invent evidence,
 * rerun a completed identity, or acquire execution authority. The coordinator remains the replay
 * and promotion boundary; this class only supplies cadence and single-flight execution.
 */
export class ClosedLearningProductionScheduler {
  private timer: ReturnType<typeof setInterval> | undefined;
  private running = false;
  private readonly intervalMs: number;
  private readonly setIntervalFn: typeof setInterval;
  private readonly clearIntervalFn: typeof clearInterval;

  public constructor(private readonly options: ClosedLearningProductionSchedulerOptions) {
    this.intervalMs = options.intervalMs ?? DEFAULT_INTERVAL_MS;
    if (!Number.isSafeInteger(this.intervalMs) || this.intervalMs < 1_000 || this.intervalMs > 86_400_000) throw new Error("closed learning scheduler interval is invalid");
    this.setIntervalFn = options.setIntervalFn ?? setInterval;
    this.clearIntervalFn = options.clearIntervalFn ?? clearInterval;
  }

  public runOnce(): ClosedLearningCycleResult | undefined {
    if (this.running) return undefined;
    this.running = true;
    try {
      const evidence = this.options.evidence.read();
      if (evidence == null) return undefined;
      const result = this.options.coordinator.run(evidence);
      this.options.onResult?.(result);
      return result;
    } catch (error) {
      const normalized = error instanceof Error ? error : new Error("closed learning cycle failed");
      this.options.onError?.(normalized);
      return undefined;
    } finally {
      this.running = false;
    }
  }

  public start(): void {
    if (this.timer != null) return;
    this.runOnce();
    this.timer = this.setIntervalFn(() => this.runOnce(), this.intervalMs);
    this.timer.unref?.();
  }

  public stop(): void {
    if (this.timer == null) return;
    this.clearIntervalFn(this.timer);
    this.timer = undefined;
  }
}
