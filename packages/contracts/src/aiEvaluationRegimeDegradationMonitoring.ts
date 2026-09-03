/** Immutable regime-degradation monitoring identity and append-only history for WO-AI-011. */
export interface RegimeMonitoringIdentity {
  readonly monitoringId: string;
  readonly baselineCohortId: string;
  readonly windowMs: number;
  readonly cadenceMs: number;
  readonly permittedLooks: number;
  readonly degradationThreshold: number;
  readonly recoveryThreshold: number;
  readonly minSample: number;
  readonly dependencePolicyId: string;
  readonly missingnessPolicyId: string;
  readonly frozenAt: number;
}
export type MonitoringIdentityValidation = { readonly valid: true } | { readonly valid: false; readonly errors: readonly string[] };
const isPositiveSafeInt = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value > 0;
const isNonEmptyString = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0;
const isTimestamp = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
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
export interface LongitudinalEvent { readonly eventId: string; readonly monitoringId: string; readonly kind: LongitudinalEventKind; readonly detectedAt: number; }
export function isAppendOnlyLongitudinalExtension(previousHistory: readonly LongitudinalEvent[], candidateHistory: readonly LongitudinalEvent[]): boolean {
  const candidateById = new Map(candidateHistory.map((event) => [event.eventId, event]));
  return previousHistory.every((previousEvent) => {
    const candidateEvent = candidateById.get(previousEvent.eventId);
    return candidateEvent !== undefined && candidateEvent.monitoringId === previousEvent.monitoringId && candidateEvent.kind === previousEvent.kind && candidateEvent.detectedAt === previousEvent.detectedAt;
  });
}
export function isCurrentlyRecovered(monitoringId: string, history: readonly LongitudinalEvent[]): boolean {
  const relevant = history.filter((event) => event.monitoringId === monitoringId);
  if (relevant.length === 0) return false;
  const mostRecent = relevant.reduce((latest, event) => (event.detectedAt > latest.detectedAt ? event : latest));
  return mostRecent.kind === "RECOVERY";
}
