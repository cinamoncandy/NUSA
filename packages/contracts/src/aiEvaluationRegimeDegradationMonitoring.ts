/**
 * Immutable regime degradation monitoring identity and append-only degradation/recovery
 * longitudinal history for AI prediction evaluation (WO-AI-011: Governed Longitudinal Held-Out
 * Evaluation).
 *
 * A narrow slice of the larger planning-only work order. Closes only the "immutable monitoring
 * identity covering baseline cohort, window, cadence, permitted looks, thresholds, recovery
 * criteria, minimum sample, dependence policy, and missingness/coverage policy" and "degradation
 * and recovery remain separate immutable longitudinal evidence and cannot erase one another"
 * requirements. A monitoring setup tuned after degradation was already observed could inflate a
 * false "recovery," and a later "recovery" record must never delete or overwrite the prior
 * degradation record it followed -- longitudinal history is append-only.
 */

export interface RegimeMonitoringIdentity {
  readonly monitoringId: string;
  readonly baselineCohortId: string;
  readonly windowMs: number;
  readonly cadenceMs: number;
  /** Maximum number of repeated looks permitted under this monitoring identity's frozen policy
   * (composes with aiEvaluationMultipleTestingCorrection.ts's trial-count ledger downstream). */
  readonly permittedLooks: number;
  readonly degradationThreshold: number;
  readonly recoveryThreshold: number;
  readonly minSample: number;
  readonly dependencePolicyId: string;
  readonly missingnessPolicyId: string;
  readonly frozenAt: number;
}

export type MonitoringIdentityValidation =
  | { readonly valid: true }
  | { readonly valid: false; readonly errors: readonly string[] };

const isPositiveSafeInt = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value > 0;
const isNonEmptyString = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0;
const isTimestamp = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= 0;

/**
 * Validates that every required field of a regime monitoring identity is present and well-formed
 * -- baseline cohort/dependence-policy/missingness-policy ids non-empty, window/cadence/
 * permittedLooks/minSample positive integers, thresholds finite, frozenAt a valid timestamp.
 * Fails closed on any violation: a partially-specified monitoring identity can never anchor a
 * confirmatory degradation or recovery claim.
 */
export function validateRegimeMonitoringIdentity(identity: RegimeMonitoringIdentity): MonitoringIdentityValidation {
  const errors: string[] = [];
  if (!isNonEmptyString(identity.monitoringId)) errors.push("MISSING_MONITORING_ID");
  if (!isNonEmptyString(identity.baselineCohortId)) errors.push("MISSING_BASELINE_COHORT_ID");
  if (!isPositiveSafeInt(identity.windowMs)) errors.push("INVALID_WINDOW_MS");
  if (!isPositiveSafeInt(identity.cadenceMs)) errors.push("INVALID_CADENCE_MS");
  if (!isPositiveSafeInt(identity.permittedLooks)) errors.push("INVALID_PERMITTED_LOOKS");
  if (!Number.isFinite(identity.degradationThreshold)) errors.push("INVALID_DEGRADATION_THRESHOLD");
  if (!Number.isFinite(identity.recoveryThreshold)) errors.push("INVALID_RECOVERY_THRESHOLD");
  if (!isPositiveSafeInt(identity.minSample)) errors.push("INVALID_MIN_SAMPLE");
  if (!isNonEmptyString(identity.dependencePolicyId)) errors.push("MISSING_DEPENDENCE_POLICY_ID");
  if (!isNonEmptyString(identity.missingnessPolicyId)) errors.push("MISSING_MISSINGNESS_POLICY_ID");
  if (!isTimestamp(identity.frozenAt)) errors.push("INVALID_FROZEN_AT");
  return errors.length === 0 ? { valid: true } : { valid: false, errors: Object.freeze(errors) };
}

export type LongitudinalEventKind = "DEGRADATION" | "RECOVERY";

export interface LongitudinalEvent {
  readonly eventId: string;
  readonly monitoringId: string;
  readonly kind: LongitudinalEventKind;
  readonly detectedAt: number;
}

/**
 * True only when `candidateHistory` is a valid append-only extension of `previousHistory`: every
 * event in `previousHistory` appears unchanged (by eventId, deep-equal) in `candidateHistory`.
 * Rejects any history that drops, mutates, or reorders-with-different-content a prior event --
 * degradation evidence must never be silently erased by a later "recovery" record, and vice
 * versa. New events may freely be appended.
 */
export function isAppendOnlyLongitudinalExtension(
  previousHistory: readonly LongitudinalEvent[],
  candidateHistory: readonly LongitudinalEvent[],
): boolean {
  const candidateById = new Map(candidateHistory.map((event) => [event.eventId, event]));
  return previousHistory.every((previousEvent) => {
    const candidateEvent = candidateById.get(previousEvent.eventId);
    if (candidateEvent === undefined) return false;
    return candidateEvent.monitoringId === previousEvent.monitoringId
      && candidateEvent.kind === previousEvent.kind
      && candidateEvent.detectedAt === previousEvent.detectedAt;
  });
}

/**
 * True only when the most recent event (by detectedAt) bound to `monitoringId` in `history` is a
 * RECOVERY event -- i.e. the monitoring identity's current status is "recovered," without
 * pretending the prior degradation never happened (the degradation event remains in history
 * either way). False (not-recovered / unknown) for an empty history or one with no events for
 * this monitoringId, rather than assuming recovery by default.
 */
export function isCurrentlyRecovered(monitoringId: string, history: readonly LongitudinalEvent[]): boolean {
  const relevant = history.filter((event) => event.monitoringId === monitoringId);
  if (relevant.length === 0) return false;
  const mostRecent = relevant.reduce((latest, event) => (event.detectedAt > latest.detectedAt ? event : latest));
  return mostRecent.kind === "RECOVERY";
}
