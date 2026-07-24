export type ReadinessAction = "ALLOW_NEW_ENTRIES" | "ALLOW_EXIT_ONLY" | "HALT";

export interface OperationalReadinessInput {
  readonly now: number;
  readonly mode: "PAPER" | "DRY_RUN" | "STOPPED" | "FAULTED";
  readonly killSwitchActive: boolean;
  readonly recoveryUnresolved: boolean;
  readonly strategySuspended: boolean;
  readonly dataFingerprintMatches: boolean;
  readonly marketDataObservedAt: number;
  readonly maximumDataAgeMs: number;
  readonly warmupSamples: number;
  readonly requiredWarmupSamples: number;
  readonly disconnectedAt?: number;
  readonly reconnectedAt?: number;
  readonly reconnectCooldownMs: number;
  readonly protectionLockedUntil?: number;
}

export interface OperationalReadinessDecision {
  readonly action: ReadinessAction;
  readonly ready: boolean;
  readonly reasons: readonly string[];
  readonly evaluatedAt: number;
}

const safeTime = (value: number, field: string): void => {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${field} is invalid`);
};

export function evaluateOperationalReadiness(input: OperationalReadinessInput): OperationalReadinessDecision {
  safeTime(input.now, "now");
  safeTime(input.marketDataObservedAt, "marketDataObservedAt");
  safeTime(input.maximumDataAgeMs, "maximumDataAgeMs");
  safeTime(input.reconnectCooldownMs, "reconnectCooldownMs");
  if (!Number.isSafeInteger(input.warmupSamples) || input.warmupSamples < 0 || !Number.isSafeInteger(input.requiredWarmupSamples) || input.requiredWarmupSamples <= 0) throw new Error("warmup sample counts are invalid");
  if (input.marketDataObservedAt > input.now) throw new Error("market data cannot come from the future");
  if (input.disconnectedAt !== undefined) safeTime(input.disconnectedAt, "disconnectedAt");
  if (input.reconnectedAt !== undefined) safeTime(input.reconnectedAt, "reconnectedAt");
  if (input.protectionLockedUntil !== undefined) safeTime(input.protectionLockedUntil, "protectionLockedUntil");

  const reasons: string[] = [];
  if (input.mode !== "PAPER" && input.mode !== "DRY_RUN") reasons.push("PAPER_OR_DRY_RUN_REQUIRED");
  if (input.killSwitchActive) reasons.push("KILL_SWITCH_ACTIVE");
  if (input.recoveryUnresolved) reasons.push("RECOVERY_UNRESOLVED");
  if (input.strategySuspended) reasons.push("STRATEGY_SUSPENDED");
  if (!input.dataFingerprintMatches) reasons.push("DATA_FINGERPRINT_MISMATCH");
  if (input.now - input.marketDataObservedAt > input.maximumDataAgeMs) reasons.push("MARKET_DATA_STALE");
  if (input.warmupSamples < input.requiredWarmupSamples) reasons.push("WARMUP_INCOMPLETE");
  if (input.protectionLockedUntil !== undefined && input.protectionLockedUntil > input.now) reasons.push("PROTECTION_LOCK_ACTIVE");
  if (input.disconnectedAt !== undefined) {
    if (input.reconnectedAt === undefined || input.reconnectedAt < input.disconnectedAt) reasons.push("MARKET_DATA_DISCONNECTED");
    else if (input.now - input.reconnectedAt < input.reconnectCooldownMs) reasons.push("RECONNECT_COOLDOWN_ACTIVE");
  }

  const critical = reasons.some((reason) => ["KILL_SWITCH_ACTIVE", "RECOVERY_UNRESOLVED", "MARKET_DATA_DISCONNECTED", "PAPER_OR_DRY_RUN_REQUIRED"].includes(reason));
  const action: ReadinessAction = reasons.length === 0 ? "ALLOW_NEW_ENTRIES" : critical ? "HALT" : "ALLOW_EXIT_ONLY";
  return Object.freeze({ action, ready: action === "ALLOW_NEW_ENTRIES", reasons: Object.freeze(reasons.sort()), evaluatedAt: input.now });
}
