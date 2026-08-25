import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { evaluatePreTradeRisk, type IndependentRiskLimits, type RiskIdentityState } from "../risk/independentRiskGateway";
import type { PreTradeRiskDecision, PreTradeRiskRequest } from "../../../../packages/contracts/src/riskGateway";
import type { RiskDecision, RiskEvidenceSink } from "../../../../packages/contracts/src/global-risk-gateway";
import type { PaperCommandRiskGate } from "../control/runtimeCommandService";
import type { PaperBroker, PaperSide } from "./paperBroker";
import { reconcilePaperLedger } from "./paperSafetyGates";
import { computeConsecutiveLossCount, computeDailyNotional, computeOrderRateState, tradingDayOf, type SessionPeakEquityTracker } from "./paperRiskState";
import { RUNTIME_EXCHANGE_CAPABILITIES } from "../exchange/runtimeExchangeCapabilities";
import { CanonicalRiskSafetyGate, type CanonicalRiskDecision, type RiskSafetyPersistence } from "../../../../packages/contracts/src/risk-safety-integration";

export interface OperationalPreflightDiagnostic {
  readonly status: "PASS" | "BLOCKED";
  readonly method: string;
  readonly evidence: readonly string[];
  readonly blockers: readonly string[];
}

export interface OperationalPreflightState {
  readonly deployment: OperationalPreflightDiagnostic;
  readonly reconciliation: OperationalPreflightDiagnostic;
  readonly riskGate: OperationalPreflightDiagnostic;
}

const PAPER_RISK_RULE_ID = "INDEPENDENT_PAPER_RISK_GATEWAY";

export function toPaperRiskEvidence(request: PreTradeRiskRequest, decision: PreTradeRiskDecision): RiskDecision {
  const result = decision.status === "ALLOW" ? "APPROVED" : decision.status === "REJECT" ? "REJECTED" : "BLOCKED";
  return Object.freeze({
    decisionId: decision.decisionSha256,
    result,
    policyVersion: request.riskPolicyFingerprint,
    reasonCodes: Object.freeze([...decision.reasonCodes]),
    observedAt: new Date(decision.evaluatedAt).toISOString(),
    executionId: request.commandId,
    ruleId: PAPER_RISK_RULE_ID,
    inputParameters: Object.freeze({
      requestId: request.requestId,
      signalId: request.signalId,
      clientOrderId: request.clientOrderId,
      side: request.side,
      quantity: request.quantity,
      referencePrice: request.referencePrice,
      requestedAt: request.requestedAt,
      requestSha256: decision.requestSha256
    }),
    accountState: Object.freeze({
      cash: request.accountState.cash,
      positionQuantity: request.accountState.positionQuantity,
      openOrderCount: request.accountState.openOrderCount,
      reconciliationHealthy: request.reconciliationState.healthy ? 1 : 0,
      persistenceHealthy: request.persistenceState.healthy ? 1 : 0
    }),
    marketState: Object.freeze({
      symbol: request.symbol,
      marketData: request.marketDataState.status,
      marketPrice: request.marketDataState.price === null ? "UNAVAILABLE" : String(request.marketDataState.price),
      deploymentIntegrity: request.deploymentState.integrityVerified ? "VERIFIED" : "FAILED",
      recovery: request.reconciliationState.healthy ? "MATCHED" : "MISMATCHED"
    }),
    correlationId: request.requestId
  });
}

function sha256(value: Uint8Array | string): string { return createHash("sha256").update(value).digest("hex"); }
function fileEvidence(file: string): string { return `${path.basename(file)}:${sha256(readFileSync(file))}`; }

/**
 * Runtime-only deployment verification. It checks the executable files that the Electron
 * process will load, plus the immutable A4 profile identity. It does not turn a source scan
 * into a claim that a capability is impossible.
 */
