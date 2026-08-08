import { createHash } from "node:crypto";

export type TinyBoundedEnvelopeVerdict = "BOUNDED_ENVELOPE_VALID" | "SAFE_BLOCK" | "UNKNOWN";
export type BinaryEvidence = "PASS" | "FAIL" | "UNKNOWN";
export type ReconciliationEvidence = "MATCH" | "DIFF" | "UNKNOWN";
export type MarketDataEvidence = "HEALTHY" | "UNHEALTHY" | "UNKNOWN";

export interface TinyBoundedLimits {
  readonly maxOrderNotionalBps: number;
  readonly maxGrossExposureBps: number;
  readonly maxDailyLossBps: number;
  readonly maxOpenOrders: number;
  readonly maxPositionCount: number;
  readonly maxSessionOrders: number;
  readonly sessionDurationSeconds: number;
}

export interface TinyBoundedEnvelopeInput {
  readonly envelopeId: string;
  readonly codeRevision: string;
  readonly configurationHash: string;
  readonly releaseSealFingerprint: string;
  readonly preflightFingerprint: string;
  readonly ceremonyRecordFingerprint: string;
  readonly capabilityContract: string;
  readonly strategyIdentity: string;
  readonly rollbackBundleId: string;
  readonly symbolAllowlist: readonly string[];
  readonly limits: TinyBoundedLimits;
  readonly safety: Readonly<{
    killSwitchReadiness: BinaryEvidence;
    haltPathReadiness: BinaryEvidence;
    rollbackReadiness: BinaryEvidence;
    reconciliation: ReconciliationEvidence;
    hardRisk: BinaryEvidence;
    marketData: MarketDataEvidence;
    postTradeObservation: BinaryEvidence;
  }>;
  readonly singleSession: boolean;
  readonly automaticRenewalAllowed: boolean;
  readonly automaticScaleUpAllowed: boolean;
  readonly executionTransportConnected: boolean;
  readonly executionCredentialUseEnabled: boolean;
  readonly realMoneyExecutionAllowed: boolean;
}

export interface TinyBoundedEnvelopeResult {
  readonly verdict: TinyBoundedEnvelopeVerdict;
  readonly blockers: readonly string[];
  readonly unknowns: readonly string[];
  readonly envelopeFingerprint: string;
  readonly normalizedSymbols: readonly string[];
  readonly hardCeilings: TinyBoundedLimits;
  readonly orderAuthorization: false;
  readonly activationAuthority: false;
  readonly executionAuthority: false;
  readonly authorizesLive: false;
  readonly mutationPerformed: false;
  readonly realMoneyExecutionAllowed: false;
}

export const TINY_BOUNDED_LIVE_HARD_CEILINGS: Readonly<TinyBoundedLimits> = Object.freeze({
  maxOrderNotionalBps: 10,
  maxGrossExposureBps: 50,
  maxDailyLossBps: 10,
  maxOpenOrders: 1,
  maxPositionCount: 1,
  maxSessionOrders: 5,
  sessionDurationSeconds: 3600
});

export const TINY_BOUNDED_LIVE_ENVELOPE_DESCRIPTOR = Object.freeze({
  mode: "POLICY_VALIDATION_ONLY" as const,
  nonExpandable: true as const,
  singleSessionRequired: true as const,
  automaticRenewalAllowed: false as const,
  automaticScaleUpAllowed: false as const,
  symbolAdditionAllowed: false as const,
  orderAuthorization: false as const,
  activationAuthority: false as const,
  executionAuthority: false as const,
  authorizesLive: false as const,
  mutationPerformed: false as const,
  networkDialAllowed: false as const,
  credentialExecutionUse: false as const,
  realMoneyExecutionAllowed: false as const
});

