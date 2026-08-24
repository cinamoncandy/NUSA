export type LiveReadinessStatus = "NOT_READY" | "READY_FOR_MANUAL_ENABLE" | "ENABLED" | "HALTED";

export interface LiveRiskLimits {
  readonly maxNotionalPerOrder: number;
  readonly maxDailyLoss: number;
  readonly maxOpenExposure: number;
  readonly maxConcurrentPositions: number;
  readonly maxSlippageBps: number;
  readonly maxOrdersPerMinute: number;
  readonly marketAllowlist: readonly string[];
}

export interface LiveActivationLease {
  readonly leaseId: string;
  readonly ownerPrincipalId: string;
  readonly environmentFingerprint: string;
  readonly accountFingerprint: string;
  readonly issuedAt: string;
  readonly expiresAt: string;
  readonly explicitHumanConfirmation: true;
}

export interface LiveReadinessEvidence {
  readonly paperAutoLearningStable: boolean;
  readonly shadowReplayEvidenceValid: boolean;
  readonly realAccountReadOnlyHealthy: boolean;
  readonly governanceApproved: boolean;
  readonly tradePermissionPasses: boolean;
  readonly riskAuthorityHealthy: boolean;
  readonly reconciliationTestsPass: boolean;
  readonly killSwitchTestsPass: boolean;
  readonly idempotencyTestsPass: boolean;
  readonly exchangeFaultTestsPass: boolean;
  readonly requiredCiPasses: boolean;
  readonly noWithdrawalOrTransferPath: boolean;
  readonly environmentFingerprint: string;
  readonly accountFingerprint: string;
  readonly riskLimits?: LiveRiskLimits;
  /** Production source providers set this false when any critical source is missing or stale. */
  readonly sourceEvidenceAvailable?: boolean;
}

export interface LiveRuntimeSafetyState {
  readonly killSwitchActive: boolean;
  readonly staleMarketData: boolean;
  readonly reconciliationMismatch: boolean;
  readonly exchangeError: boolean;
  readonly abnormalBalanceDrift: boolean;
  readonly riskBudgetBreached: boolean;
  readonly strategyInvalidated: boolean;
  readonly latencyOrSlippageBreached: boolean;
}

export interface LiveAuthorityState {
  readonly liveAuthority: "NONE" | "BOUNDED_LIVE";
  readonly productionMutationAllowed: boolean;
  readonly activationLease?: LiveActivationLease;
}

export interface LiveReadinessResult {
  readonly status: LiveReadinessStatus;
  readonly blockers: readonly string[];
  readonly environmentFingerprint: string;
  readonly accountFingerprint: string;
  readonly authority: LiveAuthorityState;
}

const finitePositive = (value: number): boolean => Number.isFinite(value) && value > 0;

export function validateLiveRiskLimits(limits: LiveRiskLimits | undefined): readonly string[] {
  if (!limits) return Object.freeze(["RISK_LIMITS_MISSING"]);
  const blockers: string[] = [];
  if (!finitePositive(limits.maxNotionalPerOrder)) blockers.push("MAX_NOTIONAL_INVALID");
  if (!finitePositive(limits.maxDailyLoss)) blockers.push("MAX_DAILY_LOSS_INVALID");
  if (!finitePositive(limits.maxOpenExposure)) blockers.push("MAX_OPEN_EXPOSURE_INVALID");
  if (!Number.isSafeInteger(limits.maxConcurrentPositions) || limits.maxConcurrentPositions < 1) blockers.push("MAX_CONCURRENT_POSITIONS_INVALID");
  if (!finitePositive(limits.maxSlippageBps)) blockers.push("MAX_SLIPPAGE_INVALID");
  if (!Number.isSafeInteger(limits.maxOrdersPerMinute) || limits.maxOrdersPerMinute < 1) blockers.push("MAX_ORDER_FREQUENCY_INVALID");
  if (limits.marketAllowlist.length === 0 || new Set(limits.marketAllowlist).size !== limits.marketAllowlist.length || limits.marketAllowlist.some((market) => !/^[A-Z0-9]+-[A-Z0-9]+$/.test(market))) blockers.push("MARKET_ALLOWLIST_INVALID");
  return Object.freeze(blockers);
}

export function isLiveActivationLeaseValid(lease: LiveActivationLease | undefined, evidence: LiveReadinessEvidence, nowIso: string): boolean {
  if (!lease) return false;
  const issued = Date.parse(lease.issuedAt);
  const expires = Date.parse(lease.expiresAt);
  const now = Date.parse(nowIso);
  return Boolean(
    lease.explicitHumanConfirmation === true &&
    lease.ownerPrincipalId.trim() &&
    lease.leaseId.trim() &&
    Number.isFinite(issued) && Number.isFinite(expires) && Number.isFinite(now) &&
    issued <= now && now < expires && expires > issued &&
    lease.environmentFingerprint === evidence.environmentFingerprint &&
    lease.accountFingerprint === evidence.accountFingerprint
  );
}