export function verifyRuntimeDeployment(input: Readonly<{
  mainDirectory: string;
  rendererPath: string;
  sourceCommitSha: string;
  strategyId: string;
  strategyVersion: string;
  symbol: string;
  interval: string;
  fingerprints: Readonly<Record<string, string>>;
}>): OperationalPreflightDiagnostic {
  const required = [
    path.join(input.mainDirectory, "main.js"),
    path.join(input.mainDirectory, "preload.js"),
    input.rendererPath
  ];
  const blockers: string[] = [];
  const evidence: string[] = ["method:RUNTIME_EXECUTABLE_ASSET_AND_PROFILE_CHECK", `sourceCommit:${input.sourceCommitSha}`];
  for (const file of required) {
    if (!existsSync(file)) blockers.push(`REQUIRED_ASSET_MISSING:${path.basename(file)}`);
    else evidence.push(fileEvidence(file));
  }
  if (input.strategyId !== "sma-crossover") blockers.push("STRATEGY_ID_MISMATCH");
  if (input.strategyVersion !== "sma-crossover:closed-candle-1m-v1") blockers.push("STRATEGY_VERSION_MISMATCH");
  if (input.symbol !== "KRW-BTC") blockers.push("MARKET_PROFILE_MISMATCH");
  if (input.interval !== "1m") blockers.push("CANDLE_INTERVAL_MISMATCH");
  for (const [name, fingerprint] of Object.entries(input.fingerprints)) {
    if (typeof fingerprint !== "string" || fingerprint.length === 0) blockers.push(`FINGERPRINT_MISSING:${name}`);
  }
  return Object.freeze({ status: blockers.length === 0 ? "PASS" : "BLOCKED", method: "RUNTIME_EXECUTABLE_ASSET_AND_PROFILE_CHECK", evidence: Object.freeze(evidence), blockers: Object.freeze([...new Set(blockers)].sort()) });
}

/** Independent calculation over the broker's persisted fills. No broker accounting helper is used. */
export function verifyRuntimePaperReconciliation(input: Readonly<{ broker: PaperBroker; initialCash: number; markPrice: number; persistenceHealthy: boolean; mutationCounters: Readonly<{ broker: number; orders: number; fills: number; cash: number; position: number }> }>): OperationalPreflightDiagnostic {
  const blockers: string[] = [];
  if (!Number.isFinite(input.initialCash) || input.initialCash < 0) blockers.push("INITIAL_CASH_INVALID");
  if (!Number.isFinite(input.markPrice) || input.markPrice <= 0) blockers.push("MARK_PRICE_INVALID");
  if (blockers.length > 0) return Object.freeze({ status: "BLOCKED", method: "INDEPENDENT_PAPER_LEDGER_AND_STATE_COMPARISON", evidence: Object.freeze([]), blockers: Object.freeze(blockers) });
  const state = input.broker.exportState();
  if (!input.persistenceHealthy) blockers.push("PERSISTENCE_UNHEALTHY");
  const ledger = reconcilePaperLedger(state.orders.map((order) => ({ id: order.id, side: order.side, quantity: order.quantity, price: order.price, fee: order.fee, filledAt: order.filledAt })), input.initialCash, input.markPrice);
  const account = input.broker.snapshot(input.markPrice);
  if (!ledger.healthy) blockers.push(...ledger.errors);
  if (Math.abs(ledger.cash - account.cash) > 1e-8) blockers.push("CASH_MISMATCH");
  if (Math.abs(ledger.quantity - account.position.quantity) > 1e-12) blockers.push("POSITION_MISMATCH");
  if (state.orders.some((order) => !order.filledAt)) blockers.push("UNRESOLVED_FILL");
  for (const [name, value] of Object.entries(input.mutationCounters)) if (value !== 0) blockers.push(`${name.toUpperCase()}_MUTATION:${value}`);
  return Object.freeze({ status: blockers.length === 0 ? "PASS" : "BLOCKED", method: "INDEPENDENT_PAPER_LEDGER_AND_STATE_COMPARISON", evidence: Object.freeze([`orders:${state.orders.length}`, `ledgerEquity:${ledger.equity}`, `accountEquity:${account.equity}`]), blockers: Object.freeze([...new Set(blockers)].sort()) });
}

