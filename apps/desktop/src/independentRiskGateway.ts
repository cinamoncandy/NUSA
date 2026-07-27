import { createHash } from "node:crypto";
import type {
  DeploymentReasonCode,
  DeploymentSafetyDecision,
  DeploymentSafetyDescriptor,
  PreTradeRiskDecision,
  PreTradeRiskRequest,
  RiskReasonCode
} from "../../../packages/contracts/src/riskGateway";

/**
 * Independent Paper risk gateway (WO-0032).
 *
 * A pure decision function. It never mutates the request, the account, or any execution
 * state, never places an order, and never grants authority: `productionMutationAllowed`
 * is `false` on every decision it can produce.
 *
 * Two properties are load-bearing:
 *
 *   1. EVERY DECLARED REASON CODE IS ENFORCED. A gateway that declares a limit it never
 *      checks reads as coverage that does not exist, which is worse than not declaring
 *      the limit. `tests/independent-risk-gateway-coverage.test.js` proves each code in
 *      `RISK_REASON_ORDER` is reachable by some request.
 *   2. FAIL CLOSED. Missing, malformed, or non-finite state is `INVALID_REQUEST` and
 *      halts, rather than silently skipping the checks that would have read it. A check
 *      skipped for want of input is indistinguishable from a check that passed.
 */

/**
 * Evaluation order, and simultaneously the severity order. Codes at or before
 * `OPEN_P0_ALERT` are safety-critical: any one of them HALTs rather than merely rejecting,
 * because they mean the operating envelope itself is broken, not that this particular
 * order was too large.
 */
export const RISK_REASON_ORDER: readonly RiskReasonCode[] = Object.freeze([
  "INVALID_REQUEST",
  "LIVE_CAPABILITY_DETECTED",
  "PRIVATE_API_CAPABILITY_DETECTED",
  "DEPLOYMENT_INTEGRITY_FAILED",
  "KILL_SWITCH_ACTIVE",
  "STRATEGY_FINGERPRINT_MISMATCH",
  "CONFIG_FINGERPRINT_MISMATCH",
  "RUNTIME_FINGERPRINT_MISMATCH",
  "RISK_POLICY_FINGERPRINT_MISMATCH",
  "APPROVAL_MISSING",
  "APPROVAL_EXPIRED",
  "APPROVAL_SCOPE_MISMATCH",
  "PERSISTENCE_UNHEALTHY",
  "RECONCILIATION_FAILED",
  "OPEN_P0_ALERT",
  "MARKET_DATA_STALE",
  "MARKET_DATA_RECONNECTING",
  "MARKET_DATA_WARMING_UP",
  "MARKET_DATA_GAP",
  "MARKET_DATA_OUT_OF_ORDER",
  "MARKET_DATA_INVALID",
  "PRICE_DEVIATION_LIMIT",
  "DUPLICATE_SIGNAL",
  "DUPLICATE_COMMAND",
  "DUPLICATE_CLIENT_ORDER_ID",
  "ORDER_RATE_LIMIT_PER_SECOND",
  "ORDER_RATE_LIMIT_PER_MINUTE",
  "SAME_SIDE_BURST_LIMIT",
  "OPEN_ORDER_LIMIT",
  "MAX_ORDER_NOTIONAL",
  "MAX_POSITION_NOTIONAL",
  "MAX_SYMBOL_EXPOSURE",
  "MAX_PORTFOLIO_EXPOSURE",
  "MAX_DAILY_BUY_NOTIONAL",
  "MAX_DAILY_SELL_NOTIONAL",
  "INSUFFICIENT_CASH",
  "INSUFFICIENT_POSITION",
  "DAILY_LOSS_LIMIT",
  "CONSECUTIVE_LOSS_LIMIT",
  "SESSION_DRAWDOWN_LIMIT"
]);

/** The last code that HALTs. Everything after it is an ordinary REJECT. */
const LAST_HALTING_CODE: RiskReasonCode = "OPEN_P0_ALERT";

