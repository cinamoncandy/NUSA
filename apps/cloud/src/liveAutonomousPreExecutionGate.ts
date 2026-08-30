import { createHash } from "node:crypto";

export type LiveAutonomousSide = "BUY" | "SELL";
export type LiveAutonomousRuntimeHealth = "HEALTHY" | "DEGRADED" | "DOWN";
export type LiveAutonomousRiskDecision = "ALLOW" | "REJECT";

export type LiveAutonomousExecutionBlocker =
  | "INVALID_INPUT"
  | "OWNER_PRINCIPAL_MISMATCH"
  | "OWNER_CAPITAL_DISABLED"
  | "RUNTIME_INACTIVE"
  | "KILL_SWITCH_ACTIVE"
  | "TRADING_NOT_ALLOWED"
  | "RUNTIME_UNHEALTHY"
  | "MARKET_INPUT_UNTRUSTED"
  | "MARKET_INPUT_STALE"
  | "DECISION_STALE"
  | "RISK_REJECTED"
  | "NOTIONAL_EXCEEDS_OWNER_CEILING"
  | "NOTIONAL_EXCEEDS_RISK_LIMIT";

export interface LiveAutonomousPreExecutionRequest {
  readonly ownerPrincipalId: string;
  readonly policyOwnerPrincipalId: string;
  readonly market: string;
  readonly side: LiveAutonomousSide;
  readonly requestedNotionalUsd: number;
  readonly totalEquityUsd: number;
  readonly investmentCapitalWeight: number;
  readonly riskApprovedNotionalUsd: number;
  readonly riskDecision: LiveAutonomousRiskDecision;
  readonly runtimeActive: boolean;
  readonly killSwitchActive: boolean;
  readonly tradingAllowed: boolean;
  readonly overallHealth: LiveAutonomousRuntimeHealth;
  readonly marketTrusted: boolean;
  readonly observedAt: number;
  readonly decidedAt: number;
  readonly now: number;
  readonly maxInputAgeMs?: number;
  readonly ttlMs?: number;
}

export interface LiveAutonomousPreExecutionEnvelope {
  readonly schemaVersion: 1;
  readonly status: "READY" | "REJECTED";
  /** Readiness is not broker authority. A later transport layer must separately authorize mutation. */
  readonly liveAuthority: "NONE";
  readonly productionMutationAllowed: false;
  readonly ownerPrincipalId: string;
  readonly market: string;
  readonly side: LiveAutonomousSide;
  readonly requestedNotionalUsd: number;
  readonly ownerCapitalCeilingUsd: number;
  readonly riskApprovedNotionalUsd: number;
  readonly maxAuthorizedNotionalUsd: number;
  readonly issuedAt: number;
  readonly expiresAt: number;
  readonly authorizationFingerprintSha256: string;
  readonly blockers: readonly LiveAutonomousExecutionBlocker[];
}

const DEFAULT_MAX_INPUT_AGE_MS = 30_000;
const DEFAULT_TTL_MS = 15_000;
const MAX_TTL_MS = 60_000;
const round = (value: number): number => Math.round(value * 1_000_000) / 1_000_000;

function canonicalNumber(value: number): string {
  return round(value).toFixed(6);
}

function isSafeTime(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}

function buildFingerprint(input: {
  ownerPrincipalId: string;
  market: string;
  side: LiveAutonomousSide;
  requestedNotionalUsd: number;
  maxAuthorizedNotionalUsd: number;
  issuedAt: number;
  expiresAt: number;
}): string {
  const canonical = [
    "live-autonomous-preexecution:v1",
    input.ownerPrincipalId,
    input.market,
    input.side,
    canonicalNumber(input.requestedNotionalUsd),
    canonicalNumber(input.maxAuthorizedNotionalUsd),
    String(input.issuedAt),
    String(input.expiresAt),
  ].join("\n");
  return createHash("sha256").update(canonical, "utf8").digest("hex");
}

/**
 * Produces a short-lived, deterministic readiness envelope for a future LIVE transport layer.
 * It can only reject or bound an already risk-approved request. It deliberately grants no
 * production mutation authority and performs no broker/network operation.
 */