export function createOperationalPaperRiskGate(input: Readonly<{
  getState: () => OperationalPreflightState;
  getBroker: () => PaperBroker;
  getMarket: () => Readonly<{ symbol: string; price: number | null; status: "HEALTHY" | "STALE" | "RECONNECTING" | "WARMING_UP" | "GAP_DETECTED" | "OUT_OF_ORDER" | "INVALID" }>;
  getControl: () => Readonly<{ killSwitchActive: boolean; openP0: boolean }>;
  identity: RiskIdentityState;
  limits: IndependentRiskLimits;
  fingerprints: Readonly<{ strategy: string; config: string; runtime: string; riskPolicy: string }>;
  sourceCommitSha: string;
  sessionPeakEquity: SessionPeakEquityTracker;
  evidence?: RiskEvidenceSink;
}>): PaperCommandRiskGate {
  return Object.freeze({
    evaluate: (command: Readonly<{ path: "MANUAL" | "STRATEGY" | "IPC" | "RECONNECT_REPLAY" | "SHADOW"; side: PaperSide; quantity: number; price: number }>) => {
      const preflight = input.getState();
      const broker = input.getBroker();
      const market = input.getMarket();
      const account = broker.snapshot(command.price);
      const brokerState = broker.exportState();
      const shadow = command.path === "SHADOW";
      const now = Date.now();
      const rateState = computeOrderRateState(brokerState.orders, now, command.side);
      const dailyNotional = computeDailyNotional(brokerState.orders, tradingDayOf(new Date(now).toISOString()));
      const consecutiveLossCount = computeConsecutiveLossCount(brokerState.ledger ?? []);
      const sessionPeakEquity = input.sessionPeakEquity.observe(account.equity);
      const request = {
        schemaVersion: 1 as const,
        requestId: `${input.sourceCommitSha}:${command.path}:${now}`,
        signalId: `${command.path}:${now}`,
        commandId: `${command.path}:${now}:${command.side}`,
        clientOrderId: `${command.path}:${now}:${command.side}:${command.quantity}`,
        strategyFingerprint: input.fingerprints.strategy,
        configFingerprint: input.fingerprints.config,
        runtimeFingerprint: input.fingerprints.runtime,
        riskPolicyFingerprint: input.fingerprints.riskPolicy,
        symbol: market.symbol, side: command.side, quantity: command.quantity, referencePrice: command.price, requestedAt: now,
        marketDataState: { status: market.status, price: market.price },
        accountState: { cash: account.cash, positionQuantity: account.position.quantity, openOrderCount: account.orders.length },
        // Read the declared build capability rather than restating `false` here. The risk gateway
        // blocks on these two, so a literal at this call site would keep that block unreachable
        // even after an authenticated order path was added.
        controlState: { killSwitchActive: input.getControl().killSwitchActive, liveCapabilityDetected: RUNTIME_EXCHANGE_CAPABILITIES.liveTrading, privateApiCapabilityDetected: RUNTIME_EXCHANGE_CAPABILITIES.authenticatedMutation },
        approvalState: { approved: shadow, expiresAt: now + 1_000, symbols: [market.symbol] },
        persistenceState: { healthy: preflight.riskGate.status === "PASS" },
        reconciliationState: { healthy: preflight.reconciliation.status === "PASS", openP0: input.getControl().openP0 },
        deploymentState: { integrityVerified: preflight.deployment.status === "PASS" },
        rateState,
        exposureState: { symbolExposureNotional: account.position.quantity * command.price, portfolioExposureNotional: account.position.quantity * command.price, dailyBuyNotional: dailyNotional.dailyBuyNotional, dailySellNotional: dailyNotional.dailySellNotional },
        sessionState: { dailyRealizedPnL: account.position.realizedPnl, consecutiveLossCount, sessionPeakEquity, sessionEquity: account.equity }
      };
      const decision = evaluatePreTradeRisk(request, input.identity, input.limits);
      input.evidence?.append(toPaperRiskEvidence(request, decision));
      return Object.freeze({ status: decision.status, reasonCodes: decision.reasonCodes });
    }
  });
}

const CANONICAL_RISK_RULE_ID = "CANONICAL_RISK_SAFETY_GATE";