export const DEPLOYMENT_REASON_ORDER: readonly DeploymentReasonCode[] = Object.freeze([
  "INVALID_DESCRIPTOR",
  "LIVE_TRADING_CAPABILITY_PRESENT",
  "PRIVATE_API_CAPABILITY_PRESENT",
  "CREDENTIAL_STORAGE_PRESENT",
  "RISK_GATEWAY_ABSENT",
  "KILL_SWITCH_UNREACHABLE",
  "AUTO_TRADE_DEFAULT_ON",
  "ARTIFACT_HASH_MISMATCH",
  "SOURCE_COMMIT_MISMATCH",
  "PERSISTENCE_SCHEMA_MISMATCH"
]);

const MARKET_DATA_REASONS = Object.freeze({
  STALE: "MARKET_DATA_STALE",
  RECONNECTING: "MARKET_DATA_RECONNECTING",
  WARMING_UP: "MARKET_DATA_WARMING_UP",
  GAP_DETECTED: "MARKET_DATA_GAP",
  OUT_OF_ORDER: "MARKET_DATA_OUT_OF_ORDER",
  INVALID: "MARKET_DATA_INVALID"
} as const);

const hash = (value: unknown): string => createHash("sha256").update(JSON.stringify(value), "utf8").digest("hex");

export interface IndependentRiskLimits {
  readonly maxOrderNotional: number;
  readonly maxPositionNotional: number;
  readonly maxOpenOrders: number;
  readonly maxOrdersPerSecond: number;
  readonly maxOrdersPerMinute: number;
  readonly maxSameSideStreak: number;
  readonly maxSymbolExposureNotional: number;
  readonly maxPortfolioExposureNotional: number;
  readonly maxDailyBuyNotional: number;
  readonly maxDailySellNotional: number;
  /** Maximum daily realized loss, expressed as a positive number. */
  readonly maxDailyLoss: number;
  readonly maxConsecutiveLosses: number;
  /** Maximum session drawdown from peak equity, as a ratio in [0, 1]. */
  readonly maxSessionDrawdownRatio: number;
  /** Maximum |referencePrice - marketPrice| / marketPrice, as a ratio in [0, 1]. */
  readonly maxPriceDeviationRatio: number;
}

export interface RiskIdentityState {
  readonly strategyFingerprint: string;
  readonly configFingerprint: string;
  readonly runtimeFingerprint: string;
  readonly riskPolicyFingerprint: string;
  readonly seenSignalIds: ReadonlySet<string>;
  readonly seenCommandIds: ReadonlySet<string>;
  readonly seenClientOrderIds: ReadonlySet<string>;
}

const isFinite_ = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
const isNonNegativeFinite = (value: unknown): value is number => isFinite_(value) && value >= 0;

