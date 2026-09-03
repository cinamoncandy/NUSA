/**
 * Tail conditional loss and worst-k event aggregation for AI prediction evaluation
 * (WO-AI-011: Governed Longitudinal Held-Out Evaluation).
 *
 * A narrow slice of the larger planning-only work order. Closes only the "tail conditional loss,
 * worst-k event behavior ... are separated from ordinary-regime averages" and "realized clustered
 * stress episodes are dependence-adjusted and cannot inflate effective sample size" requirements.
 * Composes with aiEvaluationTailEventIdentity.ts (which defines what counts as a tail event and
 * freezes that definition before outcome inspection) -- this module aggregates realized losses
 * for events already classified into that frozen family. Correlated observations within one
 * stress episode (e.g. the same volatility spike hitting multiple correlated symbols, or repeated
 * observations of the same episode) are collapsed to one representative (worst) loss per group
 * before aggregation, so a single clustered episode cannot masquerade as many independent tail
 * samples and inflate the apparent effective sample size.
 */

export interface TailLossObservation {
  readonly eventId: string;
  readonly groupId: string;
  readonly loss: number;
}

export type TailLossResult =
  | { readonly resolved: true; readonly value: number; readonly effectiveSampleSize: number }
  | { readonly resolved: false; readonly reason: "EMPTY_SET" | "INVALID_OBSERVATION" | "DUPLICATE_EVENT_ID" | "INSUFFICIENT_EFFECTIVE_SAMPLE" | "INVALID_PARAMETER" };

function observationsAreWellFormed(observations: readonly TailLossObservation[]): boolean {
  const seen = new Set<string>();
  for (const observation of observations) {
    if (typeof observation.eventId !== "string" || !observation.eventId.trim()) return false;
    if (typeof observation.groupId !== "string" || !observation.groupId.trim()) return false;
    if (!Number.isFinite(observation.loss) || observation.loss < 0) return false;
    if (seen.has(observation.eventId)) return false;
    seen.add(observation.eventId);
  }
  return true;
}

function worstLossPerGroup(observations: readonly TailLossObservation[]): number[] {
  const worstByGroup = new Map<string, number>();
  for (const observation of observations) {
    const current = worstByGroup.get(observation.groupId);
    if (current === undefined || observation.loss > current) worstByGroup.set(observation.groupId, observation.loss);
  }
  return [...worstByGroup.values()];
}

function findDuplicateOrInvalid(observations: readonly TailLossObservation[]): "DUPLICATE_EVENT_ID" | "INVALID_OBSERVATION" {
  const seen = new Set<string>();
  for (const observation of observations) {
    if (typeof observation.eventId === "string" && observation.eventId.trim()) {
      if (seen.has(observation.eventId)) return "DUPLICATE_EVENT_ID";
      seen.add(observation.eventId);
    }
  }
  return "INVALID_OBSERVATION";
}

export function computeWorstKMean(observations: readonly TailLossObservation[], k: number, minEffectiveSampleSize: number): TailLossResult {
  if (observations.length === 0) return { resolved: false, reason: "EMPTY_SET" };
  if (!Number.isSafeInteger(k) || k <= 0) return { resolved: false, reason: "INVALID_PARAMETER" };
  if (!Number.isSafeInteger(minEffectiveSampleSize) || minEffectiveSampleSize <= 0) return { resolved: false, reason: "INVALID_PARAMETER" };
  if (!observationsAreWellFormed(observations)) return { resolved: false, reason: findDuplicateOrInvalid(observations) };
  const representativeLosses = worstLossPerGroup(observations);
  const effectiveSampleSize = representativeLosses.length;
  if (effectiveSampleSize < minEffectiveSampleSize) return { resolved: false, reason: "INSUFFICIENT_EFFECTIVE_SAMPLE" };
  if (k > effectiveSampleSize) return { resolved: false, reason: "INSUFFICIENT_EFFECTIVE_SAMPLE" };
  const worstK = [...representativeLosses].sort((a, b) => b - a).slice(0, k);
  return { resolved: true, value: worstK.reduce((sum, loss) => sum + loss, 0) / k, effectiveSampleSize };
}

export function computeTailConditionalLoss(observations: readonly TailLossObservation[], alpha: number, minEffectiveSampleSize: number): TailLossResult {
  if (!Number.isFinite(alpha) || alpha <= 0 || alpha > 1) return { resolved: false, reason: "INVALID_PARAMETER" };
  if (observations.length === 0) return { resolved: false, reason: "EMPTY_SET" };
  if (!observationsAreWellFormed(observations)) return { resolved: false, reason: findDuplicateOrInvalid(observations) };
  const effectiveSampleSize = worstLossPerGroup(observations).length;
  const k = Math.ceil(alpha * effectiveSampleSize);
  return computeWorstKMean(observations, Math.max(1, k), minEffectiveSampleSize);
}