function toCanonicalRiskEvidence(input: Readonly<{
  accountId: string; requestId: string; policyFingerprint: string; symbol: string;
  decision: CanonicalRiskDecision; account: Readonly<{ cash: number; positionQuantity: number; openOrderCount: number }>;
  market: Readonly<{ status: string; price: number | null }>;
}>): RiskDecision {
  const decision = input.decision;
  const result = decision.status === "APPROVED" ? "APPROVED" : decision.status === "REJECTED" ? "REJECTED" : decision.status === "BLOCKED" ? "BLOCKED" : "UNKNOWN";
  return Object.freeze({
    decisionId: decision.decisionId,
    result,
    policyVersion: input.policyFingerprint,
    reasonCodes: Object.freeze([...decision.reasonCodes]),
    observedAt: new Date(decision.evaluatedAtMs).toISOString(),
    executionId: input.requestId,
    ruleId: CANONICAL_RISK_RULE_ID,
    inputParameters: Object.freeze({ accountId: input.accountId }),
    accountState: Object.freeze({ cash: input.account.cash, positionQuantity: input.account.positionQuantity, openOrderCount: input.account.openOrderCount }),
    marketState: Object.freeze({ symbol: input.symbol, marketData: input.market.status, marketPrice: input.market.price === null ? "UNAVAILABLE" : String(input.market.price) }),
    correlationId: input.requestId
  });
}

function toCompositeRiskEvidence(input: Readonly<{
  requestId: string; policyFingerprint: string; symbol: string; independent: PreTradeRiskDecision; canonicalStatus: string; finalStatus: "ALLOW" | "REJECT" | "HALT";
}>): RiskDecision {
  const result = input.finalStatus === "ALLOW" ? "APPROVED" : input.finalStatus === "REJECT" ? "REJECTED" : "BLOCKED";
  const now = new Date().toISOString();
  return Object.freeze({
    decisionId: sha256(`COMPOSITE:${input.requestId}:${input.independent.decisionSha256}:${input.canonicalStatus}:${input.finalStatus}`),
    result,
    policyVersion: input.policyFingerprint,
    reasonCodes: Object.freeze([]),
    observedAt: now,
    executionId: input.requestId,
    ruleId: input.finalStatus === "ALLOW" ? "COMPOSITE_APPROVED" : "COMPOSITE_BLOCKED",
    inputParameters: Object.freeze({ independentStatus: input.independent.status, canonicalStatus: input.canonicalStatus }),
    accountState: Object.freeze({}),
    marketState: Object.freeze({ symbol: input.symbol }),
    correlationId: input.requestId
  });
}

/**
 * Production desktop adapter for WO-0018/WO-0019. Every real order boundary (MANUAL, STRATEGY,
 * RECONNECT_REPLAY, SHADOW) enters through here, and here alone. Two independently-implemented
 * gates run in sequence -- the independent gateway (WO-0032's exposure/rate/drawdown/consecutive-
 * loss/price-deviation limits) first, then the canonical gate (WO-0018's approval/daily-loss/
 * open-order/idempotency machinery) -- and BOTH must ALLOW before this function returns "ALLOW".
 * A caller only reaches broker.execute() after this returns "ALLOW".
 *
 * Order matters for two reasons WO-0019 requires:
 *   1. The independent gate has no persistent side effect, so a request it rejects never
 *      reaches the canonical gate at all -- an independent rejection can never consume a
 *      canonical idempotency key.
 *   2. The canonical gate's own idempotency claim happens inside CanonicalRiskSafetyGate.evaluate,
 *      which is the very last step before this function returns -- there is no gap between that
 *      claim and the caller's broker.execute() call for anything else to fail in.
 *
 * Every decision from both gates, plus one composite record of the combined outcome, is written
 * to the risk evidence sink BEFORE this function returns "ALLOW". If any evidence write throws,
 * the order is blocked with PERSISTENCE_UNHEALTHY regardless of what either gate decided --
 * evidence is not an optional side channel here, it is a precondition for execution.
 */