function isStructurallyValid(request: PreTradeRiskRequest, identity: RiskIdentityState, limits: IndependentRiskLimits): boolean {
  if (request == null || typeof request !== "object" || request.schemaVersion !== 1) return false;
  const strings = [request.requestId, request.signalId, request.commandId, request.clientOrderId, request.symbol,
    request.strategyFingerprint, request.configFingerprint, request.runtimeFingerprint, request.riskPolicyFingerprint];
  if (!strings.every((value) => typeof value === "string" && value.length > 0)) return false;
  if (request.side !== "BUY" && request.side !== "SELL") return false;
  if (![request.quantity, request.referencePrice, request.requestedAt].every(isFinite_)) return false;
  if (request.quantity <= 0 || request.referencePrice <= 0) return false;

  const { marketDataState, accountState, controlState, approvalState, persistenceState,
    reconciliationState, deploymentState, rateState, exposureState, sessionState } = request;
  const blocks = [marketDataState, accountState, controlState, approvalState, persistenceState,
    reconciliationState, deploymentState, rateState, exposureState, sessionState];
  if (blocks.some((block) => block == null || typeof block !== "object")) return false;

  if (marketDataState.status !== "HEALTHY" && !Object.prototype.hasOwnProperty.call(MARKET_DATA_REASONS, marketDataState.status)) return false;
  if (marketDataState.price !== null && !(isFinite_(marketDataState.price) && marketDataState.price > 0)) return false;
  if (![accountState.cash, accountState.positionQuantity, accountState.openOrderCount].every(isNonNegativeFinite)) return false;
  if ([controlState.killSwitchActive, controlState.liveCapabilityDetected, controlState.privateApiCapabilityDetected,
    approvalState.approved, persistenceState.healthy, reconciliationState.healthy, reconciliationState.openP0,
    deploymentState.integrityVerified].some((value) => typeof value !== "boolean")) return false;
  if (!Array.isArray(approvalState.symbols) || !isFinite_(approvalState.expiresAt)) return false;
  if (![rateState.ordersInLastSecond, rateState.ordersInLastMinute, rateState.sameSideStreak].every(isNonNegativeFinite)) return false;
  if (![exposureState.symbolExposureNotional, exposureState.portfolioExposureNotional,
    exposureState.dailyBuyNotional, exposureState.dailySellNotional].every(isNonNegativeFinite)) return false;
  if (![sessionState.dailyRealizedPnL, sessionState.consecutiveLossCount,
    sessionState.sessionPeakEquity, sessionState.sessionEquity].every(isFinite_)) return false;

  if (identity == null || typeof identity !== "object") return false;
  if (![identity.seenSignalIds, identity.seenCommandIds, identity.seenClientOrderIds].every((set) => set instanceof Set)) return false;

  if (limits == null || typeof limits !== "object") return false;
  return [limits.maxOrderNotional, limits.maxPositionNotional, limits.maxOpenOrders, limits.maxOrdersPerSecond,
    limits.maxOrdersPerMinute, limits.maxSameSideStreak, limits.maxSymbolExposureNotional, limits.maxPortfolioExposureNotional,
    limits.maxDailyBuyNotional, limits.maxDailySellNotional, limits.maxDailyLoss, limits.maxConsecutiveLosses,
    limits.maxSessionDrawdownRatio, limits.maxPriceDeviationRatio].every(isNonNegativeFinite);
}

