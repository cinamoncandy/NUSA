import type { ShadowEvidenceRecoveryState, ShadowMarketDataStatus, ShadowSafetyState } from "./shadowOperationalTypes";

export interface ShadowReadinessInput {
  readonly safety: ShadowSafetyState;
  /** May throw; an unreadable evidence root is uncertainty about the previous session, not proof none exists. */
  readonly findIncompleteEvidence: () => readonly string[];
  readonly currentEvidenceRecovery: ShadowEvidenceRecoveryState;
  readonly webSocketConnected: boolean;
  readonly marketDataStatus: ShadowMarketDataStatus;
  readonly candleAdapterWarmupComplete: boolean;
  readonly officialWarmupComplete: boolean;
}

export interface ShadowReadinessResult {
  readonly blockers: readonly string[];
  readonly evidenceRecovery: ShadowEvidenceRecoveryState;
}

/**
 * Pure readiness computation, extracted from ShadowOperationalRuntime.computeReadinessBlockers
 * verbatim (ADR-0015 item 4): given the safety/market/evidence inputs the runtime already
 * holds, decide which blockers apply and what the evidence-recovery verdict is. The runtime
 * itself still owns *when* this is called and *whether* to persist the resulting
 * evidenceRecovery onto its own state (the `persistRecovery` decision) -- this function only
 * computes the verdict, it never has access to mutate the runtime.
 */
export function computeShadowReadinessBlockers(input: ShadowReadinessInput): ShadowReadinessResult {
  const { safety } = input;
  // An archive left open by a previous process means the last session's record is of
  // unknown completeness. Starting beside it would interleave two sessions' events with
  // no way to tell later where one ended, so recovery is required before anything runs.
  let incomplete: readonly string[] = [];
  let evidenceRecovery = input.currentEvidenceRecovery;
  try {
    incomplete = input.findIncompleteEvidence();
    if (!Array.isArray(incomplete)) throw new Error("incomplete evidence scan returned an invalid result");
  } catch {
    // An unreadable evidence root is uncertainty about the previous session, not proof that
    // no session exists. Fail closed with the same recovery gate as a markerless archive.
    evidenceRecovery = "RECOVERY_REQUIRED";
  }
  if (incomplete.length > 0) evidenceRecovery = "RECOVERY_REQUIRED";
  const blockers: string[] = [];
  if (!input.webSocketConnected) blockers.push("MARKET_DATA_DISCONNECTED");
  // WARMING_UP is reported once, via the warmupComplete check below -- counting it again
  // here would turn a pure "not warmed up yet" condition into two blockers and defeat the
  // intentional softer handling of that specific, expected, retryable condition.
  else if (input.marketDataStatus !== "HEALTHY" && input.marketDataStatus !== "WARMING_UP") blockers.push(`MARKET_DATA_UNHEALTHY:${input.marketDataStatus}`);
  if (!input.officialWarmupComplete && !input.candleAdapterWarmupComplete) blockers.push("MARKET_DATA_WARMING_UP");
  if (safety.killSwitch) blockers.push("KILL_SWITCH_ACTIVE");
  if (safety.openP0) blockers.push("OPEN_P0_ALERT");
  if (!safety.deploymentIntegrity) blockers.push("DEPLOYMENT_INTEGRITY_FAILED");
  if (!safety.reconciliation) blockers.push("RECONCILIATION_REQUIRED");
  if (safety.automaticTrading) blockers.push("AUTOMATIC_TRADING_ON");
  if (safety.currentModeIsCanaryOrExtended) blockers.push("CANARY_OR_EXTENDED_MODE_ACTIVE");
  if (evidenceRecovery === "RECOVERY_REQUIRED") blockers.push("EVIDENCE_RECOVERY_REQUIRED");
  return { blockers, evidenceRecovery };
}
