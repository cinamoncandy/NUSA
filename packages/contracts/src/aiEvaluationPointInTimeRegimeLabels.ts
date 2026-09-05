/**
 * Point-in-time regime label resolution for AI prediction evaluation
 * (WO-AI-011: Governed Longitudinal Held-Out Evaluation).
 *
 * A narrow slice of the larger planning-only work order. Closes only the "point-in-time regime
 * labels" and "point-in-time regime labels cannot use hindsight outcomes, revised
 * classifications, or future realized-volatility information" requirements. A regime
 * classification (e.g. "BULL"/"BEAR"/"HIGH_VOLATILITY") for the period covering a prediction is
 * often refined after the fact once more data is available -- this module resolves only the
 * classification that had actually been published at or before the prediction was made, the same
 * way aiEvaluationDataVintage.ts resolves point-in-time fact revisions. A later reclassification
 * that used hindsight (e.g. realized volatility over the full period, not knowable at prediction
 * time) must never be substituted in.
 */

export interface RegimeLabelAssignment {
  readonly assignmentId: string;
  readonly regimeId: string;
  /** [periodStart, periodEnd) the classification applies to, half-open. */
  readonly periodStart: number;
  readonly periodEnd: number;
  /** When this classification actually became available/published -- may be well after
   * periodStart if the regime label depends on data not observable until later. */
  readonly publishedAt: number;
}

export type RegimeLabelResolution =
  | { readonly resolved: true; readonly assignmentId: string; readonly regimeId: string; readonly publishedAt: number }
  | {
      readonly resolved: false;
      readonly reason: "NO_LABEL_PUBLISHED_AT_PREDICTION_TIME" | "AMBIGUOUS_SIMULTANEOUS_LABELS" | "INVALID_PREDICTION_TIME" | "INVALID_ASSIGNMENT_SET";
    };

const isTimestamp = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= 0;

function assignmentsAreWellFormed(assignments: readonly RegimeLabelAssignment[]): boolean {
  if (assignments.length === 0) return false;
  const ids = new Set<string>();
  for (const assignment of assignments) {
    if (typeof assignment.assignmentId !== "string" || !assignment.assignmentId.trim()) return false;
    if (typeof assignment.regimeId !== "string" || !assignment.regimeId.trim()) return false;
    if (!isTimestamp(assignment.periodStart) || !isTimestamp(assignment.periodEnd) || assignment.periodStart >= assignment.periodEnd) return false;
    if (!isTimestamp(assignment.publishedAt)) return false;
    if (ids.has(assignment.assignmentId)) return false;
    ids.add(assignment.assignmentId);
  }
  return true;
}

/**
 * Resolves the regime classification that actually covers `predictionTime` AND had been
 * published at or before `predictionTime` -- among possibly several successive reclassifications
 * of the same period, the most recently published one that predates the prediction. Fails
 * closed: no period-covering classification had been published yet (or none exists at all), two
 * classifications covering this predictionTime publish at the exact same instant with different
 * regimeId (ambiguous, never silently pick one), or a malformed assignment set / predictionTime.
 * A later reclassification published after predictionTime is never returned, even if it is now
 * considered the "correct" classification for that period with the benefit of hindsight.
 */
export function resolvePointInTimeRegimeLabel(predictionTime: number, assignments: readonly RegimeLabelAssignment[]): RegimeLabelResolution {
  if (!isTimestamp(predictionTime)) return { resolved: false, reason: "INVALID_PREDICTION_TIME" };
  if (!assignmentsAreWellFormed(assignments)) return { resolved: false, reason: "INVALID_ASSIGNMENT_SET" };

  const eligible = assignments.filter((assignment) =>
    predictionTime >= assignment.periodStart && predictionTime < assignment.periodEnd && assignment.publishedAt <= predictionTime);
  if (eligible.length === 0) return { resolved: false, reason: "NO_LABEL_PUBLISHED_AT_PREDICTION_TIME" };

  const latestPublishedAt = Math.max(...eligible.map((assignment) => assignment.publishedAt));
  const latest = eligible.filter((assignment) => assignment.publishedAt === latestPublishedAt);
  if (latest.length > 1 && new Set(latest.map((assignment) => assignment.regimeId)).size > 1) {
    return { resolved: false, reason: "AMBIGUOUS_SIMULTANEOUS_LABELS" };
  }

  const chosen = latest[0];
  return { resolved: true, assignmentId: chosen.assignmentId, regimeId: chosen.regimeId, publishedAt: chosen.publishedAt };
}

/**
 * True only when every (predictionTime, assignmentId) claim in `claims` matches what
 * resolvePointInTimeRegimeLabel would independently resolve for that predictionTime -- the
 * structural check that a prediction pipeline used the correct point-in-time regime
 * classification rather than a later reclassification pulled from a "current" label store.
 */
export function isPointInTimeRegimeLabelConsistent(
  claims: readonly { readonly predictionTime: number; readonly assignmentId: string }[],
  assignments: readonly RegimeLabelAssignment[],
): boolean {
  if (claims.length === 0) return false;
  return claims.every((claim) => {
    const resolution = resolvePointInTimeRegimeLabel(claim.predictionTime, assignments);
    return resolution.resolved && resolution.assignmentId === claim.assignmentId;
  });
}
