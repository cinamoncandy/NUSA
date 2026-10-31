import { runResearchExperiment, type ExperimentRunnerPorts, type ExperimentSpec } from "./researchExperimentRunner";
import { buildRollingFolds, decideRollingHoldout, requiredHistoryMs, ROLLING_FOLDS, type FoldOutcome, type RollingHoldoutDecision } from "./researchRollingHoldout";

/**
 * Runs one challenger through the EXISTING single-fold runner once per fold (spec.endCloseMs moved to each fold's end), so every fold
 * keeps its own windows, precommit, provenance and durable holdout claim, and the contamination rules of runResearchExperiment are
 * untouched. Nothing calls this yet (not wired into the orchestrator, /health or the backfill).
 *
 * Holdout claims cannot be undone, so every fold's windows are built and checked BEFORE the first run: if any fold lacks history no
 * claim is made. A fold that could not be evaluated is INSUFFICIENT and never a pass; a fold whose validation did not favour the
 * challenger is NOT_BETTER (it never reached its holdout).
 */
export interface RollingExperimentOutcome {
  readonly decision: RollingHoldoutDecision;
  readonly folds: readonly Readonly<{ index: number; endCloseMs: number; outcome: FoldOutcome; note: string }>[];
  /** Set when the folds could not be built, before any run or claim. */
  readonly refusal?: string;
}

const refuse = (reason: string): RollingExperimentOutcome => Object.freeze({ decision: decideRollingHoldout([]), folds: Object.freeze([]), refusal: reason });

export function runRollingResearchExperiment(ports: ExperimentRunnerPorts, spec: ExperimentSpec, folds: number = ROLLING_FOLDS): RollingExperimentOutcome {
  try {
    const need = requiredHistoryMs(spec.windows, folds);
    const rows = ports.candles.read(spec.market, spec.intervalMs, spec.endCloseMs - need + spec.intervalMs, spec.endCloseMs);
    const built = buildRollingFolds({ candles: rows.map((r) => ({ timestamp: r.closeTimeMs, open: r.open, high: r.high, low: r.low, close: r.close, volume: 0 })), endCloseMs: spec.endCloseMs, config: spec.windows, folds });
    if (built.status === "REFUSED") return refuse(`ROLLING_${built.reason}${built.foldIndex === undefined ? "" : `_FOLD_${built.foldIndex}`}`);

    const results = built.folds.map((fold) => {
      const endCloseMs = fold.bounds.holdout.endCloseMs;
      const outcome = runResearchExperiment(ports, { ...spec, endCloseMs });
      let classified: FoldOutcome, note: string;
      if (outcome.status !== "COMPLETED") { classified = "INSUFFICIENT"; note = `${outcome.status}_${outcome.reason}`; }
      else if (outcome.holdout != null) { classified = outcome.holdout.result === "CHALLENGER_BETTER" ? "CHALLENGER_BETTER" : "NOT_BETTER"; note = "HOLDOUT_EVALUATED"; }
      else if (outcome.holdoutNote === "VALIDATION_NOT_FAVOURABLE") { classified = "NOT_BETTER"; note = "VALIDATION_NOT_FAVOURABLE"; }
      else { classified = "INSUFFICIENT"; note = outcome.holdoutNote ?? "HOLDOUT_NOT_EVALUATED"; }
      return Object.freeze({ index: fold.index, endCloseMs, outcome: classified, note });
    });
    return Object.freeze({ decision: decideRollingHoldout(results.map((r) => r.outcome), undefined, folds), folds: Object.freeze(results) });
  } catch {
    return refuse("ROLLING_RUN_FAILED");
  }
}
