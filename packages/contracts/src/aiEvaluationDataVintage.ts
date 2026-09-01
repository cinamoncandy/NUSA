/**
 * Point-in-time data-vintage identity for AI prediction evaluation
 * (WO-AI-011: Governed Longitudinal Held-Out Evaluation).
 *
 * A narrow slice of the larger planning-only work order. Closes only the
 * "point-in-time data-vintage identity for revised fundamentals, macro data, filings, and
 * backfills" requirement: given a series of dated revisions of the same underlying fact (a
 * fundamental, a macro print, a filing), resolve which revision a prediction made at a given
 * predictionTime was actually allowed to see -- never a later, revised value that had not been
 * published yet, even if that revision is now the "current" one in a downstream data store.
 *
 * This composes with aiEvaluationTemporalPartition.ts's predictionTime concept but is otherwise
 * independent -- it does not require a full AiPredictionTemporalIdentity, only predictionTime.
 */

/** One published revision of a single underlying fact (e.g. a quarterly EPS figure). */
export interface DataVintageRevision {
  readonly revisionId: string;
  /** The fact this revision claims to describe, e.g. "AAPL:EPS:2025Q3". Revisions of the same
   * factKey are candidates for the same point-in-time lookup; revisions of different factKeys
   * never compete. */
  readonly factKey: string;
  /** When this revision was actually published/observable, not when the fact "happened". */
  readonly publishedAt: number;
  readonly value: number;
}

export type DataVintageResolution =
  | { readonly resolved: true; readonly revisionId: string; readonly value: number; readonly publishedAt: number }
  | {
      readonly resolved: false;
      readonly reason: "NO_PUBLISHED_REVISION_AT_PREDICTION_TIME" | "INVALID_PREDICTION_TIME" | "INVALID_REVISION_SET" | "AMBIGUOUS_SIMULTANEOUS_REVISIONS";
    };

const isTimestamp = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= 0;

function revisionsAreWellFormed(revisions: readonly DataVintageRevision[]): boolean {
  if (revisions.length === 0) return false;
  const ids = new Set<string>();
  for (const revision of revisions) {
    if (typeof revision.revisionId !== "string" || !revision.revisionId.trim()) return false;
    if (typeof revision.factKey !== "string" || !revision.factKey.trim()) return false;
    if (!isTimestamp(revision.publishedAt)) return false;
    if (!Number.isFinite(revision.value)) return false;
    if (ids.has(revision.revisionId)) return false;
    ids.add(revision.revisionId);
  }
  return true;
}

/**
 * Resolves the single revision of `factKey` that was actually published at or before
 * `predictionTime` -- the most recent such revision, i.e. the exact point-in-time vintage a
 * prediction made at that time was entitled to see. Fails closed rather than guessing:
 * - no revision of this factKey had been published yet at predictionTime -> unresolved
 * - two or more revisions of the same factKey publish at the exact same instant with different
 *   values -> unresolved as ambiguous, never silently pick one
 * - malformed/duplicate-id revision set, or invalid predictionTime -> unresolved
 *
 * A later, "more correct" revision published after predictionTime is never returned even if it
 * is what a downstream data store now considers current -- that would be exactly the future-
 * leakage this module exists to prevent.
 */
export function resolveDataVintage(
  factKey: string,
  predictionTime: number,
  revisions: readonly DataVintageRevision[],
): DataVintageResolution {
  if (!isTimestamp(predictionTime)) return { resolved: false, reason: "INVALID_PREDICTION_TIME" };
  if (!revisionsAreWellFormed(revisions)) return { resolved: false, reason: "INVALID_REVISION_SET" };

  const eligible = revisions.filter((revision) => revision.factKey === factKey && revision.publishedAt <= predictionTime);
  if (eligible.length === 0) return { resolved: false, reason: "NO_PUBLISHED_REVISION_AT_PREDICTION_TIME" };

  const latestPublishedAt = Math.max(...eligible.map((revision) => revision.publishedAt));
  const latest = eligible.filter((revision) => revision.publishedAt === latestPublishedAt);
  if (latest.length > 1) {
    const distinctValues = new Set(latest.map((revision) => revision.value));
    if (distinctValues.size > 1) return { resolved: false, reason: "AMBIGUOUS_SIMULTANEOUS_REVISIONS" };
  }

  const chosen = latest[0];
  return { resolved: true, revisionId: chosen.revisionId, value: chosen.value, publishedAt: chosen.publishedAt };
}

/**
 * True only when every revision actually used by `usedRevisionIds` for a given predictionTime
 * matches what resolveDataVintage would independently resolve for that same (factKey,
 * predictionTime) -- the structural check that a prediction pipeline used the correct point-in-
 * time vintage rather than a later-revised value pulled from a "current" data store by mistake.
 */
export function isDataVintageConsistent(
  predictionTime: number,
  usedRevisions: readonly { readonly factKey: string; readonly revisionId: string }[],
  allRevisions: readonly DataVintageRevision[],
): boolean {
  if (usedRevisions.length === 0) return false;
  return usedRevisions.every((used) => {
    const resolution = resolveDataVintage(used.factKey, predictionTime, allRevisions);
    return resolution.resolved && resolution.revisionId === used.revisionId;
  });
}