export function evaluateLiveReadiness(
  evidence: LiveReadinessEvidence,
  runtime: LiveRuntimeSafetyState,
  authority: LiveAuthorityState = { liveAuthority: "NONE", productionMutationAllowed: false },
  nowIso = new Date().toISOString(),
): LiveReadinessResult {
  const blockers: string[] = [];
  const checks: readonly [boolean, string][] = [
    [evidence.paperAutoLearningStable, "PAPER_AUTO_LEARNING_NOT_STABLE"],
    [evidence.shadowReplayEvidenceValid, "SHADOW_REPLAY_EVIDENCE_MISSING"],
    [evidence.realAccountReadOnlyHealthy, "REAL_ACCOUNT_READ_ONLY_UNHEALTHY"],
    [evidence.governanceApproved, "GOVERNANCE_NOT_APPROVED"],
    [evidence.tradePermissionPasses, "TRADE_PERMISSION_REJECTED"],
    [evidence.riskAuthorityHealthy, "RISK_AUTHORITY_UNHEALTHY"],
    [evidence.reconciliationTestsPass, "RECONCILIATION_TESTS_FAILED"],
    [evidence.killSwitchTestsPass, "KILL_SWITCH_TESTS_FAILED"],
    [evidence.idempotencyTestsPass, "IDEMPOTENCY_TESTS_FAILED"],
    [evidence.exchangeFaultTestsPass, "EXCHANGE_FAULT_TESTS_FAILED"],
    [evidence.requiredCiPasses, "REQUIRED_CI_NOT_GREEN"],
    [evidence.noWithdrawalOrTransferPath, "WITHDRAWAL_OR_TRANSFER_PATH_PRESENT"],
  ];
  for (const [passed, reason] of checks) if (!passed) blockers.push(reason);
  blockers.push(...validateLiveRiskLimits(evidence.riskLimits));
  if (evidence.sourceEvidenceAvailable === false) blockers.push("SOURCE_EVIDENCE_INCOMPLETE");
  if (!evidence.environmentFingerprint.trim()) blockers.push("ENVIRONMENT_FINGERPRINT_MISSING");
  if (!evidence.accountFingerprint.trim()) blockers.push("ACCOUNT_FINGERPRINT_MISSING");

  const hardHalts: readonly [boolean, string][] = [
    [runtime.killSwitchActive, "KILL_SWITCH_ACTIVE"],
    [runtime.staleMarketData, "STALE_MARKET_DATA"],
    [runtime.reconciliationMismatch, "RECONCILIATION_MISMATCH"],
    [runtime.exchangeError, "EXCHANGE_ERROR"],
    [runtime.abnormalBalanceDrift, "ABNORMAL_BALANCE_DRIFT"],
    [runtime.riskBudgetBreached, "RISK_BUDGET_BREACH"],
    [runtime.strategyInvalidated, "STRATEGY_INVALIDATED"],
    [runtime.latencyOrSlippageBreached, "LATENCY_OR_SLIPPAGE_BREACH"],
  ];
  const haltReasons = hardHalts.filter(([active]) => active).map(([, reason]) => reason);
  blockers.push(...haltReasons);

  if (authority.productionMutationAllowed && authority.liveAuthority !== "BOUNDED_LIVE") blockers.push("MUTATION_WITHOUT_BOUNDED_LIVE_AUTHORITY");
  if (authority.liveAuthority === "BOUNDED_LIVE" && !authority.productionMutationAllowed) blockers.push("INCONSISTENT_LIVE_AUTHORITY_STATE");

  const leaseValid = isLiveActivationLeaseValid(authority.activationLease, evidence, nowIso);
  if (authority.liveAuthority === "BOUNDED_LIVE" && !leaseValid) blockers.push("ACTIVATION_LEASE_INVALID_OR_EXPIRED");

  let status: LiveReadinessStatus;
  if (haltReasons.length > 0) status = "HALTED";
  else if (blockers.length > 0) status = "NOT_READY";
  else if (authority.liveAuthority === "BOUNDED_LIVE" && authority.productionMutationAllowed && leaseValid) status = "ENABLED";
  else status = "READY_FOR_MANUAL_ENABLE";

  return Object.freeze({
    status,
    blockers: Object.freeze([...new Set(blockers)]),
    environmentFingerprint: evidence.environmentFingerprint,
    accountFingerprint: evidence.accountFingerprint,
    authority: Object.freeze({ ...authority }),
  });
}

export function createDormantLiveAuthority(): LiveAuthorityState {
  return Object.freeze({ liveAuthority: "NONE", productionMutationAllowed: false });
}
