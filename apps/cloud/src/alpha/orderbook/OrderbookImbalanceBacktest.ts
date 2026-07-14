import { createHash } from "node:crypto";
import type { OrderbookImbalanceFeature } from "./OrderbookImbalanceFeature";
import type { OrderbookImbalancePosition, OrderbookImbalanceStrategyDecision } from "./OrderbookImbalanceStrategy";

export interface OrderbookImbalanceBacktestPolicy {
  readonly engineVersion: number;
  readonly initialEquity: number;
  readonly notionalPerTrade: number;
  readonly takerFeeRate: number;
  readonly slippageRate: number;
  readonly maximumParticipationRate: number;
  readonly annualizationFactor: number;
}

export interface OrderbookImbalanceBacktestInput {
  readonly features: readonly OrderbookImbalanceFeature[];
  readonly decisions: readonly OrderbookImbalanceStrategyDecision[];
}

export interface OrderbookImbalanceFill {
  readonly fillId: string;
  readonly decisionId: string;
  readonly featureSnapshotId: string;
  readonly executionSnapshotId: string;
  readonly executedAt: string;
  readonly side: "BUY" | "SELL";
  readonly quantity: number;
  readonly price: number;
  readonly notional: number;
  readonly fee: number;
  readonly slippageCost: number;
  readonly positionAfter: OrderbookImbalancePosition;
}

export interface OrderbookImbalanceTrade {
  readonly tradeId: string;
  readonly side: "LONG" | "SHORT";
  readonly entryDecisionId: string;
  readonly exitDecisionId: string;
  readonly entryAt: string;
  readonly exitAt: string;
  readonly quantity: number;
  readonly entryPrice: number;
  readonly exitPrice: number;
  readonly grossPnl: number;
  readonly fees: number;
  readonly slippageCost: number;
  readonly netPnl: number;
  readonly returnRate: number;
  readonly profitable: boolean;
}

export interface OrderbookImbalanceEquityPoint {
  readonly snapshotId: string;
  readonly capturedAt: string;
  readonly equity: number;
  readonly drawdown: number;
  readonly position: OrderbookImbalancePosition;
}

export interface OrderbookImbalanceBacktestMetrics {
  readonly initialEquity: number;
  readonly finalEquity: number;
  readonly totalReturn: number;
  readonly grossPnl: number;
  readonly netPnl: number;
  readonly totalFees: number;
  readonly totalSlippageCost: number;
  readonly maxDrawdown: number;
  readonly sharpe: number;
  readonly sortino: number;
  readonly winRate: number;
  readonly profitFactor: number;
  readonly expectancy: number;
  readonly turnover: number;
  readonly exposureRatio: number;
  readonly tradeCount: number;
}

export interface OrderbookImbalanceBacktestResult {
  readonly engineVersion: number;
  readonly market: string;
  readonly generatedAt: string;
  readonly fills: readonly OrderbookImbalanceFill[];
  readonly trades: readonly OrderbookImbalanceTrade[];
  readonly equityCurve: readonly OrderbookImbalanceEquityPoint[];
  readonly metrics: OrderbookImbalanceBacktestMetrics;
  readonly warnings: readonly string[];
  readonly resultHash: string;
}

interface OpenPosition {
  readonly side: "LONG" | "SHORT";
  readonly entryDecisionId: string;
  readonly entryAt: string;
  readonly quantity: number;
  readonly entryPrice: number;
  readonly entryFee: number;
  readonly entrySlippageCost: number;
}

const SHA256 = /^[a-f0-9]{64}$/;
const round = (value: number): number => Math.round(value * 1_000_000_000) / 1_000_000_000;
const finite = (value: number, label: string): void => {
  if (!Number.isFinite(value)) throw new Error(`${label} must be finite`);
};
const parseTime = (value: string, label: string): number => {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) throw new Error(`${label} must be a valid ISO timestamp`);
  return parsed;
};
const canonical = (value: unknown): string => {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`)
    .join(",")}}`;
};
const hash = (value: unknown): string => createHash("sha256").update(canonical(value)).digest("hex");
const average = (values: readonly number[]): number => values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length;
const standardDeviation = (values: readonly number[]): number => {
  if (values.length < 2) return 0;
  const mean = average(values);
  return Math.sqrt(values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (values.length - 1));
};

