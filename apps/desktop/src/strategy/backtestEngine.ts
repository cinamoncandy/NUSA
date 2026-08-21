import { PaperBroker, type PaperOrder, type PaperRiskPolicy, type PaperSide } from "../paper/paperBroker";
import { StrategyEngine, type StrategySignal, type TradingStrategy } from "./strategyEngine";
import { analyzeEquityCurve, calculateExposure, calculatePerformanceMetrics, matchTrades, type EquityAnalytics, type MatchedTrade, type OpenPositionAnalysis, type PerformanceMetrics } from "./backtestAnalytics";

export interface BacktestPoint {
  readonly timestamp: number;
  readonly close: number;
}

export interface BacktestExecutionCosts {
  readonly spreadBps?: number;
  readonly slippageBps?: number;
}

export interface BacktestConfig {
  readonly market?: string;
  readonly initialCash?: number;
  readonly feeRate?: number;
  readonly orderQuantity?: number;
  readonly riskPolicy?: PaperRiskPolicy;
  readonly executionCosts?: BacktestExecutionCosts;
}

export type BacktestDecisionOutcome = "HOLD" | "FILLED" | "REJECTED";

export interface BacktestDecision {
  readonly timestamp: number;
  readonly market: string;
  readonly price: number;
  readonly executionPrice?: number;
  readonly signal: StrategySignal;
  readonly outcome: BacktestDecisionOutcome;
  readonly equityBefore: number;
  readonly equityAfter: number;
  readonly order?: PaperOrder;
  readonly rejectionReason?: string;
}

export interface BacktestMetrics {
  readonly initialEquity: number;
  readonly finalEquity: number;
  readonly totalReturn: number;
  readonly benchmarkReturn: number;
  readonly excessReturn: number;
  readonly outperformance: number;
  readonly maxDrawdown: number;
  readonly turnover: number;
  readonly fillCount: number;
  readonly rejectionCount: number;
  readonly feesPaid: number;
  readonly spreadCost: number;
  readonly slippageCost: number;
  readonly totalTradingCost: number;
}

export interface BacktestBenchmark {
  readonly strategyReturn: number;
  readonly buyAndHoldReturn: number;
  readonly outperformance: number;
}

export interface BacktestResult {
  readonly metrics: BacktestMetrics;
  readonly decisions: readonly BacktestDecision[];
  readonly equityCurve: readonly { timestamp: number; equity: number }[];
  readonly trades: readonly MatchedTrade[];
  readonly performance: PerformanceMetrics;
  readonly equityAnalytics: EquityAnalytics;
  readonly benchmark: BacktestBenchmark;
  readonly openPosition: OpenPositionAnalysis;
  readonly finalPaperState: ReturnType<PaperBroker["exportState"]>;
}

const DEFAULT_MARKET = "KRW-BTC";
const DEFAULT_INITIAL_CASH = 10_000_000;
const DEFAULT_FEE_RATE = 0.0005;
const DEFAULT_ORDER_QUANTITY = 0.001;

function validatePoints(points: readonly BacktestPoint[]): void {
  if (points.length === 0) throw new Error("backtest requires at least one point");
  let previousTimestamp = Number.NEGATIVE_INFINITY;
  for (const point of points) {
    if (!Number.isFinite(point.timestamp) || point.timestamp <= previousTimestamp) {
      throw new Error("backtest timestamps must be finite and strictly increasing");
    }
    if (!Number.isFinite(point.close) || point.close <= 0) {
      throw new Error("backtest close must be positive and finite");
    }
    previousTimestamp = point.timestamp;
  }
}

function validateExecutionCosts(costs: BacktestExecutionCosts): Required<BacktestExecutionCosts> {
  const spreadBps = costs.spreadBps ?? 0;
  const slippageBps = costs.slippageBps ?? 0;
  for (const [name, value] of [["spreadBps", spreadBps], ["slippageBps", slippageBps]] as const) {
    if (!Number.isFinite(value) || value < 0 || value >= 10_000) {
      throw new Error(`backtest ${name} must be finite and between 0 and 10000`);
    }
  }
  if (spreadBps / 2 + slippageBps >= 10_000) {
    throw new Error("backtest execution costs would produce a non-positive sell price");
  }
  return Object.freeze({ spreadBps, slippageBps });
}

function executionPrice(side: PaperSide, marketPrice: number, costs: Required<BacktestExecutionCosts>): number {
  const halfSpreadRate = costs.spreadBps / 20_000;
  const slippageRate = costs.slippageBps / 10_000;
  const adverseRate = halfSpreadRate + slippageRate;
  return side === "BUY" ? marketPrice * (1 + adverseRate) : marketPrice * (1 - adverseRate);
}

function computeMaxDrawdown(equityCurve: readonly { equity: number }[]): number {
  let peak = equityCurve[0]?.equity ?? 0;
  let maxDrawdown = 0;
  for (const point of equityCurve) {
    peak = Math.max(peak, point.equity);
    if (peak > 0) maxDrawdown = Math.max(maxDrawdown, (peak - point.equity) / peak);
  }
  return maxDrawdown;
}

function computeBenchmarkReturn(
  initialCash: number,
  feeRate: number,
  firstPrice: number,
  finalPrice: number,
  costs: Required<BacktestExecutionCosts>
): number {
  const entryPrice = executionPrice("BUY", firstPrice, costs);
  const quantity = initialCash / (entryPrice * (1 + feeRate));
  const finalEquity = quantity * finalPrice;
  return finalEquity / initialCash - 1;
}

