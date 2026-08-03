import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { evaluatePreTradeRisk, type IndependentRiskLimits, type RiskIdentityState } from "./independentRiskGateway";
import type { PreTradeRiskDecision, PreTradeRiskRequest } from "../../../packages/contracts/src/riskGateway";
import type { RiskDecision, RiskEvidenceSink } from "../../../apps/execution/src/global-risk-gateway";
import type { PaperCommandRiskGate } from "./runtimeCommandService";
import type { PaperBroker, PaperSide } from "./paperBroker";
import { reconcilePaperLedger } from "./paperSafetyGates";
import { computeConsecutiveLossCount, computeDailyNotional, computeOrderRateState, tradingDayOf, type SessionPeakEquityTracker } from "./paperRiskState";

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
        controlState: { killSwitchActive: input.getControl().killSwitchActive, liveCapabilityDetected: false, privateApiCapabilityDetected: false },
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
