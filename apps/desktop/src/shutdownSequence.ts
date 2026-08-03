/**
 * The ordered close-down an owner-initiated quit runs (WO-0034-A4O req 8).
 *
 * The order is the whole point, and it is not arbitrary:
 *
 *   1. STOP ACCEPTING SIGNALS first. Everything after this takes time; anything that arrives
 *      during it would be observed by a session that is already ending.
 *   2. Unsubscribe and clear timers, so nothing can re-enter after the flush begins.
 *   3. Seal the Evidence archive. This is the step that must not be interrupted -- an
 *      unsealed archive is a record of unknown completeness and correctly blocks the next
 *      start.
 *   4. Write the recovery record and only THEN the clean-shutdown marker.
 *
 * The clean marker is written last on purpose. It is the app's statement that everything
 * above finished, so writing it earlier -- or writing it when a step failed -- would tell the
 * next launch a clean shutdown happened when it did not, and a real crash would be
 * indistinguishable from a tidy exit. A failed step therefore leaves the marker unwritten,
 * which is exactly the state a crash leaves, which is exactly the state that triggers recovery.
 *
 * The marker itself belongs to the existing A4N CrashRecoveryMarkerStore, which this sequence
 * DELEGATES to rather than duplicating. Two files both claiming to say whether the last run
 * ended cleanly is one file too many: the moment they disagree, neither is evidence.
 *
 * There is no force-quit control anywhere in this file or the UI it drives. A user who could
 * skip step 3 would be offered a button whose only function is to corrupt their own record.
 */

export type ShutdownStepId =
  | "STOP_SIGNALS"
  | "UNSUBSCRIBE_MARKET"
  | "CLEAR_TIMERS"
  | "FLUSH_EVIDENCE"
  | "RECORD_RECOVERY"
  | "WRITE_CLEAN_MARKER";

export type ShutdownStepStatus = "PENDING" | "RUNNING" | "DONE" | "FAILED";

export interface ShutdownStepState {
  readonly id: ShutdownStepId;
  readonly label: string;
  readonly status: ShutdownStepStatus;
  readonly detail: string | null;
}

export type ShutdownPhase = "IDLE" | "IN_PROGRESS" | "COMPLETE" | "FAILED";

export interface ShutdownProgress {
  readonly phase: ShutdownPhase;
  readonly observationWasRunning: boolean;
  readonly steps: readonly ShutdownStepState[];
  readonly evidenceSealed: boolean;
  readonly recoveryRecorded: boolean;
  readonly cleanShutdown: boolean;
  readonly startedAt: number | null;
  readonly finishedAt: number | null;
  /** Never true. Kept in the payload so the UI can state that the option does not exist. */
  readonly forceQuitAvailable: false;
}

const STEP_LABELS: Readonly<Record<ShutdownStepId, string>> = Object.freeze({
  STOP_SIGNALS: "신규 신호 처리 중단",
  UNSUBSCRIBE_MARKET: "시장 구독 종료",
  CLEAR_TIMERS: "타이머 정리",
  FLUSH_EVIDENCE: "Evidence 저장 마무리",
  RECORD_RECOVERY: "복구 기록 작성",
  WRITE_CLEAN_MARKER: "정상 종료 기록"
});

const STEP_ORDER: readonly ShutdownStepId[] = Object.freeze([
  "STOP_SIGNALS", "UNSUBSCRIBE_MARKET", "CLEAR_TIMERS", "FLUSH_EVIDENCE", "RECORD_RECOVERY", "WRITE_CLEAN_MARKER"
]);

export interface ShutdownSequenceDependencies {
  readonly runId: string;
  /** Whether an observation is live. Read once at the start, so the record cannot drift. */
  readonly observationIsRunning: () => boolean;
  readonly currentSessionId: () => string | null;
  readonly stopSignalIntake: () => void;
  readonly unsubscribeMarket: () => void;
  readonly clearTimers: () => void;
  readonly flushEvidence: () => Promise<void>;
  readonly recordRecovery: (cleanShutdown: boolean) => void;
  /** Marks the crash-recovery marker as "shutting down" before any slow step runs. */
  readonly beginShutdownRecord: (sessionId: string | null) => void;
  /** Writes cleanShutdown=true. Called ONLY when every preceding step succeeded. */
  readonly completeShutdownRecord: (sessionId: string | null) => void;
  readonly onProgress?: (progress: ShutdownProgress) => void;
  readonly now?: () => number;
}

export class ShutdownSequence {
  private phase: ShutdownPhase = "IDLE";
  private steps: ShutdownStepState[] = STEP_ORDER.map((id) => ({ id, label: STEP_LABELS[id], status: "PENDING" as ShutdownStepStatus, detail: null }));
  private observationWasRunning = false;
  private evidenceSealed = false;
  private recoveryRecorded = false;
  private cleanShutdown = false;
  private startedAt: number | null = null;
  private finishedAt: number | null = null;
  private running: Promise<ShutdownProgress> | null = null;

  constructor(private readonly deps: ShutdownSequenceDependencies) {}

  private now(): number {
    return this.deps.now?.() ?? Date.now();
  }

