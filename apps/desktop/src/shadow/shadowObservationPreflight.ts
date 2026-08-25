import { SHADOW_OBSERVATION_PROFILE, validateShadowObservationProfile, type ShadowObservationProfile } from "./shadowObservationProfile";
import type { ShadowLifecycleStatus } from "./shadowOperationalRuntime";

/**
 * The gate that must pass before a real Shadow observation starts (WO-0034-A4).
 *
 * This module measures nothing itself. It is a pure function over facts its caller supplies,
 * for one reason: a preflight that goes and looks things up is a preflight whose result
 * cannot be reproduced in a test without the world it looked at. The callers -- the smoke
 * runner and, later, the desktop -- are responsible for supplying real measurements, and
 * `capabilityScanMethod` records how the capability facts were obtained so a reader cannot
 * mistake a source scan for a proof.
 *
 * A scan can only prove PRESENCE, never absence. `privateApiCapabilityPresent: false` means
 * "no known private-API pattern was found in the shipping source", not "this build provably
 * cannot reach a private endpoint". The report says so in `capabilityScanMethod` rather than
 * quietly upgrading a grep to a guarantee.
 */

export interface ShadowObservationMutationCounters {
  readonly actualBrokerCallCount: number;
  readonly actualOrderCount: number;
  readonly actualFillCount: number;
  readonly cashMutationCount: number;
  readonly positionMutationCount: number;
  readonly privateApiCallCount: number;
}

export interface ShadowObservationPreflightInput {
  readonly profile: ShadowObservationProfile;
  /** The runtime's current lifecycle. Only IDLE can start a session. */
  readonly runtimeState: ShadowLifecycleStatus;
  readonly evidenceRecoveryState: "NONE" | "RECOVERY_REQUIRED";
  /** Archives a previous process left unsealed. Any entry blocks the start. */
  readonly incompleteEvidenceArchives: readonly string[];
  /** True only if the evidence root exists (or can be created) and is writable. */
  readonly evidenceArchiveWritable: boolean;
  readonly liveTradingCapabilityPresent: boolean;
  readonly privateApiCapabilityPresent: boolean;
  readonly credentialStoragePresent: boolean;
  /** How the three capability flags above were obtained. Recorded, never inferred. */
  readonly capabilityScanMethod: string;
  readonly mutationCounters: ShadowObservationMutationCounters;
  /** The market and candle source the runtime is actually configured with. */
  readonly configuredMarket: string;
  readonly configuredInterval: string;
  readonly configuredSourceType: string;
  readonly closedCandlesOnly: boolean;
  /** Wall-clock reading used for the clock-sanity check. */
  readonly now: number;
  /** True once the bus and the durable sink for this session are constructible. */
  readonly evidenceSinkReady: boolean;
  readonly busCapacity: number;
}

export interface ShadowObservationPreflightReport {
  readonly status: "PASS" | "BLOCKED";
  readonly blockers: readonly string[];
  readonly checkedAt: number;
  readonly profile: ShadowObservationProfile;
  readonly capabilityScanMethod: string;
  /** Stated plainly so a PASS is never read as proof that no capability exists. */
  readonly capabilityAssuranceLimit: "SOURCE_SCAN_PROVES_PRESENCE_NOT_ABSENCE";
}

/**
 * Timestamps below this are not a plausible wall clock. Used only to catch a clock that was
 * never set (epoch 0, or a container with an unsynchronised RTC), not to police drift --
 * per-candle drift is the runtime's own CLOCK_DRIFT check.
 */
const EARLIEST_PLAUSIBLE_CLOCK = Date.UTC(2024, 0, 1);