const secretLike = /(?:bearer\s+|private[_ -]?key|api[_ -]?secret|access[_ -]?token|authorization\s*:|credential\s*:)/i;

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    const object = value as Record<string, unknown>;
    return `{${Object.keys(object).sort().map((key) => `${JSON.stringify(key)}:${canonical(object[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function required(value: string, code: string): string {
  const normalized = value.trim();
  if (!normalized || secretLike.test(normalized)) throw new Error(code);
  return normalized;
}

function exactHash(value: string, length: 40 | 64, code: string): string {
  if (!new RegExp(`^[0-9a-f]{${length}}$`).test(value)) throw new Error(code);
  return value;
}

function positiveInteger(value: number, code: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(code);
  return value;
}

function normalizeLimits(limits: TinyBoundedLimits): TinyBoundedLimits {
  return Object.freeze({
    maxOrderNotionalBps: positiveInteger(limits.maxOrderNotionalBps, "ENVELOPE_ORDER_BPS_INVALID"),
    maxGrossExposureBps: positiveInteger(limits.maxGrossExposureBps, "ENVELOPE_EXPOSURE_BPS_INVALID"),
    maxDailyLossBps: positiveInteger(limits.maxDailyLossBps, "ENVELOPE_DAILY_LOSS_BPS_INVALID"),
    maxOpenOrders: positiveInteger(limits.maxOpenOrders, "ENVELOPE_OPEN_ORDERS_INVALID"),
    maxPositionCount: positiveInteger(limits.maxPositionCount, "ENVELOPE_POSITION_COUNT_INVALID"),
    maxSessionOrders: positiveInteger(limits.maxSessionOrders, "ENVELOPE_SESSION_ORDERS_INVALID"),
    sessionDurationSeconds: positiveInteger(limits.sessionDurationSeconds, "ENVELOPE_SESSION_DURATION_INVALID")
  });
}

export function evaluateTinyBoundedLiveEnvelope(input: TinyBoundedEnvelopeInput): TinyBoundedEnvelopeResult {
  const envelopeId = required(input.envelopeId, "ENVELOPE_ID_REQUIRED");
  const codeRevision = exactHash(input.codeRevision, 40, "ENVELOPE_CODE_REVISION_INVALID");
  const configurationHash = exactHash(input.configurationHash, 64, "ENVELOPE_CONFIGURATION_HASH_INVALID");
  const releaseSealFingerprint = exactHash(input.releaseSealFingerprint, 64, "ENVELOPE_RELEASE_SEAL_INVALID");
  const preflightFingerprint = exactHash(input.preflightFingerprint, 64, "ENVELOPE_PREFLIGHT_INVALID");
  const ceremonyRecordFingerprint = exactHash(input.ceremonyRecordFingerprint, 64, "ENVELOPE_CEREMONY_RECORD_INVALID");
  const capabilityContract = required(input.capabilityContract, "ENVELOPE_CAPABILITY_CONTRACT_REQUIRED");
  const strategyIdentity = required(input.strategyIdentity, "ENVELOPE_STRATEGY_IDENTITY_REQUIRED");
  const rollbackBundleId = required(input.rollbackBundleId, "ENVELOPE_ROLLBACK_BUNDLE_REQUIRED");
  const limits = normalizeLimits(input.limits);
  const symbols = [...new Set(input.symbolAllowlist.map((symbol) => required(symbol, "ENVELOPE_SYMBOL_INVALID")))].sort();
  const blockers: string[] = [];
  const unknowns: string[] = [];

  if (symbols.length !== input.symbolAllowlist.length) blockers.push("SYMBOL_ALLOWLIST_DUPLICATE");
  if (symbols.length !== 1) blockers.push("EXACTLY_ONE_SYMBOL_REQUIRED");

  for (const key of Object.keys(TINY_BOUNDED_LIVE_HARD_CEILINGS) as (keyof TinyBoundedLimits)[]) {
    if (limits[key] > TINY_BOUNDED_LIVE_HARD_CEILINGS[key]) blockers.push(`HARD_CEILING_EXCEEDED:${key}`);
  }

  if (!input.singleSession) blockers.push("SINGLE_SESSION_REQUIRED");
  if (input.automaticRenewalAllowed) blockers.push("AUTOMATIC_RENEWAL_PROHIBITED");
  if (input.automaticScaleUpAllowed) blockers.push("AUTOMATIC_SCALE_UP_PROHIBITED");
  if (input.executionTransportConnected) blockers.push("EXECUTION_TRANSPORT_CONNECTED");
  if (input.executionCredentialUseEnabled) blockers.push("EXECUTION_CREDENTIAL_USE_ENABLED");
  if (input.realMoneyExecutionAllowed) blockers.push("REAL_MONEY_EXECUTION_ALREADY_ALLOWED");

  const binaryChecks: ReadonlyArray<readonly [string, BinaryEvidence]> = [
    ["KILL_SWITCH_READINESS", input.safety.killSwitchReadiness],
    ["HALT_PATH_READINESS", input.safety.haltPathReadiness],
    ["ROLLBACK_READINESS", input.safety.rollbackReadiness],
    ["HARD_RISK", input.safety.hardRisk],
    ["POST_TRADE_OBSERVATION", input.safety.postTradeObservation]
  ];
  for (const [name, value] of binaryChecks) {
    if (value === "FAIL") blockers.push(`${name}_FAILED`);
    if (value === "UNKNOWN") unknowns.push(`${name}_UNKNOWN`);
  }
  if (input.safety.reconciliation === "DIFF") blockers.push("RECONCILIATION_DIFF");
  if (input.safety.reconciliation === "UNKNOWN") unknowns.push("RECONCILIATION_UNKNOWN");
  if (input.safety.marketData === "UNHEALTHY") blockers.push("MARKET_DATA_UNHEALTHY");
  if (input.safety.marketData === "UNKNOWN") unknowns.push("MARKET_DATA_UNKNOWN");

  const normalizedBlockers = Object.freeze([...new Set(blockers)].sort());
  const normalizedUnknowns = Object.freeze([...new Set(unknowns)].sort());
  const verdict: TinyBoundedEnvelopeVerdict = normalizedBlockers.length > 0
    ? "SAFE_BLOCK"
    : normalizedUnknowns.length > 0
      ? "UNKNOWN"
      : "BOUNDED_ENVELOPE_VALID";

  const envelopeFingerprint = sha256(canonical({
    envelopeId,
    codeRevision,
    configurationHash,
    releaseSealFingerprint,
    preflightFingerprint,
    ceremonyRecordFingerprint,
    capabilityContract,
    strategyIdentity,
    rollbackBundleId,
    symbols,
    limits,
    safety: input.safety,
    singleSession: input.singleSession,
    automaticRenewalAllowed: input.automaticRenewalAllowed,
    automaticScaleUpAllowed: input.automaticScaleUpAllowed,
    executionTransportConnected: input.executionTransportConnected,
    executionCredentialUseEnabled: input.executionCredentialUseEnabled,
    realMoneyExecutionAllowed: input.realMoneyExecutionAllowed,
    verdict,
    blockers: normalizedBlockers,
    unknowns: normalizedUnknowns,
    orderAuthorization: false,
    activationAuthority: false,
    executionAuthority: false,
    authorizesLive: false,
    mutationPerformed: false
  }));

  return Object.freeze({
    verdict,
    blockers: normalizedBlockers,
    unknowns: normalizedUnknowns,
    envelopeFingerprint,
    normalizedSymbols: Object.freeze(symbols),
    hardCeilings: TINY_BOUNDED_LIVE_HARD_CEILINGS,
    orderAuthorization: false,
    activationAuthority: false,
    executionAuthority: false,
    authorizesLive: false,
    mutationPerformed: false,
    realMoneyExecutionAllowed: false
  });
}
