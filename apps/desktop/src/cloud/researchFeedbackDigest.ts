import { verifyResearchTrialLedger, type ResearchTrialRecord } from "./researchTrialLedger";

/**
 * Bounded learning feedback for the next research cycle.
 *
 * Ghost / PAPER / counterfactual outcomes accumulate in the trial ledger, but nothing fed them
 * back into how the next cycle is judged. The naive version of that feedback is actively harmful:
 * a family that happened to do well gets boosted, which makes it more likely to be selected, which
 * produces more of its outcomes, which boosts it further. That is self-reinforcement, and it
 * manufactures confidence out of its own history.
 *
 * This module produces feedback that cannot do that, by construction:
 *
 * - **Sealed evidence only.** The ledger's hash chain is verified before anything is computed. A
 *   broken or rewritten chain fails closed; history is read, never rewritten.
 * - **No self-influence.** A trial never contributes to the prior applied to itself. Feedback for
 *   a family is computed strictly from records sealed *earlier* in the ledger, so a result can
 *   never justify itself.
 * - **Survivors do not define the denominator.** FAILED and REJECTED trials are counted in full.
 *   Computing over completed trials only would be textbook survivorship bias, so a family whose
 *   completions look good but which failed far more often is scored down, not up.
 * - **Bounded in both directions.** The adjustment is clamped to a configured band, so no amount
 *   of accumulated history can compound a family toward unbounded confidence.
 * - **Concentration is disclosed.** If one family dominates the evidence base, the digest says so
 *   rather than presenting a selection-biased sample as broad evidence.
 *
 * It grants no authority: the output is a bounded research prior, not a promotion, a weight, a
 * capital amount, an order, or any LIVE capability.
 */

export interface ResearchFeedbackPolicy {
  /** Maximum absolute prior adjustment a family can ever accumulate, in either direction. */
  readonly maximumAdjustment: number;
  /** Sealed prior trials a family needs before its feedback is anything but neutral. */
  readonly minimumPriorTrials: number;
  /** Share of the evidence base above which one family is reported as dominating it. */
  readonly concentrationDisclosureThreshold: number;
}

export interface ResearchFamilyFeedback {
  readonly familyId: string;
  /** Sealed trials for this family that preceded the evaluated point. */
  readonly priorTrialCount: number;
  readonly completedCount: number;
  readonly failedCount: number;
  readonly rejectedCount: number;
  /** Failure share over ALL prior trials, not over survivors. */
  readonly failureRatio: number;
  /** Bounded prior adjustment. Negative means this family's own history argues against it. */
  readonly priorAdjustment: number;
  readonly reasons: readonly string[];
}

export interface ResearchFeedbackDigest {
  readonly schemaVersion: 1;
  readonly evidenceMode: "SEALED_HISTORICAL_EVIDENCE";
  readonly policy: ResearchFeedbackPolicy;
  /** Ledger terminal hash the digest was computed against, so it can be re-verified later. */
  readonly ledgerTerminalHash: string;
  readonly evaluatedSequence: number;
  readonly families: readonly ResearchFamilyFeedback[];
  readonly totalPriorTrials: number;
  readonly reasons: readonly string[];
}

export class ResearchFeedbackError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = "ResearchFeedbackError";
  }
}

const GENESIS_HASH = "0".repeat(64);

const DEFAULT_POLICY: ResearchFeedbackPolicy = Object.freeze({
  maximumAdjustment: 0.1,
  minimumPriorTrials: 5,
  concentrationDisclosureThreshold: 0.6,
});

const freeze = <T>(value: T): Readonly<T> => Object.freeze(value);
const sortedUnique = (values: readonly string[]): readonly string[] => Object.freeze([...new Set(values)].sort());

function validatePolicy(policy: ResearchFeedbackPolicy): void {
  if (!Number.isFinite(policy.maximumAdjustment) || policy.maximumAdjustment <= 0 || policy.maximumAdjustment > 1) {
    throw new ResearchFeedbackError("INVALID_POLICY", "maximumAdjustment must be finite and within (0, 1]");
  }
  if (!Number.isInteger(policy.minimumPriorTrials) || policy.minimumPriorTrials < 1) {
    throw new ResearchFeedbackError("INVALID_POLICY", "minimumPriorTrials must be a positive integer");
  }
  if (!Number.isFinite(policy.concentrationDisclosureThreshold)
    || policy.concentrationDisclosureThreshold <= 0
    || policy.concentrationDisclosureThreshold > 1) {
    throw new ResearchFeedbackError("INVALID_POLICY", "concentrationDisclosureThreshold must be finite and within (0, 1]");
  }
}

/**
 * Computes a family's bounded prior from its complete prior record -- successes and failures alike.
 *
 * The score is deliberately anchored on the failure ratio rather than on how good the completed
 * trials looked. A family that completed a few impressive trials but failed or was rejected far
 * more often has demonstrated that its apparent wins are drawn from a wide, mostly-unsuccessful
 * search, and must be scored down for it.
 */