const validatePolicy = (policy: OrderbookImbalanceBacktestPolicy): void => {
  if (!Number.isInteger(policy.engineVersion) || policy.engineVersion < 1) throw new Error("engineVersion must be a positive integer");
  for (const [label, value] of [
    ["initialEquity", policy.initialEquity],
    ["notionalPerTrade", policy.notionalPerTrade],
    ["takerFeeRate", policy.takerFeeRate],
    ["slippageRate", policy.slippageRate],
    ["maximumParticipationRate", policy.maximumParticipationRate],
    ["annualizationFactor", policy.annualizationFactor]
  ] as const) finite(value, label);
  if (policy.initialEquity <= 0 || policy.notionalPerTrade <= 0) throw new Error("initialEquity and notionalPerTrade must be positive");
  if (policy.takerFeeRate < 0 || policy.slippageRate < 0) throw new Error("cost rates must be non-negative");
  if (policy.maximumParticipationRate <= 0 || policy.maximumParticipationRate > 1) throw new Error("maximumParticipationRate must be in (0, 1]");
  if (policy.annualizationFactor <= 0) throw new Error("annualizationFactor must be positive");
};

const validateInput = (input: OrderbookImbalanceBacktestInput): string => {
  if (input.features.length < 2) throw new Error("at least two features are required");
  if (input.decisions.length === 0) throw new Error("at least one decision is required");
  const featureIds = new Set<string>();
  const decisionIds = new Set<string>();
  const featureBySnapshot = new Map<string, OrderbookImbalanceFeature>();
  const market = input.features[0]?.market ?? "";
  let previousTime = -Infinity;
  for (const feature of input.features) {
    if (!SHA256.test(feature.contentHash)) throw new Error("feature contentHash is invalid");
    if (feature.market !== market) throw new Error("features must have one market");
    if (featureIds.has(feature.snapshotId)) throw new Error(`duplicate feature snapshot ${feature.snapshotId}`);
    featureIds.add(feature.snapshotId);
    featureBySnapshot.set(feature.snapshotId, feature);
    const currentTime = parseTime(feature.generatedAt, `${feature.snapshotId}.generatedAt`);
    if (currentTime <= previousTime) throw new Error("features must be strictly chronological");
    previousTime = currentTime;
  }
  let previousDecisionTime = -Infinity;
  for (const decision of input.decisions) {
    if (!SHA256.test(decision.contentHash)) throw new Error("decision contentHash is invalid");
    if (decision.market !== market) throw new Error("decisions must match feature market");
    if (decisionIds.has(decision.decisionId)) throw new Error(`duplicate decision ${decision.decisionId}`);
    decisionIds.add(decision.decisionId);
    const source = featureBySnapshot.get(decision.featureSnapshotId);
    if (!source) throw new Error(`decision ${decision.decisionId} references missing feature`);
    if (source.contentHash !== decision.featureHash) throw new Error(`decision ${decision.decisionId} feature hash mismatch`);
    const currentTime = parseTime(decision.generatedAt, `${decision.decisionId}.generatedAt`);
    if (currentTime < previousDecisionTime) throw new Error("decisions must be chronological");
    previousDecisionTime = currentTime;
  }
  return market;
};

const executionPrice = (feature: OrderbookImbalanceFeature, side: "BUY" | "SELL", slippageRate: number): number => {
  const base = side === "BUY" ? feature.bestAsk : feature.bestBid;
  return round(base * (side === "BUY" ? 1 + slippageRate : 1 - slippageRate));
};

