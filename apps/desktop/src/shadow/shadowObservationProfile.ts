/**
 * The single place the WO-0034-A4 observation settings live.
 *
 * Everything here is a constant rather than a runtime option on purpose. An observation
 * profile that can be widened at run time is a profile that can be widened by accident, and
 * the whole point of A4 is that the first real Shadow observation runs inside boundaries
 * that were fixed before it started.
 *
 * There is deliberately no field for enabling real orders, no field for a private-API
 * endpoint, and no field that accepts a credential. Those are not omissions to be filled in
 * later by this module -- adding one here would put an order-enabling switch one edit away
 * from the observation path.
 */

export interface ShadowObservationProfile {
  readonly market: "KRW-BTC";
  readonly candleInterval: "1m";
  /** Closed candles only. An in-progress candle never reaches the strategy. */
  readonly closedCandlesOnly: true;
  readonly strategyId: "sma-crossover";
  readonly strategyVersion: "sma-crossover:closed-candle-1m-v1";
  readonly actualOrdersEnabled: false;
  readonly privateApiEnabled: false;
  /** The intended length of the first observation. Not enforced; `maxSessionDurationMs` is. */
  readonly initialObservationDurationMs: number;
  /** Hard ceiling. The runtime stops the session itself once elapsed time passes this. */
  readonly maxSessionDurationMs: number;
  /** Must not exceed A3's bounded queue capacity; a larger value would weaken that bound. */
  readonly maxQueueDepth: number;
  readonly evidenceRequired: true;
  readonly recoveryRequiredCheck: true;
  /** A closed candle older than this, relative to wall clock, is stale. */
  readonly maxCandleAgeMs: number;
}

/** A3's `DEFAULT_CAPACITY`. Duplicated as a named constant so the ceiling below is checked. */
const A3_BOUNDED_QUEUE_CAPACITY = 1_000;

export const SHADOW_OBSERVATION_PROFILE: ShadowObservationProfile = Object.freeze({
  market: "KRW-BTC",
  candleInterval: "1m",
  closedCandlesOnly: true,
  strategyId: "sma-crossover",
  strategyVersion: "sma-crossover:closed-candle-1m-v1",
  actualOrdersEnabled: false,
  privateApiEnabled: false,
  initialObservationDurationMs: 10 * 60_000,
  maxSessionDurationMs: 30 * 60_000,
  maxQueueDepth: A3_BOUNDED_QUEUE_CAPACITY,
  evidenceRequired: true,
  recoveryRequiredCheck: true,
  maxCandleAgeMs: 3 * 60_000
});

export type ShadowObservationProfileViolation =
  | "MARKET_NOT_KRW_BTC"
  | "INTERVAL_NOT_1M"
  | "CLOSED_CANDLES_NOT_ENFORCED"
  | "UNAPPROVED_STRATEGY"
  | "ACTUAL_ORDERS_ENABLED"
  | "PRIVATE_API_ENABLED"
  | "INITIAL_DURATION_EXCEEDS_MAXIMUM"
  | "MAX_DURATION_NOT_POSITIVE"
  | "QUEUE_DEPTH_EXCEEDS_A3_BOUND"
  | "EVIDENCE_NOT_REQUIRED"
  | "RECOVERY_CHECK_DISABLED"
  | "CANDLE_AGE_TOLERANCE_NOT_POSITIVE";

/**
 * Re-derives that a profile is inside every A4 boundary, rather than trusting that the
 * constant above was never edited. This runs in the preflight, so a profile weakened by a
 * later edit blocks the observation instead of silently widening it.
 */
export function validateShadowObservationProfile(profile: ShadowObservationProfile): readonly ShadowObservationProfileViolation[] {
  const violations: ShadowObservationProfileViolation[] = [];
  if (profile.market !== "KRW-BTC") violations.push("MARKET_NOT_KRW_BTC");
  if (profile.candleInterval !== "1m") violations.push("INTERVAL_NOT_1M");
  if (profile.closedCandlesOnly !== true) violations.push("CLOSED_CANDLES_NOT_ENFORCED");
  if (profile.strategyId !== "sma-crossover" || profile.strategyVersion !== "sma-crossover:closed-candle-1m-v1") violations.push("UNAPPROVED_STRATEGY");
  // These two are typed as literal `false`, so reaching them requires a cast or a JS caller.
  // That is exactly the case worth catching: the type system does not protect the runtime.
  if (profile.actualOrdersEnabled as boolean) violations.push("ACTUAL_ORDERS_ENABLED");
  if (profile.privateApiEnabled as boolean) violations.push("PRIVATE_API_ENABLED");
  if (!Number.isFinite(profile.maxSessionDurationMs) || profile.maxSessionDurationMs <= 0) violations.push("MAX_DURATION_NOT_POSITIVE");
  if (profile.initialObservationDurationMs > profile.maxSessionDurationMs) violations.push("INITIAL_DURATION_EXCEEDS_MAXIMUM");
  if (!Number.isSafeInteger(profile.maxQueueDepth) || profile.maxQueueDepth < 1 || profile.maxQueueDepth > A3_BOUNDED_QUEUE_CAPACITY) violations.push("QUEUE_DEPTH_EXCEEDS_A3_BOUND");
  if (profile.evidenceRequired !== true) violations.push("EVIDENCE_NOT_REQUIRED");
  if (profile.recoveryRequiredCheck !== true) violations.push("RECOVERY_CHECK_DISABLED");
  if (!Number.isFinite(profile.maxCandleAgeMs) || profile.maxCandleAgeMs <= 0) violations.push("CANDLE_AGE_TOLERANCE_NOT_POSITIVE");
  return Object.freeze(violations);
}

/**
 * Narrows the profile for a short smoke run. Only the two duration fields may be shortened,
 * and only downward -- there is no path through this function that lengthens a session,
 * changes the market, or turns anything on.
 *
 * Fail-closed: an unparseable or out-of-range value throws rather than falling back to the
 * default, because a silently-ignored override is how a two-minute smoke test becomes a
 * thirty-minute one nobody meant to start.
 */
export function withShortenedObservation(profile: ShadowObservationProfile, maxSessionDurationMs: number): ShadowObservationProfile {
  if (!Number.isFinite(maxSessionDurationMs) || maxSessionDurationMs <= 0) throw new Error(`invalid observation duration: ${maxSessionDurationMs}`);
  if (maxSessionDurationMs > profile.maxSessionDurationMs) throw new Error(`observation duration ${maxSessionDurationMs}ms exceeds the profile maximum ${profile.maxSessionDurationMs}ms`);
  return Object.freeze({
    ...profile,
    initialObservationDurationMs: Math.min(profile.initialObservationDurationMs, maxSessionDurationMs),
    maxSessionDurationMs
  });
}