function familyPrior(
  completedCount: number,
  failedCount: number,
  rejectedCount: number,
  policy: ResearchFeedbackPolicy,
): { readonly failureRatio: number; readonly priorAdjustment: number; readonly reasons: readonly string[] } {
  const priorTrialCount = completedCount + failedCount + rejectedCount;
  const reasons: string[] = [];
  if (priorTrialCount < policy.minimumPriorTrials) {
    // Too little sealed history to say anything: neutral, and say why.
    return { failureRatio: priorTrialCount === 0 ? 0 : (failedCount + rejectedCount) / priorTrialCount, priorAdjustment: 0, reasons: sortedUnique(["INSUFFICIENT_PRIOR_HISTORY"]) };
  }

  const failureRatio = (failedCount + rejectedCount) / priorTrialCount;
  // 0.5 failure ratio is the neutral point; above it the family's own history argues against it.
  const raw = (0.5 - failureRatio) * 2 * policy.maximumAdjustment;
  const priorAdjustment = Math.max(-policy.maximumAdjustment, Math.min(policy.maximumAdjustment, raw));

  if (failureRatio > 0.5) reasons.push("HISTORICAL_FAILURE_RATE_ARGUES_AGAINST_FAMILY");
  if (priorAdjustment >= policy.maximumAdjustment) reasons.push("PRIOR_ADJUSTMENT_CAPPED");
  if (priorAdjustment <= -policy.maximumAdjustment) reasons.push("PRIOR_PENALTY_CAPPED");
  return { failureRatio, priorAdjustment, reasons: sortedUnique(reasons) };
}

/**
 * Builds bounded, non-self-reinforcing feedback from sealed trial history.
 *
 * `evaluatedSequence` is the ledger point the next research cycle starts from: only records
 * strictly before it contribute, so a trial can never influence the prior applied to itself.
 * Research evidence only -- grants no promotion, weight, capital, order, or LIVE authority.
 */
export function buildResearchFeedbackDigest(
  ledger: readonly ResearchTrialRecord[],
  options: { readonly evaluatedSequence?: number; readonly policy?: Partial<ResearchFeedbackPolicy> } = {},
): ResearchFeedbackDigest {
  // Rewritten or reordered history fails closed before a single number is derived from it.
  verifyResearchTrialLedger(ledger);

  const policy: ResearchFeedbackPolicy = freeze({ ...DEFAULT_POLICY, ...options.policy });
  validatePolicy(policy);

  const evaluatedSequence = options.evaluatedSequence ?? ledger.length + 1;
  if (!Number.isInteger(evaluatedSequence) || evaluatedSequence < 1) {
    throw new ResearchFeedbackError("INVALID_EVALUATED_SEQUENCE", "evaluatedSequence must be a positive integer");
  }

  // Strictly-earlier records only: this is what makes the feedback non-circular.
  const priorRecords = ledger.filter((record) => record.sequence < evaluatedSequence);

  const byFamily = new Map<string, { completed: number; failed: number; rejected: number }>();
  for (const record of priorRecords) {
    const bucket = byFamily.get(record.familyId) ?? { completed: 0, failed: 0, rejected: 0 };
    if (record.outcome === "COMPLETED") bucket.completed += 1;
    else if (record.outcome === "FAILED") bucket.failed += 1;
    else bucket.rejected += 1;
    byFamily.set(record.familyId, bucket);
  }

  const families = [...byFamily.entries()]
    .map(([familyId, counts]) => {
      const priorTrialCount = counts.completed + counts.failed + counts.rejected;
      const { failureRatio, priorAdjustment, reasons } = familyPrior(counts.completed, counts.failed, counts.rejected, policy);
      return freeze({
        familyId,
        priorTrialCount,
        completedCount: counts.completed,
        failedCount: counts.failed,
        rejectedCount: counts.rejected,
        failureRatio,
        priorAdjustment,
        reasons,
      });
    })
    // Deterministic ordering independent of ledger insertion order.
    .sort((left, right) => left.familyId.localeCompare(right.familyId));

  const totalPriorTrials = priorRecords.length;
  const reasons: string[] = ["BOUNDED_RESEARCH_PRIOR_ONLY", "NO_PROMOTION_AUTHORITY", "SEALED_HISTORY_NOT_REWRITTEN"];
  if (totalPriorTrials === 0) reasons.push("NO_SEALED_PRIOR_EVIDENCE");
  // A sample dominated by one family is a selection-biased sample, and must be labeled as one.
  for (const family of families) {
    if (totalPriorTrials > 0 && family.priorTrialCount / totalPriorTrials >= policy.concentrationDisclosureThreshold) {
      reasons.push("EVIDENCE_BASE_DOMINATED_BY_SINGLE_FAMILY");
    }
  }

  return freeze({
    schemaVersion: 1,
    evidenceMode: "SEALED_HISTORICAL_EVIDENCE",
    policy,
    ledgerTerminalHash: ledger.at(-1)?.recordHash ?? GENESIS_HASH,
    evaluatedSequence,
    families: freeze(families),
    totalPriorTrials,
    reasons: sortedUnique(reasons),
  });
}