export const runOrderbookImbalanceBacktest = (
  input: OrderbookImbalanceBacktestInput,
  generatedAt: string,
  policy: OrderbookImbalanceBacktestPolicy
): OrderbookImbalanceBacktestResult => {
  validatePolicy(policy);
  const market = validateInput(input);
  parseTime(generatedAt, "generatedAt");

  const featureIndex = new Map(input.features.map((feature, index) => [feature.snapshotId, index] as const));
  const decisionsByExecutionIndex = new Map<number, OrderbookImbalanceStrategyDecision[]>();
  for (const decision of input.decisions) {
    const sourceIndex = featureIndex.get(decision.featureSnapshotId);
    if (sourceIndex === undefined) throw new Error("decision source index missing");
    const executionIndex = sourceIndex + 1;
    if (executionIndex >= input.features.length) continue;
    const bucket = decisionsByExecutionIndex.get(executionIndex) ?? [];
    bucket.push(decision);
    decisionsByExecutionIndex.set(executionIndex, bucket);
  }

  const fills: OrderbookImbalanceFill[] = [];
  const trades: OrderbookImbalanceTrade[] = [];
  const equityCurve: OrderbookImbalanceEquityPoint[] = [];
  const warnings: string[] = [];
  let cash = policy.initialEquity;
  let openPosition: OpenPosition | null = null;
  let peakEquity = policy.initialEquity;
  let maxDrawdown = 0;
  let grossPnl = 0;
  let totalFees = 0;
  let totalSlippageCost = 0;
  let turnoverNotional = 0;
  let exposedSnapshots = 0;

  for (let index = 0; index < input.features.length; index += 1) {
    const feature = input.features[index];
    if (!feature) throw new Error("feature missing during replay");
    const decisions = decisionsByExecutionIndex.get(index) ?? [];
    if (decisions.length > 1) throw new Error(`multiple executable decisions at snapshot ${feature.snapshotId}`);
    const decision = decisions[0];

    if (decision && decision.action !== "HOLD" && decision.action !== "ABSTAIN") {
      const desiredPosition = decision.action === "ENTER_LONG" ? "LONG" : decision.action === "ENTER_SHORT" ? "SHORT" : "FLAT";
      if (desiredPosition !== "FLAT" && openPosition !== null) throw new Error("entry decision encountered while position is open");
      if (desiredPosition === "FLAT" && openPosition === null) throw new Error("exit decision encountered while flat");

      if (desiredPosition !== "FLAT") {
        const side: "BUY" | "SELL" = desiredPosition === "LONG" ? "BUY" : "SELL";
        const visibleQuantity = desiredPosition === "LONG" ? feature.askQuantity : feature.bidQuantity;
        const maximumQuantity = visibleQuantity * policy.maximumParticipationRate;
        const rawPrice = side === "BUY" ? feature.bestAsk : feature.bestBid;
        const requestedQuantity = policy.notionalPerTrade / rawPrice;
        const quantity = Math.min(requestedQuantity, maximumQuantity);
        if (quantity <= 0) {
          warnings.push(`NO_FILL_CAPACITY:${decision.decisionId}`);
        } else {
          const price = executionPrice(feature, side, policy.slippageRate);
          const notional = round(price * quantity);
          const fee = round(notional * policy.takerFeeRate);
          const slippageCost = round(Math.abs(price - rawPrice) * quantity);
          cash = round(cash - fee - slippageCost);
          totalFees = round(totalFees + fee);
          totalSlippageCost = round(totalSlippageCost + slippageCost);
          turnoverNotional = round(turnoverNotional + notional);
          openPosition = Object.freeze({ side: desiredPosition, entryDecisionId: decision.decisionId, entryAt: feature.generatedAt, quantity: round(quantity), entryPrice: price, entryFee: fee, entrySlippageCost: slippageCost });
          fills.push(Object.freeze({ fillId: `FILL-${fills.length + 1}`, decisionId: decision.decisionId, featureSnapshotId: decision.featureSnapshotId, executionSnapshotId: feature.snapshotId, executedAt: feature.generatedAt, side, quantity: round(quantity), price, notional, fee, slippageCost, positionAfter: desiredPosition }));
        }
      } else if (openPosition) {
        const closing = openPosition;
        const side: "BUY" | "SELL" = closing.side === "LONG" ? "SELL" : "BUY";
        const rawPrice = side === "BUY" ? feature.bestAsk : feature.bestBid;
        const price = executionPrice(feature, side, policy.slippageRate);
        const notional = round(price * closing.quantity);
        const fee = round(notional * policy.takerFeeRate);
        const slippageCost = round(Math.abs(price - rawPrice) * closing.quantity);
        const direction = closing.side === "LONG" ? 1 : -1;
        const tradeGross = round((price - closing.entryPrice) * closing.quantity * direction);
        const tradeFees = round(closing.entryFee + fee);
        const tradeSlippage = round(closing.entrySlippageCost + slippageCost);
        const tradeNet = round(tradeGross - fee - slippageCost);
        cash = round(cash + tradeGross - fee - slippageCost);
        grossPnl = round(grossPnl + tradeGross);
        totalFees = round(totalFees + fee);
        totalSlippageCost = round(totalSlippageCost + slippageCost);
        turnoverNotional = round(turnoverNotional + notional);
        fills.push(Object.freeze({ fillId: `FILL-${fills.length + 1}`, decisionId: decision.decisionId, featureSnapshotId: decision.featureSnapshotId, executionSnapshotId: feature.snapshotId, executedAt: feature.generatedAt, side, quantity: closing.quantity, price, notional, fee, slippageCost, positionAfter: "FLAT" }));
        trades.push(Object.freeze({ tradeId: `TRADE-${trades.length + 1}`, side: closing.side, entryDecisionId: closing.entryDecisionId, exitDecisionId: decision.decisionId, entryAt: closing.entryAt, exitAt: feature.generatedAt, quantity: closing.quantity, entryPrice: closing.entryPrice, exitPrice: price, grossPnl: tradeGross, fees: tradeFees, slippageCost: tradeSlippage, netPnl: tradeNet, returnRate: round(tradeNet / Math.max(closing.entryPrice * closing.quantity, 1e-12)), profitable: tradeNet > 0 }));
        openPosition = null;
      }
    }

    let unrealized = 0;
    if (openPosition) {
      exposedSnapshots += 1;
      const markPrice = feature.midPrice;
      unrealized = (markPrice - openPosition.entryPrice) * openPosition.quantity * (openPosition.side === "LONG" ? 1 : -1);
    }
    const equity = round(cash + unrealized);
    if (!Number.isFinite(equity) || equity < 0) throw new Error("equity invariant violated");
    peakEquity = Math.max(peakEquity, equity);
    const drawdown = peakEquity === 0 ? 0 : round((peakEquity - equity) / peakEquity);
    maxDrawdown = Math.max(maxDrawdown, drawdown);
    equityCurve.push(Object.freeze({ snapshotId: feature.snapshotId, capturedAt: feature.generatedAt, equity, drawdown, position: openPosition?.side ?? "FLAT" }));
  }

  if (openPosition) warnings.push("OPEN_POSITION_MARKED_AT_END");
  const finalEquity = equityCurve.at(-1)?.equity ?? policy.initialEquity;
  const returns: number[] = [];
  for (let index = 1; index < equityCurve.length; index += 1) {
    const previous = equityCurve[index - 1]?.equity ?? policy.initialEquity;
    const current = equityCurve[index]?.equity ?? previous;
    returns.push(previous === 0 ? 0 : current / previous - 1);
  }
  const meanReturn = average(returns);
  const volatility = standardDeviation(returns);
  const downside = returns.filter((value) => value < 0);
  const downsideDeviation = standardDeviation(downside);
  const gains = trades.filter((trade) => trade.netPnl > 0).reduce((sum, trade) => sum + trade.netPnl, 0);
  const losses = Math.abs(trades.filter((trade) => trade.netPnl < 0).reduce((sum, trade) => sum + trade.netPnl, 0));
  const netPnl = round(finalEquity - policy.initialEquity);
  const metrics: OrderbookImbalanceBacktestMetrics = Object.freeze({
    initialEquity: round(policy.initialEquity),
    finalEquity,
    totalReturn: round(finalEquity / policy.initialEquity - 1),
    grossPnl,
    netPnl,
    totalFees,
    totalSlippageCost,
    maxDrawdown: round(maxDrawdown),
    sharpe: volatility === 0 ? 0 : round(meanReturn / volatility * Math.sqrt(policy.annualizationFactor)),
    sortino: downsideDeviation === 0 ? 0 : round(meanReturn / downsideDeviation * Math.sqrt(policy.annualizationFactor)),
    winRate: trades.length === 0 ? 0 : round(trades.filter((trade) => trade.profitable).length / trades.length),
    profitFactor: losses === 0 ? (gains > 0 ? Number.MAX_SAFE_INTEGER : 0) : round(gains / losses),
    expectancy: trades.length === 0 ? 0 : round(trades.reduce((sum, trade) => sum + trade.netPnl, 0) / trades.length),
    turnover: round(turnoverNotional / policy.initialEquity),
    exposureRatio: round(exposedSnapshots / input.features.length),
    tradeCount: trades.length
  });

  const payload = {
    engineVersion: policy.engineVersion,
    market,
    generatedAt,
    fills: Object.freeze(fills),
    trades: Object.freeze(trades),
    equityCurve: Object.freeze(equityCurve),
    metrics,
    warnings: Object.freeze(warnings)
  };
  const resultHash = hash(payload);
  if (!SHA256.test(resultHash)) throw new Error("result hash invariant violated");
  return Object.freeze({ ...payload, resultHash });
};
