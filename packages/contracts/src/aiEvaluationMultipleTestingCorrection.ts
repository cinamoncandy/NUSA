/**
 * Multiple-testing / repeated-look correction for AI evaluation (WO-AI-011 slice 4/N: "frozen
 * confirmatory-versus-exploratory semantics, multiple-comparison policy, sequential-look/stopping
 * policy, and selection history").
 *
 * Evaluating more candidates (models/prompts/providers/thresholds) against the same evidence
 * inflates the chance of a false "significant" result purely from trying more things -- the same
 * failure mode strategyGovernance.ts's PBO/DSR machinery exists to prevent for backtested trading
 * strategies. This module is the equivalent correction for AI prediction significance claims.
 *
 * Two related but distinct corrections are provided:
 * - applyMultipleTestingCorrection: adjusts the significance threshold across one batch of trials
 *   (Bonferroni or Benjamini-Hochberg FDR control).
 * - TrialCountLedger + recordTrialLookAndFreeze: tracks the *cumulative* number of times an
 *   evaluation family has been looked at, failing closed if a caller ever reports fewer trials
 *   than were already frozen for that family -- silently resetting the count to escape correction
 *   is exactly the gaming this module exists to prevent.
 */

export interface MultipleTestingTrial {
  readonly trialId: string;
  /** 0..1 */
  readonly pValue: number;
}

export type MultipleTestingMethod = "BONFERRONI" | "BENJAMINI_HOCHBERG";

export interface MultipleTestingDecision {
  readonly trialId: string;
  readonly pValue: number;
  readonly adjustedThreshold: number;
  readonly significant: boolean;
}

const isUnitInterval = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;

/**
 * Applies a multiple-testing correction across one batch of trials at a family significance level
 * `alpha`. Fails closed (throws) on an invalid alpha, an empty trial set, a duplicate trialId, or
 * any out-of-range p-value -- never silently drops a trial from the correction denominator, since
 * that would understate how many comparisons were actually made.
 */
export function applyMultipleTestingCorrection(
  trials: readonly MultipleTestingTrial[],
  alpha: number,
  method: MultipleTestingMethod,
): readonly MultipleTestingDecision[] {
  if (!isUnitInterval(alpha) || alpha === 0) throw new Error("MULTIPLE_TESTING_ALPHA_INVALID");
  if (trials.length === 0) throw new Error("MULTIPLE_TESTING_TRIALS_REQUIRED");
  const ids = new Set(trials.map((trial) => trial.trialId));
  if (ids.size !== trials.length) throw new Error("MULTIPLE_TESTING_DUPLICATE_TRIAL_ID");
  for (const trial of trials) {
    if (!trial.trialId?.trim()) throw new Error("MULTIPLE_TESTING_TRIAL_ID_REQUIRED");
    if (!isUnitInterval(trial.pValue)) throw new Error(`MULTIPLE_TESTING_P_VALUE_INVALID:${trial.trialId}`);
  }

  const n = trials.length;

  if (method === "BONFERRONI") {
    const adjustedThreshold = alpha / n;
    return Object.freeze(
      trials.map((trial) => Object.freeze({
        trialId: trial.trialId,
        pValue: trial.pValue,
        adjustedThreshold,
        significant: trial.pValue <= adjustedThreshold,
      })),
    );
  }

  // Benjamini-Hochberg: sort ascending by p-value, find the largest rank k where
  // p_(k) <= (k/n) * alpha; every trial at or below that rank is significant, each at its own
  // rank-scaled threshold.
  const ranked = [...trials].sort((a, b) => a.pValue - b.pValue);
  let largestSignificantRank = 0;
  for (let index = 0; index < ranked.length; index += 1) {
    const rank = index + 1;
    if (ranked[index].pValue <= (rank / n) * alpha) largestSignificantRank = rank;
  }

  const decisions = new Map<string, MultipleTestingDecision>();
  ranked.forEach((trial, index) => {
    const rank = index + 1;
    decisions.set(trial.trialId, Object.freeze({
      trialId: trial.trialId,
      pValue: trial.pValue,
      adjustedThreshold: (rank / n) * alpha,
      significant: rank <= largestSignificantRank,
    }));
  });
  return Object.freeze(trials.map((trial) => decisions.get(trial.trialId) as MultipleTestingDecision));
}

/**
 * Cumulative, monotonic trial-count ledger per evaluation family. A family's frozen count can only
 * increase; it is the caller's persistence layer that must actually keep this durable across
 * process restarts -- this module only enforces the monotonicity invariant on whatever count it is
 * given, it does not itself persist anything.
 */
export type TrialCountLedger = Readonly<Record<string, number>>;

export interface RecordTrialLookResult {
  readonly accepted: boolean;
  readonly frozenTrialCount: number;
  readonly ledger: TrialCountLedger;
  readonly reason?: "FAMILY_ID_REQUIRED" | "TRIAL_COUNT_INVALID" | "TRIAL_COUNT_DECREASED";
}

/**
 * Records a new cumulative look count for `familyId`. Fails closed (accepted: false, ledger
 * unchanged) if the reported count is invalid or is LOWER than what was already frozen for this
 * family -- a decreasing count can only mean either corrupted state or an attempt to reset the
 * multiple-testing correction denominator, and this module refuses to reward either by advancing
 * the ledger.
 */
export function recordTrialLookAndFreeze(
  ledger: TrialCountLedger,
  familyId: string,
  reportedCumulativeTrialCount: number,
): RecordTrialLookResult {
  if (!familyId?.trim()) return { accepted: false, frozenTrialCount: 0, ledger, reason: "FAMILY_ID_REQUIRED" };
  if (!Number.isSafeInteger(reportedCumulativeTrialCount) || reportedCumulativeTrialCount < 1) {
    return { accepted: false, frozenTrialCount: ledger[familyId] ?? 0, ledger, reason: "TRIAL_COUNT_INVALID" };
  }
  const previous = ledger[familyId] ?? 0;
  if (reportedCumulativeTrialCount < previous) {
    return { accepted: false, frozenTrialCount: previous, ledger, reason: "TRIAL_COUNT_DECREASED" };
  }
  return {
    accepted: true,
    frozenTrialCount: reportedCumulativeTrialCount,
    ledger: Object.freeze({ ...ledger, [familyId]: reportedCumulativeTrialCount }),
  };
}
