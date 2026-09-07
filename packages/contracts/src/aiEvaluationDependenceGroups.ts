/**
 * Dependence-group identity for AI prediction evaluation (WO-AI-011 slice 3/N: "dependence-group
 * identity and uncertainty treatment for overlapping horizons, shared timestamps/assets/events,
 * duplicate/retry/replay observations, and other correlated samples").
 *
 * Two predictions about the same target whose outcome windows overlap are not independent
 * observations -- they are informed by overlapping realized data and share correlated error.
 * Treating N raw predictions as N independent samples overstates statistical confidence exactly
 * the way WO-AI-011's overfit-control requirements (PBO/DSR/multiple-testing correction) exist to
 * prevent for strategy backtesting; this module is the equivalent grouping step for AI prediction
 * evaluation. Predictions about different targets are never grouped together, regardless of time
 * overlap -- correlation here is about the same target's overlapping realized-outcome horizon,
 * not mere calendar coincidence.
 *
 * This module only forms groups and reports an effective sample size; it does not itself compute
 * calibration/accuracy metrics (outcomeCalibration.ts) or decide promotion -- a caller combines
 * this with those to avoid a false-confidence sample-size input.
 */

export interface DependenceGroupCandidate {
  readonly predictionId: string;
  readonly targetId: string;
  readonly outcomeWindowStart: number;
  readonly outcomeWindowEnd: number;
}

export interface DependenceGroup {
  readonly groupId: string;
  readonly targetId: string;
  /** Sorted by outcomeWindowStart; every window in the group transitively overlaps at least one other. */
  readonly memberPredictionIds: readonly string[];
}

export interface DependenceGroupingResult {
  readonly groups: readonly DependenceGroup[];
  /** Number of independent clusters -- the conservative effective sample size for this candidate
   * set, treating every prediction within one group as a single correlated observation. */
  readonly effectiveSampleSize: number;
  readonly rawSampleSize: number;
}

const isTimestamp = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= 0;

function overlaps(aStart: number, aEnd: number, bStart: number, bEnd: number): boolean {
  return aStart < bEnd && bStart < aEnd;
}

/**
 * Groups candidates by dependence: within one targetId, any two candidates whose outcome windows
 * overlap (directly or transitively through a chain of overlaps) join the same group. Fails closed
 * (throws) on malformed input -- an invalid window must never silently join a group and understate
 * correlation, since that would overstate the effective sample size in the caller's favor.
 */
export function groupByDependence(candidates: readonly DependenceGroupCandidate[]): DependenceGroupingResult {
  for (const candidate of candidates) {
    if (!candidate.predictionId?.trim()) throw new Error("DEPENDENCE_GROUP_PREDICTION_ID_REQUIRED");
    if (!candidate.targetId?.trim()) throw new Error("DEPENDENCE_GROUP_TARGET_ID_REQUIRED");
    if (!isTimestamp(candidate.outcomeWindowStart) || !isTimestamp(candidate.outcomeWindowEnd) || candidate.outcomeWindowStart > candidate.outcomeWindowEnd) {
      throw new Error(`DEPENDENCE_GROUP_WINDOW_INVALID:${candidate.predictionId}`);
    }
  }
  const ids = new Set(candidates.map((candidate) => candidate.predictionId));
  if (ids.size !== candidates.length) throw new Error("DEPENDENCE_GROUP_DUPLICATE_PREDICTION_ID");

  const byTarget = new Map<string, DependenceGroupCandidate[]>();
  for (const candidate of candidates) {
    const list = byTarget.get(candidate.targetId) ?? [];
    list.push(candidate);
    byTarget.set(candidate.targetId, list);
  }

  const groups: DependenceGroup[] = [];
  for (const [targetId, members] of byTarget) {
    const sorted = [...members].sort((a, b) => a.outcomeWindowStart - b.outcomeWindowStart);
    let cluster: DependenceGroupCandidate[] = [];
    let clusterEnd = -Infinity;
    const flush = () => {
      if (cluster.length === 0) return;
      groups.push({
        groupId: `${targetId}:${cluster[0].predictionId}`,
        targetId,
        memberPredictionIds: Object.freeze(cluster.map((entry) => entry.predictionId)),
      });
      cluster = [];
    };
    for (const candidate of sorted) {
      if (cluster.length > 0 && !overlaps(candidate.outcomeWindowStart, candidate.outcomeWindowEnd, cluster[cluster.length - 1].outcomeWindowStart, clusterEnd)) {
        flush();
      }
      cluster.push(candidate);
      clusterEnd = Math.max(clusterEnd, candidate.outcomeWindowEnd);
    }
    flush();
  }

  return Object.freeze({
    groups: Object.freeze(groups),
    effectiveSampleSize: groups.length,
    rawSampleSize: candidates.length,
  });
}

/** True when every member of `groupId` is present and no candidate outside the group has been
 * silently included -- a structural check a caller can use before trusting a claimed grouping. */
export function isDependenceGroupConsistent(group: DependenceGroup, candidates: readonly DependenceGroupCandidate[]): boolean {
  const byId = new Map(candidates.map((candidate) => [candidate.predictionId, candidate] as const));
  const members = group.memberPredictionIds.map((id) => byId.get(id));
  if (members.some((member) => member === undefined)) return false;
  const resolved = members as DependenceGroupCandidate[];
  return resolved.every((member) => member.targetId === group.targetId);
}
