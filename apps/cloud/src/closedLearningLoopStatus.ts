import type { ClosedLearningInitialPaperBootstrapResult } from "./closedLearningInitialPaperBootstrap";
import type { ClosedLearningRolloverResult } from "./closedLearningRolloverScheduler";

/**
 * Display-only status of the production closed-learning loop (bootstrap -> PAPER period -> rollover -> Research
 * decision -> next PAPER deployment). It was only logged, so the step where Experience N -> Research N+1 stalls was
 * not observable. Fixed codes and integers only: no ids, fingerprints, markets, prices or free text.
 */
export type ClosedLearningLoopStatus = {
  readonly lastTickAt: number;
  readonly ticks: number;
  readonly bootstrap: string;
  readonly rollover: string;
  readonly rolloverReason?: string;
  readonly cyclesEvaluated: number;
  readonly lastCycleStatus?: string;
  readonly lastCycleOutcome?: string;
  readonly deployments: number;
};

const CODE = /^[A-Z][A-Z0-9_]{1,63}$/;
const code = (value: unknown): string | undefined => {
  if (typeof value !== "string") return undefined;
  const head = value.split(":")[0]!;
  return CODE.test(head) ? head : undefined;
};

export class ClosedLearningLoopStatusTracker {
  private status: ClosedLearningLoopStatus | null = null;
  private bootstrap = "NOT_RUN";

  public observeBootstrap(result: Pick<ClosedLearningInitialPaperBootstrapResult, "status">): void {
    this.bootstrap = code(result.status) ?? "UNKNOWN";
  }

  public observeRollover(result: Pick<ClosedLearningRolloverResult, "status" | "reason" | "cycle">, now: number): void {
    const previous = this.status;
    const evaluated = result.status === "CLOSED_AND_EVALUATED";
    const cycleStatus = code(result.cycle?.status);
    const cycleOutcome = code(result.cycle?.record?.decision?.outcome);
    const deployed = evaluated && result.cycle?.record?.paperDeployment != null;
    const reason = code(result.reason);
    this.status = Object.freeze({
      lastTickAt: now,
      ticks: (previous?.ticks ?? 0) + 1,
      bootstrap: this.bootstrap,
      rollover: code(result.status) ?? "UNKNOWN",
      ...(reason === undefined ? {} : { rolloverReason: reason }),
      cyclesEvaluated: (previous?.cyclesEvaluated ?? 0) + (evaluated ? 1 : 0),
      ...(cycleStatus === undefined ? (previous?.lastCycleStatus === undefined ? {} : { lastCycleStatus: previous.lastCycleStatus }) : { lastCycleStatus: cycleStatus }),
      ...(cycleOutcome === undefined ? (previous?.lastCycleOutcome === undefined ? {} : { lastCycleOutcome: previous.lastCycleOutcome }) : { lastCycleOutcome: cycleOutcome }),
      deployments: (previous?.deployments ?? 0) + (deployed ? 1 : 0),
    });
  }

  /** A tick that threw before a rollover result: recorded as ERROR without changing the counts. */
  public observeError(now: number): void {
    const previous = this.status;
    this.status = Object.freeze({ ...(previous ?? { cyclesEvaluated: 0, deployments: 0 }), lastTickAt: now, ticks: (previous?.ticks ?? 0) + 1, bootstrap: this.bootstrap, rollover: "ERROR" }) as ClosedLearningLoopStatus;
  }

  public snapshot(): ClosedLearningLoopStatus | null {
    return this.status;
  }
}
