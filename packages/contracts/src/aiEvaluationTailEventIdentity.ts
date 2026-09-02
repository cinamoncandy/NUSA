/**
 * Immutable tail-event family identity for AI prediction evaluation
 * (WO-AI-011: Governed Longitudinal Held-Out Evaluation).
 *
 * A narrow slice of the larger planning-only work order. Closes only the "immutable tail-event
 * family identity covering gap moves, volatility spikes, liquidity stress, correlation spikes,
 * limit/auction disruption, discontinuous prices, and other declared rare-event classes" and
 * "tail-event thresholds, lookback windows, severity bands, event clustering, and minimum
 * effective-sample requirements are frozen before confirmatory outcome inspection" requirements.
 * A tail-risk claim (e.g. "the model's downside calibration held during stress") is only
 * confirmatory if the definition of what counts as a stress event -- and how many effectively
 * independent such events are required -- was frozen before any outcome was inspected. Composes
 * with aiEvaluationFrozenSelection.ts's frozen-before-outcome pattern and
 * aiEvaluationDependenceGroups.ts's effective-sample-size concept (clustered stress episodes
 * cannot inflate the effective count).
 */

export type TailEventClass =
  | "GAP_MOVE" | "VOLATILITY_SPIKE" | "LIQUIDITY_STRESS" | "CORRELATION_SPIKE" | "LIMIT_AUCTION_DISRUPTION" | "DISCONTINUOUS_PRICE";

export interface TailEventFamilyDefinition {
  readonly familyId: string;
  readonly eventClass: TailEventClass;
  readonly thresholdValue: number;
  readonly lookbackWindowMs: number;
  readonly severityBands: readonly { readonly name: string; readonly minSeverity: number }[];
  /** Minimum dependence-adjusted effective sample size of realized tail events required before a
   * tail-risk claim bound to this family may be treated as confirmatory. */
  readonly minEffectiveEventCount: number;
  readonly frozenAt: number;
}

export type TailEventFamilyValidation =
  | { readonly valid: true }
  | { readonly valid: false; readonly errors: readonly string[] };

const isTimestamp = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= 0;

/**
 * Validates a tail-event family definition's internal well-formedness: positive threshold,
 * positive lookback window, severity bands present/strictly-increasing-by-minSeverity/uniquely
 * named, positive minEffectiveEventCount, and a valid frozenAt. Fails closed on any violation --
 * a malformed family definition can never anchor a confirmatory tail-risk claim.
 */
export function validateTailEventFamilyDefinition(family: TailEventFamilyDefinition): TailEventFamilyValidation {
  const errors: string[] = [];
  if (typeof family.familyId !== "string" || !family.familyId.trim()) errors.push("MISSING_FAMILY_ID");
  if (!Number.isFinite(family.thresholdValue) || family.thresholdValue <= 0) errors.push("INVALID_THRESHOLD");
  if (!Number.isSafeInteger(family.lookbackWindowMs) || family.lookbackWindowMs <= 0) errors.push("INVALID_LOOKBACK_WINDOW");
  if (!Number.isSafeInteger(family.minEffectiveEventCount) || family.minEffectiveEventCount <= 0) errors.push("INVALID_MIN_EFFECTIVE_EVENT_COUNT");
  if (!isTimestamp(family.frozenAt)) errors.push("INVALID_FROZEN_AT");

  if (family.severityBands.length === 0) {
    errors.push("EMPTY_SEVERITY_BANDS");
  } else {
    const names = new Set<string>();
    let previousMin = -Infinity;
    for (const band of family.severityBands) {
      if (typeof band.name !== "string" || !band.name.trim()) errors.push("MALFORMED_SEVERITY_BAND_NAME");
      else if (names.has(band.name)) errors.push("DUPLICATE_SEVERITY_BAND_NAME");
      else names.add(band.name);
      if (!Number.isFinite(band.minSeverity) || band.minSeverity <= previousMin) errors.push("SEVERITY_BANDS_NOT_STRICTLY_INCREASING");
      previousMin = band.minSeverity;
    }
  }

  return errors.length === 0 ? { valid: true } : { valid: false, errors: Object.freeze([...new Set(errors)]) };
}

/**
 * True only when `family` is internally well-formed (see validateTailEventFamilyDefinition) and
 * was frozen strictly before `earliestOutcomeObservedAt` -- a family frozen at or after the first
 * observed outcome could have had its threshold/window/bands tuned to fit already-known stress
 * episodes, which is exactly the confirmatory/exploratory line this closes.
 */
export function isTailEventFamilyConfirmatory(family: TailEventFamilyDefinition, earliestOutcomeObservedAt: number): boolean {
  if (!validateTailEventFamilyDefinition(family).valid) return false;
  if (!isTimestamp(earliestOutcomeObservedAt)) return false;
  return family.frozenAt < earliestOutcomeObservedAt;
}
