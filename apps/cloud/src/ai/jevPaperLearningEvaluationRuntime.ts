import type { ClosedLearningRolloverResult } from "../closedLearningRolloverScheduler";
import type { PaperPerformanceFromLedgerResult } from "../paperPerformanceFromLedger";
import {
  type JevPaperLearningEvaluationShadowReceipt,
  type JevPaperLearningEvaluationShadowObserver,
} from "./jevPaperLearningEvaluationShadow";

export interface JevPaperLearningRuntimeBridgeOptions {
  readonly observer: JevPaperLearningEvaluationShadowObserver | null;
  readonly readPaperPerformanceEvidence: (periodId: string) => PaperPerformanceFromLedgerResult;
  readonly env?: NodeJS.ProcessEnv;
  readonly log?: (line: string) => void;
}

function boundedReason(error: unknown): string {
  if (!(error instanceof Error)) return "PAPER_PERFORMANCE_EVIDENCE_UNAVAILABLE";
  const message = error.message.trim();
  if (!message) return error.name || "PAPER_PERFORMANCE_EVIDENCE_UNAVAILABLE";
  return message.slice(0, 160);
}

/**
 * Observation-only handoff from a completed canonical closed-learning rollover to Jev.
 *
 * The canonical Research/League evaluation has already completed before this bridge runs.
 * No Jev outcome is fed back into the cycle, deployment, Governance, Portfolio/Risk, execution,
 * Ledger, Release, or LIVE paths. Any observation failure is contained and returns null.
 */
export async function observeJevPaperLearningAfterRollover(
  rollover: ClosedLearningRolloverResult,
  options: JevPaperLearningRuntimeBridgeOptions,
): Promise<JevPaperLearningEvaluationShadowReceipt | null> {
  if (
    options.observer == null
    || rollover.status !== "CLOSED_AND_EVALUATED"
    || rollover.periodId == null
    || rollover.cycle == null
  ) {
    return null;
  }

  let performance: PaperPerformanceFromLedgerResult | null = null;
  let sourceFailureReason: string | null = null;
  try {
    performance = options.readPaperPerformanceEvidence(rollover.periodId);
  } catch (error) {
    sourceFailureReason = boundedReason(error);
  }

  try {
    const receipt = await options.observer.observe({
      periodId: rollover.periodId,
      performance,
      cycle: rollover.cycle,
      ...(sourceFailureReason == null ? {} : { sourceFailureReason }),
    }, options.env ?? process.env);
    (options.log ?? console.log)(JSON.stringify({
      event: "JEV_PAPER_LEARNING_EVALUATION_SHADOW",
      receipt,
    }));
    return receipt;
  } catch {
    return null;
  }
}