/** Evaluates an immutable Paper request without changing it, account state, or execution state. */
export function evaluatePreTradeRisk(
  request: PreTradeRiskRequest,
  identity: RiskIdentityState,
  limits: IndependentRiskLimits
): PreTradeRiskDecision {
  const evaluatedAt = isFinite_(request?.requestedAt) ? request.requestedAt : 0;

  if (!isStructurallyValid(request, identity, limits)) {
    // Nothing downstream can be trusted to read, so this is the whole decision. It halts
    // rather than rejects: an unparseable request means the caller is broken.
    return sealDecision(["INVALID_REQUEST"], evaluatedAt, request);
  }

  const reasons = new Set<RiskReasonCode>();

  // Safety envelope. Any of these means the operating conditions themselves are wrong.
  if (request.controlState.liveCapabilityDetected) reasons.add("LIVE_CAPABILITY_DETECTED");
  if (request.controlState.privateApiCapabilityDetected) reasons.add("PRIVATE_API_CAPABILITY_DETECTED");
  if (!request.deploymentState.integrityVerified) reasons.add("DEPLOYMENT_INTEGRITY_FAILED");
  if (request.controlState.killSwitchActive) reasons.add("KILL_SWITCH_ACTIVE");

  // Identity: the order must have come from the strategy, config, runtime, and risk policy
  // this gateway was told to guard -- not from a build that changed underneath it.
  if (request.strategyFingerprint !== identity.strategyFingerprint) reasons.add("STRATEGY_FINGERPRINT_MISMATCH");
  if (request.configFingerprint !== identity.configFingerprint) reasons.add("CONFIG_FINGERPRINT_MISMATCH");
  if (request.runtimeFingerprint !== identity.runtimeFingerprint) reasons.add("RUNTIME_FINGERPRINT_MISMATCH");
  if (request.riskPolicyFingerprint !== identity.riskPolicyFingerprint) reasons.add("RISK_POLICY_FINGERPRINT_MISMATCH");

  if (!request.approvalState.approved) reasons.add("APPROVAL_MISSING");
  if (request.approvalState.expiresAt < request.requestedAt) reasons.add("APPROVAL_EXPIRED");
  if (!request.approvalState.symbols.includes(request.symbol)) reasons.add("APPROVAL_SCOPE_MISMATCH");

  if (!request.persistenceState.healthy) reasons.add("PERSISTENCE_UNHEALTHY");
  if (!request.reconciliationState.healthy) reasons.add("RECONCILIATION_FAILED");
  if (request.reconciliationState.openP0) reasons.add("OPEN_P0_ALERT");

  const marketStatus = request.marketDataState.status;
  if (marketStatus !== "HEALTHY") reasons.add(MARKET_DATA_REASONS[marketStatus]);

  // A reference price far from the observed market price means the caller is pricing off
  // something stale or wrong, even when the feed reports itself healthy.
  const marketPrice = request.marketDataState.price;
  if (marketPrice != null && Math.abs(request.referencePrice - marketPrice) / marketPrice > limits.maxPriceDeviationRatio) {
    reasons.add("PRICE_DEVIATION_LIMIT");
  }

  if (identity.seenSignalIds.has(request.signalId)) reasons.add("DUPLICATE_SIGNAL");
  if (identity.seenCommandIds.has(request.commandId)) reasons.add("DUPLICATE_COMMAND");
  if (identity.seenClientOrderIds.has(request.clientOrderId)) reasons.add("DUPLICATE_CLIENT_ORDER_ID");

  if (request.rateState.ordersInLastSecond >= limits.maxOrdersPerSecond) reasons.add("ORDER_RATE_LIMIT_PER_SECOND");
  if (request.rateState.ordersInLastMinute >= limits.maxOrdersPerMinute) reasons.add("ORDER_RATE_LIMIT_PER_MINUTE");
  if (request.rateState.sameSideStreak >= limits.maxSameSideStreak) reasons.add("SAME_SIDE_BURST_LIMIT");
  if (request.accountState.openOrderCount >= limits.maxOpenOrders) reasons.add("OPEN_ORDER_LIMIT");

  const notional = request.quantity * request.referencePrice;
  const buying = request.side === "BUY";
  const added = buying ? notional : 0;
  if (notional > limits.maxOrderNotional) reasons.add("MAX_ORDER_NOTIONAL");
  if (request.accountState.positionQuantity * request.referencePrice + added > limits.maxPositionNotional) reasons.add("MAX_POSITION_NOTIONAL");
  if (request.exposureState.symbolExposureNotional + added > limits.maxSymbolExposureNotional) reasons.add("MAX_SYMBOL_EXPOSURE");
  if (request.exposureState.portfolioExposureNotional + added > limits.maxPortfolioExposureNotional) reasons.add("MAX_PORTFOLIO_EXPOSURE");
  if (buying && request.exposureState.dailyBuyNotional + notional > limits.maxDailyBuyNotional) reasons.add("MAX_DAILY_BUY_NOTIONAL");
  if (!buying && request.exposureState.dailySellNotional + notional > limits.maxDailySellNotional) reasons.add("MAX_DAILY_SELL_NOTIONAL");

  if (buying && notional > request.accountState.cash) reasons.add("INSUFFICIENT_CASH");
  if (!buying && request.quantity > request.accountState.positionQuantity) reasons.add("INSUFFICIENT_POSITION");

  // Circuit breakers on session outcome. These stop a losing session from continuing to
  // trade; they are limits on the operator, not on any single order.
  if (request.sessionState.dailyRealizedPnL < 0 && Math.abs(request.sessionState.dailyRealizedPnL) >= limits.maxDailyLoss) reasons.add("DAILY_LOSS_LIMIT");
  if (request.sessionState.consecutiveLossCount >= limits.maxConsecutiveLosses) reasons.add("CONSECUTIVE_LOSS_LIMIT");
  if (request.sessionState.sessionPeakEquity > 0) {
    const drawdown = (request.sessionState.sessionPeakEquity - request.sessionState.sessionEquity) / request.sessionState.sessionPeakEquity;
    if (drawdown >= limits.maxSessionDrawdownRatio) reasons.add("SESSION_DRAWDOWN_LIMIT");
  }

  return sealDecision(RISK_REASON_ORDER.filter((code) => reasons.has(code)), evaluatedAt, request);
}