export function evaluateShadowObservationPreflight(input: ShadowObservationPreflightInput): ShadowObservationPreflightReport {
  const blockers: string[] = [];

  for (const violation of validateShadowObservationProfile(input.profile)) blockers.push(`PROFILE_${violation}`);

  // Only IDLE can start. Anything else means a session already exists, and starting beside
  // it would interleave two sessions' events in one archive with no way to separate them.
  if (input.runtimeState !== "IDLE") blockers.push(`RUNTIME_NOT_STARTABLE:${input.runtimeState}`);
  if (input.evidenceRecoveryState === "RECOVERY_REQUIRED") blockers.push("EVIDENCE_RECOVERY_REQUIRED");
  if (input.incompleteEvidenceArchives.length > 0) blockers.push(`INCOMPLETE_EVIDENCE_ARCHIVES:${input.incompleteEvidenceArchives.length}`);
  if (!input.evidenceArchiveWritable) blockers.push("EVIDENCE_ARCHIVE_NOT_WRITABLE");
  if (!input.evidenceSinkReady) blockers.push("EVIDENCE_SINK_NOT_READY");

  if (input.liveTradingCapabilityPresent) blockers.push("LIVE_TRADING_CAPABILITY_PRESENT");
  if (input.privateApiCapabilityPresent) blockers.push("PRIVATE_API_CAPABILITY_PRESENT");
  if (input.credentialStoragePresent) blockers.push("CREDENTIAL_STORAGE_PRESENT");
  if (typeof input.capabilityScanMethod !== "string" || input.capabilityScanMethod.length === 0) blockers.push("CAPABILITY_SCAN_METHOD_UNDECLARED");

  const counters = input.mutationCounters;
  // Every one of these must be exactly 0, not "small". Shadow's entire claim is that it
  // mutates nothing; a single non-zero counter falsifies that claim outright.
  if (counters.actualBrokerCallCount !== 0) blockers.push(`BROKER_MUTATION:${counters.actualBrokerCallCount}`);
  if (counters.actualOrderCount !== 0) blockers.push(`ORDER_MUTATION:${counters.actualOrderCount}`);
  if (counters.actualFillCount !== 0) blockers.push(`FILL_MUTATION:${counters.actualFillCount}`);
  if (counters.cashMutationCount !== 0) blockers.push(`CASH_MUTATION:${counters.cashMutationCount}`);
  if (counters.positionMutationCount !== 0) blockers.push(`POSITION_MUTATION:${counters.positionMutationCount}`);
  if (counters.privateApiCallCount !== 0) blockers.push(`PRIVATE_API_CALLS:${counters.privateApiCallCount}`);

  if (input.configuredMarket !== input.profile.market) blockers.push(`MARKET_MISMATCH:${input.configuredMarket}`);
  if (input.configuredInterval !== input.profile.candleInterval) blockers.push(`INTERVAL_MISMATCH:${input.configuredInterval}`);
  if (input.configuredSourceType !== "UPBIT_PUBLIC_CANDLE" && input.configuredSourceType !== "UPBIT_PUBLIC_TICKER") blockers.push(`UNSUPPORTED_CANDLE_SOURCE:${input.configuredSourceType}`);
  if (!input.closedCandlesOnly) blockers.push("CLOSED_CANDLES_NOT_ENFORCED");

  if (!Number.isFinite(input.now) || input.now < EARLIEST_PLAUSIBLE_CLOCK) blockers.push("CLOCK_IMPLAUSIBLE");

  if (!Number.isSafeInteger(input.busCapacity) || input.busCapacity < 1) blockers.push("QUEUE_CAPACITY_INVALID");
  else if (input.busCapacity > input.profile.maxQueueDepth) blockers.push(`QUEUE_CAPACITY_EXCEEDS_PROFILE:${input.busCapacity}`);

  return Object.freeze({
    status: blockers.length === 0 ? "PASS" : "BLOCKED",
    blockers: Object.freeze([...new Set(blockers)].sort()),
    checkedAt: input.now,
    profile: input.profile,
    capabilityScanMethod: input.capabilityScanMethod,
    capabilityAssuranceLimit: "SOURCE_SCAN_PROVES_PRESENCE_NOT_ABSENCE"
  });
}

/** The profile a caller gets when it does not supply one. Exported for the smoke runner. */
export const DEFAULT_OBSERVATION_PROFILE = SHADOW_OBSERVATION_PROFILE;