export function evaluateLiveAutonomousPreExecution(
  request: LiveAutonomousPreExecutionRequest,
): LiveAutonomousPreExecutionEnvelope {
  const blockers: LiveAutonomousExecutionBlocker[] = [];
  const ownerPrincipalId = request.ownerPrincipalId.trim();
  const policyOwnerPrincipalId = request.policyOwnerPrincipalId.trim();
  const market = request.market.trim().toUpperCase();
  const maxInputAgeMs = request.maxInputAgeMs ?? DEFAULT_MAX_INPUT_AGE_MS;
  const ttlMs = request.ttlMs ?? DEFAULT_TTL_MS;

  const structurallyValid = ownerPrincipalId.length > 0
    && policyOwnerPrincipalId.length > 0
    && market.length > 0
    && (request.side === "BUY" || request.side === "SELL")
    && Number.isFinite(request.requestedNotionalUsd) && request.requestedNotionalUsd > 0
    && Number.isFinite(request.totalEquityUsd) && request.totalEquityUsd > 0
    && Number.isFinite(request.investmentCapitalWeight)
    && request.investmentCapitalWeight >= 0 && request.investmentCapitalWeight <= 1
    && Number.isFinite(request.riskApprovedNotionalUsd) && request.riskApprovedNotionalUsd >= 0
    && (request.riskDecision === "ALLOW" || request.riskDecision === "REJECT")
    && isSafeTime(request.observedAt)
    && isSafeTime(request.decidedAt)
    && isSafeTime(request.now)
    && Number.isSafeInteger(maxInputAgeMs) && maxInputAgeMs >= 1_000
    && Number.isSafeInteger(ttlMs) && ttlMs >= 1_000 && ttlMs <= MAX_TTL_MS;

  if (!structurallyValid) blockers.push("INVALID_INPUT");

  if (ownerPrincipalId !== policyOwnerPrincipalId) blockers.push("OWNER_PRINCIPAL_MISMATCH");
  if (request.investmentCapitalWeight === 0) blockers.push("OWNER_CAPITAL_DISABLED");
  if (!request.runtimeActive) blockers.push("RUNTIME_INACTIVE");
  if (request.killSwitchActive) blockers.push("KILL_SWITCH_ACTIVE");
  if (!request.tradingAllowed) blockers.push("TRADING_NOT_ALLOWED");
  if (request.overallHealth !== "HEALTHY") blockers.push("RUNTIME_UNHEALTHY");
  if (!request.marketTrusted) blockers.push("MARKET_INPUT_UNTRUSTED");

  if (isSafeTime(request.observedAt) && isSafeTime(request.now)
      && (request.observedAt > request.now || request.now - request.observedAt >= maxInputAgeMs)) {
    blockers.push("MARKET_INPUT_STALE");
  }
  if (isSafeTime(request.decidedAt) && isSafeTime(request.now)
      && (request.decidedAt > request.now || request.now - request.decidedAt >= maxInputAgeMs)) {
    blockers.push("DECISION_STALE");
  }
  if (request.riskDecision !== "ALLOW") blockers.push("RISK_REJECTED");

  const ownerCapitalCeilingUsd = structurallyValid
    ? round(request.totalEquityUsd * request.investmentCapitalWeight)
    : 0;
  const riskApprovedNotionalUsd = structurallyValid ? round(request.riskApprovedNotionalUsd) : 0;
  const maxAuthorizedNotionalUsd = round(Math.max(0, Math.min(ownerCapitalCeilingUsd, riskApprovedNotionalUsd)));

  if (structurallyValid && request.requestedNotionalUsd > ownerCapitalCeilingUsd) {
    blockers.push("NOTIONAL_EXCEEDS_OWNER_CEILING");
  }
  if (structurallyValid && request.requestedNotionalUsd > riskApprovedNotionalUsd) {
    blockers.push("NOTIONAL_EXCEEDS_RISK_LIMIT");
  }

  const issuedAt = isSafeTime(request.now) ? request.now : 0;
  const expiresAt = structurallyValid ? issuedAt + ttlMs : issuedAt;
  const fingerprint = buildFingerprint({
    ownerPrincipalId,
    market,
    side: request.side === "SELL" ? "SELL" : "BUY",
    requestedNotionalUsd: Number.isFinite(request.requestedNotionalUsd) ? request.requestedNotionalUsd : 0,
    maxAuthorizedNotionalUsd,
    issuedAt,
    expiresAt,
  });

  return Object.freeze({
    schemaVersion: 1,
    status: blockers.length === 0 ? "READY" : "REJECTED",
    liveAuthority: "NONE",
    productionMutationAllowed: false,
    ownerPrincipalId,
    market,
    side: request.side === "SELL" ? "SELL" : "BUY",
    requestedNotionalUsd: Number.isFinite(request.requestedNotionalUsd) ? round(request.requestedNotionalUsd) : 0,
    ownerCapitalCeilingUsd,
    riskApprovedNotionalUsd,
    maxAuthorizedNotionalUsd,
    issuedAt,
    expiresAt,
    authorizationFingerprintSha256: fingerprint,
    blockers: Object.freeze([...new Set(blockers)]),
  });
}