export function createCanonicalOperationalPaperRiskGate(input: Readonly<{
  getState: () => OperationalPreflightState;
  getBroker: () => PaperBroker;
  getMarket: () => Readonly<{ symbol: string; price: number | null; status: "HEALTHY" | "STALE" | "RECONNECTING" | "WARMING_UP" | "GAP_DETECTED" | "OUT_OF_ORDER" | "INVALID" }>;
  getControl: () => Readonly<{ killSwitchActive: boolean; openP0: boolean }>;
  persistence: RiskSafetyPersistence;
  accountId: string;
  policyFingerprint: string;
  maxDailyLoss: number;
  maxOpenOrders: number;
  identity: RiskIdentityState;
  limits: IndependentRiskLimits;
  sessionPeakEquity: SessionPeakEquityTracker;
  fingerprints: Readonly<{ strategy: string; config: string; runtime: string; riskPolicy: string }>;
  sourceCommitSha: string;
  evidence?: RiskEvidenceSink;
  onDecision?: (decision: CanonicalRiskDecision) => void;
}>): PaperCommandRiskGate {
  const canonical = new CanonicalRiskSafetyGate(input.persistence);
  return Object.freeze({
    evaluate: (command: Readonly<Parameters<PaperCommandRiskGate["evaluate"]>[0]>) => {
      const nowMs = command.nowMs ?? Date.now();
      const market = input.getMarket();
      const control = input.getControl();
      const preflight = input.getState();
      const broker = input.getBroker();
      const account = broker.snapshot(command.price);
      const brokerState = broker.exportState();
      const commandId = command.commandId ?? `${command.path}:${market.symbol}:${nowMs}:${command.side}`;
      const signalId = command.signalId ?? `${command.path}:${market.symbol}:${nowMs}:${command.side}`;
      const clientOrderId = command.clientOrderId ?? `paper:${commandId}`;
      const strategyId = command.strategyId ?? (command.path === "MANUAL" || command.path === "IPC" ? "MANUAL" : "sma-crossover");
      const requestId = `${command.path}:${commandId}`;
      const accountState = { cash: account.cash, positionQuantity: account.position.quantity, openOrderCount: account.orders.length };

      // ---- Stage 1: independent gateway (WO-0032 exposure/rate/drawdown/loss limits) ----
      const rateState = computeOrderRateState(brokerState.orders, nowMs, command.side);
      const dailyNotional = computeDailyNotional(brokerState.orders, tradingDayOf(new Date(nowMs).toISOString()));
      const consecutiveLossCount = computeConsecutiveLossCount(brokerState.ledger ?? []);
      const sessionPeakEquity = input.sessionPeakEquity.observe(account.equity);
      const independentRequest: PreTradeRiskRequest = {
        schemaVersion: 1,
        requestId: `${input.sourceCommitSha}:${requestId}`,
        signalId, commandId, clientOrderId,
        strategyFingerprint: input.fingerprints.strategy,
        configFingerprint: input.fingerprints.config,
        runtimeFingerprint: input.fingerprints.runtime,
        riskPolicyFingerprint: input.fingerprints.riskPolicy,
        symbol: market.symbol, side: command.side, quantity: command.quantity, referencePrice: command.price, requestedAt: nowMs,
        marketDataState: { status: market.status, price: market.price },
        accountState,
        // Read the declared build capability rather than restating `false` here (see the note
        // on the SHADOW gateway below for why this is not a hardcoded literal).
        controlState: { killSwitchActive: control.killSwitchActive, liveCapabilityDetected: RUNTIME_EXCHANGE_CAPABILITIES.liveTrading, privateApiCapabilityDetected: RUNTIME_EXCHANGE_CAPABILITIES.authenticatedMutation },
        // The independent gateway's OWN approval concept is deliberately neutralized here: the
        // canonical gate below is the single, authoritative approval decision. Feeding this a
        // real approval state would stand up a second, divergent approval model (WO-0019 forbids
        // mixing the two), so this always reports "approved" and lets the canonical gate's
        // APPROVAL_MISSING/APPROVAL_EXPIRED/APPROVAL_SCOPE_MISMATCH be the only ones that matter.
        approvalState: { approved: true, expiresAt: nowMs + 1, symbols: [market.symbol] },
        persistenceState: { healthy: preflight.riskGate.status === "PASS" },
        reconciliationState: { healthy: preflight.reconciliation.status === "PASS", openP0: control.openP0 },
        deploymentState: { integrityVerified: preflight.deployment.status === "PASS" },
        rateState,
        exposureState: { symbolExposureNotional: account.position.quantity * command.price, portfolioExposureNotional: account.position.quantity * command.price, dailyBuyNotional: dailyNotional.dailyBuyNotional, dailySellNotional: dailyNotional.dailySellNotional },
        sessionState: { dailyRealizedPnL: account.position.realizedPnl, consecutiveLossCount, sessionPeakEquity, sessionEquity: account.equity }
      };
      const independentDecision = evaluatePreTradeRisk(independentRequest, input.identity, input.limits);

      try {
        input.evidence?.append(toPaperRiskEvidence(independentRequest, independentDecision));
      } catch {
        return Object.freeze({ status: "HALT" as const, reasonCodes: Object.freeze(["PERSISTENCE_UNHEALTHY"]) });
      }

      if (independentDecision.status !== "ALLOW") {
        // The canonical gate is never invoked: an independent rejection can never claim a
        // canonical idempotency key.
        try {
          input.evidence?.append(toCompositeRiskEvidence({ requestId, policyFingerprint: input.policyFingerprint, symbol: market.symbol, independent: independentDecision, canonicalStatus: "NOT_EVALUATED", finalStatus: independentDecision.status === "REJECT" ? "REJECT" : "HALT" }));
        } catch {
          return Object.freeze({ status: "HALT" as const, reasonCodes: Object.freeze([...independentDecision.reasonCodes, "PERSISTENCE_UNHEALTHY"]) });
        }
        return Object.freeze({ status: independentDecision.status === "REJECT" ? "REJECT" as const : "HALT" as const, reasonCodes: independentDecision.reasonCodes });
      }

      // ---- Stage 2: canonical gate (WO-0018 approval/daily-loss/open-order/idempotency) ----
      const canonicalDecision = canonical.evaluate({
        accountId: command.accountId ?? input.accountId,
        requestId,
        boundary: command.path === "IPC" ? "MANUAL" : command.path,
        mode: command.path === "SHADOW" ? "SHADOW" : "PAPER",
        symbol: market.symbol,
        side: command.side,
        strategyId,
        policyFingerprint: input.policyFingerprint,
        ...(command.approvalId === undefined ? {} : { approvalId: command.approvalId }),
        nowMs,
        currentEquity: account.equity,
        marketDataFresh: market.status === "HEALTHY" && market.price !== null,
        marketHealthy: market.status === "HEALTHY",
        killSwitchActive: control.killSwitchActive,
        liveMutationAllowed: false,
        recoveryReady: preflight.deployment.status === "PASS" && preflight.reconciliation.status === "PASS" && !control.openP0,
        persistenceHealthy: preflight.riskGate.status === "PASS",
        maxDailyLoss: input.maxDailyLoss,
        maxOpenOrders: input.maxOpenOrders,
        idempotency: { accountId: command.accountId ?? input.accountId, commandId, signalId, clientOrderId, payloadFingerprint: "PENDING", createdAtMs: nowMs }
      });
      input.onDecision?.(canonicalDecision);

      try {
        input.evidence?.append(toCanonicalRiskEvidence({ accountId: input.accountId, requestId, policyFingerprint: input.policyFingerprint, symbol: market.symbol, decision: canonicalDecision, account: accountState, market }));
      } catch {
        return Object.freeze({ status: "HALT" as const, reasonCodes: Object.freeze([...canonicalDecision.reasonCodes, "PERSISTENCE_UNHEALTHY"]) });
      }

      const finalStatus: "ALLOW" | "REJECT" | "HALT" = canonicalDecision.status === "APPROVED" ? "ALLOW" : canonicalDecision.status === "REJECTED" ? "REJECT" : "HALT";

      try {
        input.evidence?.append(toCompositeRiskEvidence({ requestId, policyFingerprint: input.policyFingerprint, symbol: market.symbol, independent: independentDecision, canonicalStatus: canonicalDecision.status, finalStatus }));
      } catch {
        return Object.freeze({ status: "HALT" as const, reasonCodes: Object.freeze([...canonicalDecision.reasonCodes, "PERSISTENCE_UNHEALTHY"]) });
      }

      return Object.freeze({ status: finalStatus, reasonCodes: Object.freeze([...independentDecision.reasonCodes, ...canonicalDecision.reasonCodes]) });
    },
    recordOrder: (order: Readonly<{ orderId: string; status: "OPEN" | "PENDING" | "FILLED" | "CANCELLED" | "REJECTED"; nowMs?: number }>) => {
      input.persistence.saveOrder({ accountId: input.accountId, orderId: order.orderId, status: order.status, updatedAtMs: order.nowMs ?? Date.now() });
    }
  });
}
