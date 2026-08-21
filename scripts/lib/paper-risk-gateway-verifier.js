"use strict";
/**
 * Independent verification of an independent Paper risk gateway decision (WO-0032).
 *
 * Deliberately does NOT import `apps/desktop/src/risk/independentRiskGateway.ts` or its compiled
 * output. It re-implements the rules from the contract and compares. A verifier that asked
 * the evaluator for the answer would confirm a buggy evaluator rather than catch it -- the
 * same principle applied in WO-0029's regime verifier and WO-0031's promotion gate.
 *
 * If the evaluator and this file ever disagree, that disagreement is the finding. Neither
 * side is authoritative on its own.
 */
const { createHash } = require("node:crypto");

const sha256 = (value) => createHash("sha256").update(JSON.stringify(value), "utf8").digest("hex");

/** Severity/report order. Codes up to and including OPEN_P0_ALERT halt. */
const REASON_ORDER = Object.freeze([
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

const HALT_BOUNDARY = REASON_ORDER.indexOf("OPEN_P0_ALERT");

const MARKET_REASON = Object.freeze({
  STALE: "MARKET_DATA_STALE",
  RECONNECTING: "MARKET_DATA_RECONNECTING",
  WARMING_UP: "MARKET_DATA_WARMING_UP",
  GAP_DETECTED: "MARKET_DATA_GAP",
  OUT_OF_ORDER: "MARKET_DATA_OUT_OF_ORDER",
  INVALID: "MARKET_DATA_INVALID"
});

const finite = (value) => typeof value === "number" && Number.isFinite(value);
const nonNegative = (value) => finite(value) && value >= 0;
const has = (set, key) => set instanceof Set ? set.has(key) : Array.isArray(set) && set.includes(key);

function structurallyValid(request, identity, limits) {
  if (request == null || typeof request !== "object" || request.schemaVersion !== 1) return false;
  const strings = ["requestId", "signalId", "commandId", "clientOrderId", "symbol",
    "strategyFingerprint", "configFingerprint", "runtimeFingerprint", "riskPolicyFingerprint"];
  if (!strings.every((key) => typeof request[key] === "string" && request[key].length > 0)) return false;
  if (request.side !== "BUY" && request.side !== "SELL") return false;
  if (!["quantity", "referencePrice", "requestedAt"].every((key) => finite(request[key]))) return false;
  if (request.quantity <= 0 || request.referencePrice <= 0) return false;

  const blockNames = ["marketDataState", "accountState", "controlState", "approvalState", "persistenceState",
    "reconciliationState", "deploymentState", "rateState", "exposureState", "sessionState"];
  if (blockNames.some((name) => request[name] == null || typeof request[name] !== "object")) return false;

  const md = request.marketDataState;
  if (md.status !== "HEALTHY" && !Object.prototype.hasOwnProperty.call(MARKET_REASON, md.status)) return false;
  if (md.price !== null && !(finite(md.price) && md.price > 0)) return false;
  if (!["cash", "positionQuantity", "openOrderCount"].every((key) => nonNegative(request.accountState[key]))) return false;
  const booleans = [request.controlState.killSwitchActive, request.controlState.liveCapabilityDetected,
    request.controlState.privateApiCapabilityDetected, request.approvalState.approved,
    request.persistenceState.healthy, request.reconciliationState.healthy, request.reconciliationState.openP0,
    request.deploymentState.integrityVerified];
  if (booleans.some((value) => typeof value !== "boolean")) return false;
  if (!Array.isArray(request.approvalState.symbols) || !finite(request.approvalState.expiresAt)) return false;
  if (!["ordersInLastSecond", "ordersInLastMinute", "sameSideStreak"].every((key) => nonNegative(request.rateState[key]))) return false;
  if (!["symbolExposureNotional", "portfolioExposureNotional", "dailyBuyNotional", "dailySellNotional"].every((key) => nonNegative(request.exposureState[key]))) return false;
  if (!["dailyRealizedPnL", "consecutiveLossCount", "sessionPeakEquity", "sessionEquity"].every((key) => finite(request.sessionState[key]))) return false;

  if (identity == null || typeof identity !== "object") return false;
  if (!["seenSignalIds", "seenCommandIds", "seenClientOrderIds"].every((key) => identity[key] instanceof Set)) return false;

  if (limits == null || typeof limits !== "object") return false;
  return ["maxOrderNotional", "maxPositionNotional", "maxOpenOrders", "maxOrdersPerSecond", "maxOrdersPerMinute",
    "maxSameSideStreak", "maxSymbolExposureNotional", "maxPortfolioExposureNotional", "maxDailyBuyNotional",
    "maxDailySellNotional", "maxDailyLoss", "maxConsecutiveLosses", "maxSessionDrawdownRatio",
    "maxPriceDeviationRatio"].every((key) => nonNegative(limits[key]));
}

/** Re-derives the reason codes from the contract rules alone. */
function derivePreTradeReasons(request, identity, limits) {
  if (!structurallyValid(request, identity, limits)) return ["INVALID_REQUEST"];

  const found = new Set();
  const control = request.controlState;
  if (control.liveCapabilityDetected) found.add("LIVE_CAPABILITY_DETECTED");
  if (control.privateApiCapabilityDetected) found.add("PRIVATE_API_CAPABILITY_DETECTED");
  if (!request.deploymentState.integrityVerified) found.add("DEPLOYMENT_INTEGRITY_FAILED");
  if (control.killSwitchActive) found.add("KILL_SWITCH_ACTIVE");

  const pairs = [
    ["strategyFingerprint", "STRATEGY_FINGERPRINT_MISMATCH"],
    ["configFingerprint", "CONFIG_FINGERPRINT_MISMATCH"],
    ["runtimeFingerprint", "RUNTIME_FINGERPRINT_MISMATCH"],
    ["riskPolicyFingerprint", "RISK_POLICY_FINGERPRINT_MISMATCH"]
  ];
  for (const [key, code] of pairs) if (request[key] !== identity[key]) found.add(code);

  const approval = request.approvalState;
  if (!approval.approved) found.add("APPROVAL_MISSING");
  if (approval.expiresAt < request.requestedAt) found.add("APPROVAL_EXPIRED");
  if (!approval.symbols.includes(request.symbol)) found.add("APPROVAL_SCOPE_MISMATCH");

  if (!request.persistenceState.healthy) found.add("PERSISTENCE_UNHEALTHY");
  if (!request.reconciliationState.healthy) found.add("RECONCILIATION_FAILED");
  if (request.reconciliationState.openP0) found.add("OPEN_P0_ALERT");

  if (request.marketDataState.status !== "HEALTHY") found.add(MARKET_REASON[request.marketDataState.status]);
  const price = request.marketDataState.price;
  if (price != null && Math.abs(request.referencePrice - price) / price > limits.maxPriceDeviationRatio) found.add("PRICE_DEVIATION_LIMIT");

  if (has(identity.seenSignalIds, request.signalId)) found.add("DUPLICATE_SIGNAL");
  if (has(identity.seenCommandIds, request.commandId)) found.add("DUPLICATE_COMMAND");
  if (has(identity.seenClientOrderIds, request.clientOrderId)) found.add("DUPLICATE_CLIENT_ORDER_ID");

  const rate = request.rateState;
  if (rate.ordersInLastSecond >= limits.maxOrdersPerSecond) found.add("ORDER_RATE_LIMIT_PER_SECOND");
  if (rate.ordersInLastMinute >= limits.maxOrdersPerMinute) found.add("ORDER_RATE_LIMIT_PER_MINUTE");
  if (rate.sameSideStreak >= limits.maxSameSideStreak) found.add("SAME_SIDE_BURST_LIMIT");
  if (request.accountState.openOrderCount >= limits.maxOpenOrders) found.add("OPEN_ORDER_LIMIT");

  const notional = request.quantity * request.referencePrice;
  const buying = request.side === "BUY";
  const added = buying ? notional : 0;
  const exposure = request.exposureState;
  if (notional > limits.maxOrderNotional) found.add("MAX_ORDER_NOTIONAL");
  if (request.accountState.positionQuantity * request.referencePrice + added > limits.maxPositionNotional) found.add("MAX_POSITION_NOTIONAL");
  if (exposure.symbolExposureNotional + added > limits.maxSymbolExposureNotional) found.add("MAX_SYMBOL_EXPOSURE");
  if (exposure.portfolioExposureNotional + added > limits.maxPortfolioExposureNotional) found.add("MAX_PORTFOLIO_EXPOSURE");
  if (buying && exposure.dailyBuyNotional + notional > limits.maxDailyBuyNotional) found.add("MAX_DAILY_BUY_NOTIONAL");
  if (!buying && exposure.dailySellNotional + notional > limits.maxDailySellNotional) found.add("MAX_DAILY_SELL_NOTIONAL");
  if (buying && notional > request.accountState.cash) found.add("INSUFFICIENT_CASH");
  if (!buying && request.quantity > request.accountState.positionQuantity) found.add("INSUFFICIENT_POSITION");

  const session = request.sessionState;
  if (session.dailyRealizedPnL < 0 && Math.abs(session.dailyRealizedPnL) >= limits.maxDailyLoss) found.add("DAILY_LOSS_LIMIT");
  if (session.consecutiveLossCount >= limits.maxConsecutiveLosses) found.add("CONSECUTIVE_LOSS_LIMIT");
  if (session.sessionPeakEquity > 0 && (session.sessionPeakEquity - session.sessionEquity) / session.sessionPeakEquity >= limits.maxSessionDrawdownRatio) {
    found.add("SESSION_DRAWDOWN_LIMIT");
  }

  return REASON_ORDER.filter((code) => found.has(code));
}

function verifyPreTradeRiskDecision(request, identity, limits, decision) {
  const errors = [];
  if (decision == null || typeof decision !== "object") return { status: "FAIL", errors: ["decision is missing"] };

  // A gateway that can grant authority is not a gateway.
  if (decision.productionMutationAllowed !== false) errors.push("decision must never allow production mutation");

  const expected = derivePreTradeReasons(request, identity, limits);
  const actual = Array.isArray(decision.reasonCodes) ? decision.reasonCodes : null;
  if (actual === null) errors.push("reasonCodes must be an array");
  else {
    for (const code of expected) if (!actual.includes(code)) errors.push(`missing reason code: ${code}`);
    for (const code of actual) {
      if (!REASON_ORDER.includes(code)) errors.push(`unknown reason code: ${code}`);
      else if (!expected.includes(code)) errors.push(`unexpected reason code: ${code}`);
    }
    const ordered = REASON_ORDER.filter((code) => actual.includes(code));
    if (JSON.stringify(ordered) !== JSON.stringify(actual)) errors.push("reasonCodes are not in canonical severity order");
  }

  const halt = expected.some((code) => REASON_ORDER.indexOf(code) <= HALT_BOUNDARY);
  const expectedStatus = expected.length === 0 ? "ALLOW" : halt ? "HALT" : "REJECT";
  if (decision.status !== expectedStatus) errors.push(`status is ${decision.status}, independently derived ${expectedStatus}`);
  // The one rule that must hold no matter what: any finding at all forbids ALLOW.
  if (expected.length > 0 && decision.status === "ALLOW") errors.push("ALLOW issued despite at least one blocking condition");

  const requestSha256 = sha256(request);
  if (decision.requestSha256 !== requestSha256) errors.push("requestSha256 does not match the request as given");
  if (decision.decisionSha256 !== sha256({ status: decision.status, reasonCodes: decision.reasonCodes, requestSha256 })) {
    errors.push("decisionSha256 does not match the decision as recorded");
  }

  return { status: errors.length === 0 ? "PASS" : "FAIL", errors };
}

const DEPLOYMENT_ORDER = Object.freeze([
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

function deriveDeploymentReasons(descriptor) {
  const valid =
    descriptor != null && typeof descriptor === "object" && descriptor.schemaVersion === 1 &&
    ["deploymentId", "sourceCommitSha", "expectedSourceCommitSha", "artifactSha256", "expectedArtifactSha256"]
      .every((key) => typeof descriptor[key] === "string" && descriptor[key].length > 0) &&
    ["persistenceSchemaVersion", "expectedPersistenceSchemaVersion"].every((key) => Number.isInteger(descriptor[key])) &&
    ["liveTradingCapabilityPresent", "privateApiCapabilityPresent", "credentialStoragePresent",
      "killSwitchReachable", "autoTradeDefaultEnabled", "riskGatewayPresent"].every((key) => typeof descriptor[key] === "boolean");
  if (!valid) return ["INVALID_DESCRIPTOR"];

  const found = new Set();
  if (descriptor.liveTradingCapabilityPresent) found.add("LIVE_TRADING_CAPABILITY_PRESENT");
  if (descriptor.privateApiCapabilityPresent) found.add("PRIVATE_API_CAPABILITY_PRESENT");
  if (descriptor.credentialStoragePresent) found.add("CREDENTIAL_STORAGE_PRESENT");
  if (!descriptor.riskGatewayPresent) found.add("RISK_GATEWAY_ABSENT");
  if (!descriptor.killSwitchReachable) found.add("KILL_SWITCH_UNREACHABLE");
  if (descriptor.autoTradeDefaultEnabled) found.add("AUTO_TRADE_DEFAULT_ON");
  if (descriptor.artifactSha256 !== descriptor.expectedArtifactSha256) found.add("ARTIFACT_HASH_MISMATCH");
  if (descriptor.sourceCommitSha !== descriptor.expectedSourceCommitSha) found.add("SOURCE_COMMIT_MISMATCH");
  if (descriptor.persistenceSchemaVersion !== descriptor.expectedPersistenceSchemaVersion) found.add("PERSISTENCE_SCHEMA_MISMATCH");
  return DEPLOYMENT_ORDER.filter((code) => found.has(code));
}

function verifyDeploymentSafetyDecision(descriptor, decision) {
  const errors = [];
  if (decision == null || typeof decision !== "object") return { status: "FAIL", errors: ["decision is missing"] };
  if (decision.productionMutationAllowed !== false) errors.push("decision must never allow production mutation");

  const expected = deriveDeploymentReasons(descriptor);
  const actual = Array.isArray(decision.reasonCodes) ? decision.reasonCodes : [];
  if (JSON.stringify(expected) !== JSON.stringify(actual)) {
    errors.push(`reasonCodes ${JSON.stringify(actual)} do not match independently derived ${JSON.stringify(expected)}`);
  }
  const expectedStatus = expected.length === 0 ? "ALLOW" : "HALT";
  if (decision.status !== expectedStatus) errors.push(`status is ${decision.status}, independently derived ${expectedStatus}`);

  const descriptorSha256 = sha256(descriptor);
  if (decision.descriptorSha256 !== descriptorSha256) errors.push("descriptorSha256 does not match the descriptor as given");
  if (decision.decisionSha256 !== sha256({ status: decision.status, reasonCodes: decision.reasonCodes, descriptorSha256 })) {
    errors.push("decisionSha256 does not match the decision as recorded");
  }

  return { status: errors.length === 0 ? "PASS" : "FAIL", errors };
}

module.exports = {
  REASON_ORDER,
  DEPLOYMENT_ORDER,
  derivePreTradeReasons,
  deriveDeploymentReasons,
  verifyPreTradeRiskDecision,
  verifyDeploymentSafetyDecision
};