export function runBacktest(
  points: readonly BacktestPoint[],
  strategyFactory: () => TradingStrategy,
  config: BacktestConfig = {}
): BacktestResult {
  validatePoints(points);
  const market = config.market ?? DEFAULT_MARKET;
  const initialCash = config.initialCash ?? DEFAULT_INITIAL_CASH;
  const feeRate = config.feeRate ?? DEFAULT_FEE_RATE;
  const orderQuantity = config.orderQuantity ?? DEFAULT_ORDER_QUANTITY;
  const costs = validateExecutionCosts(config.executionCosts ?? {});
  if (!market) throw new Error("backtest market is required");
  if (!Number.isFinite(initialCash) || initialCash <= 0) throw new Error("backtest initialCash must be positive");
  if (!Number.isFinite(feeRate) || feeRate < 0) throw new Error("backtest feeRate must be non-negative");
  if (!Number.isFinite(orderQuantity) || orderQuantity <= 0) throw new Error("backtest orderQuantity must be positive");

  const broker = new PaperBroker(initialCash, market, feeRate, config.riskPolicy ?? {});
  const engine = new StrategyEngine(strategyFactory());
  engine.start();
  const decisions: BacktestDecision[] = [];
  const equityCurve: Array<{ timestamp: number; equity: number }> = [];
  let tradedNotional = 0;
  let fillCount = 0;
  let rejectionCount = 0;
  let feesPaid = 0;
  let spreadCost = 0;
  let slippageCost = 0;

  for (const point of points) {
    const beforeSnapshot = broker.snapshot(point.close);
    const signal = engine.onTick(
      { market, price: point.close, timestamp: point.timestamp },
      beforeSnapshot.position.quantity
    );
    let outcome: BacktestDecisionOutcome = "HOLD";
    let order: PaperOrder | undefined;
    let rejectionReason: string | undefined;
    let filledPrice: number | undefined;

    if (signal.type !== "HOLD") {
      const quantity = signal.type === "SELL"
        ? Math.min(orderQuantity, beforeSnapshot.position.quantity)
        : orderQuantity;
      if (quantity > 0) {
        try {
          filledPrice = executionPrice(signal.type, point.close, costs);
          order = broker.execute(signal.type, quantity, filledPrice, new Date(point.timestamp));
          tradedNotional += order.quantity * order.price;
          feesPaid += order.fee;
          spreadCost += point.close * order.quantity * costs.spreadBps / 20_000;
          slippageCost += point.close * order.quantity * costs.slippageBps / 10_000;
          fillCount += 1;
          outcome = "FILLED";
        } catch (error) {
          rejectionReason = error instanceof Error ? error.message : String(error);
          rejectionCount += 1;
          outcome = "REJECTED";
        }
      } else {
        rejectionReason = "insufficient paper position";
        rejectionCount += 1;
        outcome = "REJECTED";
      }
    }

    const equityAfter = broker.snapshot(point.close).equity;
    decisions.push(Object.freeze({
      timestamp: point.timestamp,
      market,
      price: point.close,
      executionPrice: filledPrice,
      signal: Object.freeze({ ...signal }),
      outcome,
      equityBefore: beforeSnapshot.equity,
      equityAfter,
      order,
      rejectionReason
    }));
    equityCurve.push(Object.freeze({ timestamp: point.timestamp, equity: equityAfter }));
  }

  const finalEquity = equityCurve[equityCurve.length - 1]?.equity ?? initialCash;
  const totalReturn = finalEquity / initialCash - 1;
  const benchmarkReturn = computeBenchmarkReturn(
    initialCash,
    feeRate,
    points[0]!.close,
    points[points.length - 1]!.close,
    costs
  );
  const matched = matchTrades(decisions.flatMap((decision) => decision.order == null ? [] : [decision.order]));
  const exposure = calculateExposure(decisions.flatMap((decision) => decision.order == null ? [] : [decision.order]), points[0]!.timestamp, points[points.length - 1]!.timestamp);
  const performance = calculatePerformanceMetrics(matched.trades, exposure);
  const equityAnalytics = analyzeEquityCurve(equityCurve, performance.netProfit);
  const benchmark = Object.freeze({ strategyReturn: totalReturn, buyAndHoldReturn: benchmarkReturn, outperformance: totalReturn - benchmarkReturn });
  const metrics: BacktestMetrics = Object.freeze({
    initialEquity: initialCash,
    finalEquity,
    totalReturn,
    benchmarkReturn,
    excessReturn: benchmark.outperformance,
    outperformance: benchmark.outperformance,
    maxDrawdown: computeMaxDrawdown(equityCurve),
    turnover: tradedNotional / initialCash,
    fillCount,
    rejectionCount,
    feesPaid,
    spreadCost,
    slippageCost,
    totalTradingCost: feesPaid + spreadCost + slippageCost
  });

  return Object.freeze({
    metrics,
    decisions: Object.freeze(decisions),
    equityCurve: Object.freeze(equityCurve),
    trades: matched.trades,
    performance,
    equityAnalytics,
    benchmark,
    openPosition: matched.openPosition,
    finalPaperState: broker.exportState()
  });
}