  progress(): ShutdownProgress {
    return Object.freeze({
      phase: this.phase,
      observationWasRunning: this.observationWasRunning,
      steps: Object.freeze(this.steps.map((step) => Object.freeze({ ...step }))),
      evidenceSealed: this.evidenceSealed,
      recoveryRecorded: this.recoveryRecorded,
      cleanShutdown: this.cleanShutdown,
      startedAt: this.startedAt,
      finishedAt: this.finishedAt,
      forceQuitAvailable: false
    });
  }

  /**
   * The one place the progress callback is invoked.
   *
   * That callback draws a window, and a window can already be destroyed by the time a quit
   * reaches it -- Electron throws "Object has been destroyed" when something still sends to
   * one. An exception escaping from here would unwind `execute()` mid-sequence, most
   * damagingly between sealing the archive and writing the clean marker: the next launch
   * would then find no marker and treat a tidy quit as a crash.
   *
   * Telling someone a step happened must never be able to stop the step after it. The throw
   * is therefore swallowed HERE, and only here -- a failing shutdown STEP is still reported
   * as FAILED and still leaves the clean marker unwritten.
   */
  private notifyProgress(progress: ShutdownProgress): void {
    try {
      this.deps.onProgress?.(progress);
    } catch {
      // Nothing to report it to: the reporting channel is what just failed.
    }
  }

  private setStep(id: ShutdownStepId, status: ShutdownStepStatus, detail: string | null = null): void {
    this.steps = this.steps.map((step) => (step.id === id ? { ...step, status, detail } : step));
    this.notifyProgress(this.progress());
  }

  /**
   * Runs once. A second quit request while the first is in flight returns the SAME promise
   * rather than starting a second pass: two concurrent flushes of one archive is precisely
   * the corruption this sequence exists to avoid.
   */
  run(): Promise<ShutdownProgress> {
    if (this.running !== null) return this.running;
    this.running = this.execute();
    return this.running;
  }

  inProgress(): boolean {
    return this.phase === "IN_PROGRESS";
  }

  private async execute(): Promise<ShutdownProgress> {
    this.phase = "IN_PROGRESS";
    this.startedAt = this.now();
    this.observationWasRunning = this.deps.observationIsRunning();
    const sessionId = this.deps.currentSessionId();
    this.notifyProgress(this.progress());
    try {
      this.deps.beginShutdownRecord(sessionId);
    } catch {
      // The marker already says "not clean"; failing to restate it changes nothing, and
      // aborting the shutdown over it would leave the archive open for no gain.
    }

    const synchronousSteps: readonly [ShutdownStepId, () => void][] = [
      ["STOP_SIGNALS", this.deps.stopSignalIntake],
      ["UNSUBSCRIBE_MARKET", this.deps.unsubscribeMarket],
      ["CLEAR_TIMERS", this.deps.clearTimers]
    ];
    let failed = false;
    for (const [id, action] of synchronousSteps) {
      this.setStep(id, "RUNNING");
      try {
        action();
        this.setStep(id, "DONE");
      } catch (error) {
        failed = true;
        this.setStep(id, "FAILED", error instanceof Error ? error.message : String(error));
      }
    }

    // The flush is attempted even if an earlier step failed. Those steps stop new work from
    // arriving; skipping the seal because one of them threw would leave the archive open for
    // a reason unrelated to the archive.
    this.setStep("FLUSH_EVIDENCE", "RUNNING");
    try {
      await this.deps.flushEvidence();
      this.evidenceSealed = true;
      this.setStep("FLUSH_EVIDENCE", "DONE");
    } catch (error) {
      failed = true;
      this.setStep("FLUSH_EVIDENCE", "FAILED", error instanceof Error ? error.message : String(error));
    }

    const clean = !failed && this.evidenceSealed;
    this.setStep("RECORD_RECOVERY", "RUNNING");
    try {
      this.deps.recordRecovery(clean);
      this.recoveryRecorded = true;
      this.setStep("RECORD_RECOVERY", "DONE");
    } catch (error) {
      failed = true;
      this.setStep("RECORD_RECOVERY", "FAILED", error instanceof Error ? error.message : String(error));
    }

    this.setStep("WRITE_CLEAN_MARKER", "RUNNING");
    if (!clean || failed) {
      // No marker. The next launch reads the absence and runs recovery -- which is the honest
      // outcome, because something in this shutdown really did not finish.
      this.setStep("WRITE_CLEAN_MARKER", "FAILED", "정상 종료 조건을 만족하지 못해 기록하지 않았습니다");
      this.phase = "FAILED";
    } else {
      try {
        this.deps.completeShutdownRecord(sessionId);
        this.cleanShutdown = true;
        this.setStep("WRITE_CLEAN_MARKER", "DONE");
        this.phase = "COMPLETE";
      } catch (error) {
        this.setStep("WRITE_CLEAN_MARKER", "FAILED", error instanceof Error ? error.message : String(error));
        this.phase = "FAILED";
      }
    }
    this.finishedAt = this.now();
    const result = this.progress();
    this.notifyProgress(result);
    return result;
  }

}
