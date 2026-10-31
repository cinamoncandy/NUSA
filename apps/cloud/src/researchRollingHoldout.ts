import type { BacktestCandle } from "../../../packages/core/src/optimizer/aiBacktestEngine";
import { buildWalkForwardWindows, type WalkForwardRefusal, type WalkForwardWindowConfig, type WalkForwardWindowsOk } from "./researchWalkForwardWindows";

/**
 * Pure building blocks for K-of-N independent holdouts (owner approved N = 3, K = 2 on 2026-10-31, docs/PROPOSAL_RESEARCH_ROLLING_HOLDOUT.md).
 * NOT WIRED into the runner, orchestrator, holdout claim ledger, precommit identity or /health yet: nothing here changes any
 * experiment, rule, threshold, budget or authority. It only answers two questions, deterministically:
 *   1. Where do N fully disjoint folds (train -> validation -> holdout each, no data shared between folds) sit in time?
 *   2. Given each fold's own holdout outcome, does the candidate pass? (Only when at least K of all N folds favour it.)
 * Folds are fully disjoint, so a fold's holdout can never train or validate another fold: no information crosses folds.
 */
export const ROLLING_FOLDS = 3;
export const ROLLING_FOLDS_REQUIRED = 2;

export interface RollingFold extends WalkForwardWindowsOk {
  /** 0 = the oldest fold. */
  readonly index: number;
}

export type RollingFoldsResult =
  | { readonly status: "OK"; readonly folds: readonly RollingFold[] }
  | { readonly status: "REFUSED"; readonly reason: WalkForwardRefusal["reason"] | "INVALID_FOLD_COUNT"; readonly foldIndex?: number };

/** One fold's total length: the three windows back to back. */
export const foldSpanMs = (config: WalkForwardWindowConfig): number => config.trainMs + config.validationMs + config.holdoutMs;

/** The history a rolling check needs: N folds back to back. Compare with the stored candle span before asking for folds. */
export const requiredHistoryMs = (config: WalkForwardWindowConfig, folds: number = ROLLING_FOLDS): number => foldSpanMs(config) * folds;

/**
 * Folds are laid back to back and end at `endCloseMs` (the newest fold ends there). Any refusal of any fold refuses the whole
 * set: a partial rolling check is never returned, and nothing is shifted or shortened to make a fold fit.
 */
export function buildRollingFolds(input: {
  readonly candles: readonly BacktestCandle[];
  readonly endCloseMs: number;
  readonly config: WalkForwardWindowConfig;
  readonly folds?: number;
}): RollingFoldsResult {
  const count = input.folds ?? ROLLING_FOLDS;
  if (!Number.isSafeInteger(count) || count < 2 || count > 6) return Object.freeze({ status: "REFUSED", reason: "INVALID_FOLD_COUNT" });
  const span = foldSpanMs(input.config);
  if (!Number.isSafeInteger(span) || span <= 0) return Object.freeze({ status: "REFUSED", reason: "INVALID_CONFIG" });
  const folds: RollingFold[] = [];
  for (let index = 0; index < count; index += 1) {
    const endCloseMs = input.endCloseMs - (count - 1 - index) * span;
    const built = buildWalkForwardWindows({ candles: input.candles, endCloseMs, config: input.config });
    if (built.status === "REFUSED") return Object.freeze({ status: "REFUSED", reason: built.reason, foldIndex: index });
    folds.push(Object.freeze({ ...built, index }));
  }
  return Object.freeze({ status: "OK", folds: Object.freeze(folds) });
}

/** One fold's own holdout outcome. INSUFFICIENT means the fold could not be evaluated (too few trades or candles) and never counts as a pass. */
export type FoldOutcome = "CHALLENGER_BETTER" | "NOT_BETTER" | "INSUFFICIENT";

export interface RollingHoldoutDecision {
  readonly decision: "PASS" | "FAIL" | "INSUFFICIENT_EVIDENCE";
  readonly passed: number;
  readonly failed: number;
  readonly insufficient: number;
  readonly required: number;
  readonly total: number;
}

/**
 * PASS only when at least `required` of exactly `total` folds favour the challenger. A set with the wrong number of outcomes, or one
 * where the folds still undecided could change the answer, is INSUFFICIENT_EVIDENCE, never a pass. Passing here is never easier than
 * a single holdout passing: every PASS needs at least `required` (>= 2) individual passes.
 */
export function decideRollingHoldout(outcomes: readonly FoldOutcome[], required: number = ROLLING_FOLDS_REQUIRED, total: number = ROLLING_FOLDS): RollingHoldoutDecision {
  const valid = Number.isSafeInteger(required) && Number.isSafeInteger(total) && required >= 2 && required <= total && outcomes.length === total
    && outcomes.every((outcome) => outcome === "CHALLENGER_BETTER" || outcome === "NOT_BETTER" || outcome === "INSUFFICIENT");
  const passed = valid ? outcomes.filter((o) => o === "CHALLENGER_BETTER").length : 0;
  const failed = valid ? outcomes.filter((o) => o === "NOT_BETTER").length : 0;
  const insufficient = valid ? outcomes.filter((o) => o === "INSUFFICIENT").length : 0;
  const base = { passed, failed, insufficient, required, total } as const;
  if (!valid) return Object.freeze({ decision: "INSUFFICIENT_EVIDENCE", ...base });
  if (passed >= required) return Object.freeze({ decision: "PASS", ...base });
  // Not enough passes: it is a real FAIL only when the folds that could not be evaluated could not have rescued it.
  return Object.freeze({ decision: passed + insufficient >= required ? "INSUFFICIENT_EVIDENCE" : "FAIL", ...base });
}