function sealDecision(ordered: readonly RiskReasonCode[], evaluatedAt: number, request: PreTradeRiskRequest): PreTradeRiskDecision {
  const haltBoundary = RISK_REASON_ORDER.indexOf(LAST_HALTING_CODE);
  const halt = ordered.some((code) => RISK_REASON_ORDER.indexOf(code) <= haltBoundary);
  const status = ordered.length === 0 ? "ALLOW" : halt ? "HALT" : "REJECT";
  const requestSha256 = hash(request);
  return Object.freeze({
    status,
    reasonCodes: Object.freeze([...ordered]),
    evaluatedAt,
    requestSha256,
    decisionSha256: hash({ status, reasonCodes: ordered, requestSha256 }),
    productionMutationAllowed: false
  });
}

/**
 * Deployment safety gate. Answers one question before any Paper automation is allowed to
 * start: is the thing about to run the thing that was reviewed, and is it still incapable
 * of trading for real? Every reason code here HALTs -- there is no "degraded but allowed"
 * deployment.
 */
export function evaluateDeploymentSafety(descriptor: DeploymentSafetyDescriptor): DeploymentSafetyDecision {
  const reasons = new Set<DeploymentReasonCode>();

  const structurallyValid =
    descriptor != null && typeof descriptor === "object" && descriptor.schemaVersion === 1 &&
    [descriptor.deploymentId, descriptor.sourceCommitSha, descriptor.expectedSourceCommitSha,
      descriptor.artifactSha256, descriptor.expectedArtifactSha256].every((value) => typeof value === "string" && value.length > 0) &&
    [descriptor.persistenceSchemaVersion, descriptor.expectedPersistenceSchemaVersion].every((value) => Number.isInteger(value)) &&
    [descriptor.liveTradingCapabilityPresent, descriptor.privateApiCapabilityPresent, descriptor.credentialStoragePresent,
      descriptor.killSwitchReachable, descriptor.autoTradeDefaultEnabled, descriptor.riskGatewayPresent].every((value) => typeof value === "boolean");

  if (!structurallyValid) {
    reasons.add("INVALID_DESCRIPTOR");
  } else {
    if (descriptor.liveTradingCapabilityPresent) reasons.add("LIVE_TRADING_CAPABILITY_PRESENT");
    if (descriptor.privateApiCapabilityPresent) reasons.add("PRIVATE_API_CAPABILITY_PRESENT");
    if (descriptor.credentialStoragePresent) reasons.add("CREDENTIAL_STORAGE_PRESENT");
    if (!descriptor.riskGatewayPresent) reasons.add("RISK_GATEWAY_ABSENT");
    if (!descriptor.killSwitchReachable) reasons.add("KILL_SWITCH_UNREACHABLE");
    // Automatic trading defaulting to ON after an install or upgrade is a deployment
    // defect, not a preference: nobody chose it for this deployment.
    if (descriptor.autoTradeDefaultEnabled) reasons.add("AUTO_TRADE_DEFAULT_ON");
    if (descriptor.artifactSha256 !== descriptor.expectedArtifactSha256) reasons.add("ARTIFACT_HASH_MISMATCH");
    if (descriptor.sourceCommitSha !== descriptor.expectedSourceCommitSha) reasons.add("SOURCE_COMMIT_MISMATCH");
    if (descriptor.persistenceSchemaVersion !== descriptor.expectedPersistenceSchemaVersion) reasons.add("PERSISTENCE_SCHEMA_MISMATCH");
  }

  const ordered = DEPLOYMENT_REASON_ORDER.filter((code) => reasons.has(code));
  const status = ordered.length === 0 ? "ALLOW" : "HALT";
  const descriptorSha256 = hash(descriptor);
  return Object.freeze({
    status,
    reasonCodes: Object.freeze(ordered),
    descriptorSha256,
    decisionSha256: hash({ status, reasonCodes: ordered, descriptorSha256 }),
    productionMutationAllowed: false
  });
}
