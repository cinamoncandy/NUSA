import type {
  FundingPersistencePosition,
  FundingPersistenceStrategyDecision
} from "./FundingPersistenceStrategy";

export interface FundingPersistenceBacktestCandle {
  readonly candleId: string;
  readonly market: string;
  readonly openTime: string;
  readonly closeTime: string;
  readonly open: number;
  readonly high: number;
  readonly low: number;
  readonly close: number;
  readonly fundingRate: number;
}

export interface FundingPersistenceBacktestPolicy {
  readonly engineVersion: number;
  readonly initialCapital: number;
  readonly allocationFraction: number;
  readonly takerFeeRate: number;
  readonly slippageRate: number;
  readonly borrowRatePerCandle: number;
  readonly periodsPerYear: number;
  readonly closeOpenPositionAtEnd: boolean;
}

export interface FundingPersistenceFill {
  readonly fillId: string;
  readonly decisionId: string;
  readonly candleId: string;
  readonly executedAt: string;
  readonly action: "ENTER_LONG" | "ENTER_SHORT" | "EXIT" | "REVERSE_TO_LONG" | "REVERSE_TO_SHORT" | "FORCED_EXIT";
  readonly previousPosition: FundingPersistencePosition;
  readonly nextPosition: FundingPersistencePosition;
  readonly executionPrice: number;
  readonly quantity: number;
  readonly notional: number;
  readonly fee: number;
  readonly slippageCost: number;
  readonly realizedPnl: number;
}

export interface FundingPersistenceClosedTrade {
  readonly tradeId: string;
  readonly side: "LONG" | "SHORT";
  readonly entryAt: string;
  readonly exitAt: string;
  readonly entryPrice: number;
  readonly exitPrice: number;
  readonly quantity: number;
  readonly grossPnl: number;
  readonly fees: number;
  readonly fundingPnl: number;
  readonly borrowCost: number;
  readonly netPnl: number;
  readonly returnOnAllocatedCapital: number;
}

export interface FundingPersistenceEquityPoint {
  readonly candleId: string;
  readonly closeTime: string;
  readonly cash: number;
  readonly unrealizedPnl: number;
  readonly equity: number;
  readonly drawdown: number;
  readonly position: FundingPersistencePosition;
}

export interface FundingPersistenceBacktestMetrics {
  readonly totalReturn: number;
  readonly cagr: number;
  readonly annualizedVolatility: number;
  readonly sharpe: number;
  readonly sortino: number;
  readonly calmar: number;
  readonly maximumDrawdown: number;
  readonly winRate: number;
  readonly profitFactor: number;
  readonly expectancy: number;
  readonly recoveryFactor: number;
  readonly turnover: number;
  readonly exposure: number;
  readonly closedTrades: number;
}

export interface FundingPersistenceBacktestResult {
  readonly engineVersion: number;
  readonly market: string;
  readonly startedAt: string;
  readonly endedAt: string;
  readonly initialCapital: number;
  readonly finalEquity: number;
  readonly fills: readonly FundingPersistenceFill[];
  readonly trades: readonly FundingPersistenceClosedTrade[];
  readonly equityCurve: readonly FundingPersistenceEquityPoint[];
  readonly metrics: FundingPersistenceBacktestMetrics;
  readonly audit: readonly string[];
}

interface OpenTradeState {
  side: "LONG" | "SHORT";
  entryAt: string;
  entryPrice: number;
  quantity: number;
  allocatedCapital: number;
  entryFee: number;
  fundingPnl: number;
  borrowCost: number;
}

const round = (value: number): number => Math.round(value * 1_000_000_000) / 1_000_000_000;
const finite = (value: number, label: string): void => {
  if (!Number.isFinite(value)) throw new Error(`${label} must be finite`);
};
const parseTime = (value: string, label: string): number => {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) throw new Error(`${label} must be a valid ISO timestamp`);
  return timestamp;
};
const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));

const validatePolicy = (policy: FundingPersistenceBacktestPolicy): void => {
  if (!Number.isInteger(policy.engineVersion) || policy.engineVersion < 1) throw new Error("engineVersion must be a positive integer");
  for (const [label, value] of [
    ["initialCapital", policy.initialCapital],
    ["allocationFraction", policy.allocationFraction],
    ["takerFeeRate", policy.takerFeeRate],
    ["slippageRate", policy.slippageRate],
    ["borrowRatePerCandle", policy.borrowRatePerCandle],
    ["periodsPerYear", policy.periodsPerYear]
  ] as const) finite(value, label);
  if (policy.initialCapital <= 0) throw new Error("initialCapital must be positive");
  if (policy.allocationFraction <= 0 || policy.allocationFraction > 1) throw new Error("allocationFraction must be in (0, 1]");
  if (policy.takerFeeRate < 0 || policy.slippageRate < 0 || policy.borrowRatePerCandle < 0) throw new Error("cost rates must be non-negative");
  if (policy.periodsPerYear <= 0) throw new Error("periodsPerYear must be positive");
};

const validateInputs = (
  candles: readonly FundingPersistenceBacktestCandle[],
  decisions: readonly FundingPersistenceStrategyDecision[]
): string => {
  if (candles.length < 2) throw new Error("at least two candles are required");
  const candleIds = new Set<string>();
  const market = candles[0]?.market ?? "";
  if (!market.trim()) throw new Error("market is required");
  let previousClose = -Infinity;
  for (const candle of candles) {
    if (!candle.candleId.trim()) throw new Error("candleId is required");
    if (candleIds.has(candle.candleId)) throw new Error(`duplicate candle ${candle.candleId}`);
    candleIds.add(candle.candleId);
    if (candle.market !== market) throw new Error("candles must have one market");
    const openTime = parseTime(candle.openTime, `${candle.candleId}.openTime`);
    const closeTime = parseTime(candle.closeTime, `${candle.candleId}.closeTime`);
    if (closeTime <= openTime) throw new Error("candle closeTime must follow openTime");
    if (openTime < previousClose) throw new Error("candles must be non-overlapping and chronological");
    previousClose = closeTime;
    for (const [label, value] of [["open", candle.open], ["high", candle.high], ["low", candle.low], ["close", candle.close], ["fundingRate", candle.fundingRate]] as const) finite(value, `${candle.candleId}.${label}`);
    if (candle.open <= 0 || candle.high <= 0 || candle.low <= 0 || candle.close <= 0) throw new Error("candle prices must be positive");
    if (candle.high < Math.max(candle.open, candle.close) || candle.low > Math.min(candle.open, candle.close) || candle.high < candle.low) throw new Error("invalid OHLC bounds");
  }
  const decisionIds = new Set<string>();
  let previousDecision = -Infinity;
  for (const decision of decisions) {
    if (decisionIds.has(decision.decisionId)) throw new Error(`duplicate decision ${decision.decisionId}`);
    decisionIds.add(decision.decisionId);
    if (decision.market !== market) throw new Error("decision market does not match candles");
    const generatedAt = parseTime(decision.generatedAt, `${decision.decisionId}.generatedAt`);
    if (generatedAt < previousDecision) throw new Error("decisions must be chronological");
    previousDecision = generatedAt;
  }
  return market;
};

const executionPrice = (open: number, side: "BUY" | "SELL", slippageRate: number): number =>
  round(side === "BUY" ? open * (1 + slippageRate) : open * (1 - slippageRate));

const standardDeviation = (values: readonly number[]): number => {
  if (values.length < 2) return 0;
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  return Math.sqrt(values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length);
};

const calculateMetrics = (
  initialCapital: number,
  equityCurve: readonly FundingPersistenceEquityPoint[],
  trades: readonly FundingPersistenceClosedTrade[],
  turnoverNotional: number,
  exposedPeriods: number,
  policy: FundingPersistenceBacktestPolicy
): FundingPersistenceBacktestMetrics => {
  const finalEquity = equityCurve.at(-1)?.equity ?? initialCapital;
  const periodReturns: number[] = [];
  for (let index = 1; index < equityCurve.length; index += 1) {
    const previous = equityCurve[index - 1]?.equity ?? initialCapital;
    const current = equityCurve[index]?.equity ?? previous;
    periodReturns.push(previous === 0 ? 0 : current / previous - 1);
  }
  const mean = periodReturns.length === 0 ? 0 : periodReturns.reduce((sum, value) => sum + value, 0) / periodReturns.length;
  const volatility = standardDeviation(periodReturns);
  const downside = periodReturns.filter((value) => value < 0);
  const downsideDeviation = standardDeviation(downside);
  const annualizer = Math.sqrt(policy.periodsPerYear);
  const totalReturn = finalEquity / initialCapital - 1;
  const years = Math.max(1 / policy.periodsPerYear, equityCurve.length / policy.periodsPerYear);
  const cagr = finalEquity > 0 ? (finalEquity / initialCapital) ** (1 / years) - 1 : -1;
  const maxDrawdown = equityCurve.reduce((max, point) => Math.max(max, point.drawdown), 0);
  const winners = trades.filter((trade) => trade.netPnl > 0);
  const grossProfit = winners.reduce((sum, trade) => sum + trade.netPnl, 0);
  const grossLoss = Math.abs(trades.filter((trade) => trade.netPnl < 0).reduce((sum, trade) => sum + trade.netPnl, 0));
  const netProfit = trades.reduce((sum, trade) => sum + trade.netPnl, 0);
  return Object.freeze({
    totalReturn: round(totalReturn),
    cagr: round(cagr),
    annualizedVolatility: round(volatility * annualizer),
    sharpe: round(volatility === 0 ? 0 : (mean / volatility) * annualizer),
    sortino: round(downsideDeviation === 0 ? 0 : (mean / downsideDeviation) * annualizer),
    calmar: round(maxDrawdown === 0 ? 0 : cagr / maxDrawdown),
    maximumDrawdown: round(maxDrawdown),
    winRate: round(trades.length === 0 ? 0 : winners.length / trades.length),
    profitFactor: round(grossLoss === 0 ? (grossProfit > 0 ? Number.MAX_SAFE_INTEGER : 0) : grossProfit / grossLoss),
    expectancy: round(trades.length === 0 ? 0 : netProfit / trades.length),
    recoveryFactor: round(maxDrawdown === 0 ? 0 : netProfit / (initialCapital * maxDrawdown)),
    turnover: round(turnoverNotional / initialCapital),
    exposure: round(equityCurve.length === 0 ? 0 : exposedPeriods / equityCurve.length),
    closedTrades: trades.length
  });
};

export const runFundingPersistenceBacktest = (
  candles: readonly FundingPersistenceBacktestCandle[],
  decisions: readonly FundingPersistenceStrategyDecision[],
  policy: FundingPersistenceBacktestPolicy
): FundingPersistenceBacktestResult => {
  validatePolicy(policy);
  const market = validateInputs(candles, decisions);
  const fills: FundingPersistenceFill[] = [];
  const trades: FundingPersistenceClosedTrade[] = [];
  const equityCurve: FundingPersistenceEquityPoint[] = [];
  const audit: string[] = [];
  const pending = [...decisions];
  let nextDecisionIndex = 0;
  let cash = policy.initialCapital;
  let position: FundingPersistencePosition = "FLAT";
  let openTrade: OpenTradeState | null = null;
  let peakEquity = policy.initialCapital;
  let turnoverNotional = 0;
  let exposedPeriods = 0;

  const closePosition = (
    candle: FundingPersistenceBacktestCandle,
    decisionId: string,
    forced: boolean
  ): void => {
    if (!openTrade || position === "FLAT") return;
    const side = position === "LONG" ? "SELL" : "BUY";
    const price = executionPrice(candle.open, side, policy.slippageRate);
    const exitNotional = price * openTrade.quantity;
    const exitFee = exitNotional * policy.takerFeeRate;
    const grossPnl = position === "LONG"
      ? (price - openTrade.entryPrice) * openTrade.quantity
      : (openTrade.entryPrice - price) * openTrade.quantity;
    const netPnl = grossPnl - openTrade.entryFee - exitFee + openTrade.fundingPnl - openTrade.borrowCost;
    cash += grossPnl - exitFee + openTrade.fundingPnl - openTrade.borrowCost;
    turnoverNotional += exitNotional;
    const trade: FundingPersistenceClosedTrade = Object.freeze({
      tradeId: `TRADE-${trades.length + 1}`,
      side: openTrade.side,
      entryAt: openTrade.entryAt,
      exitAt: candle.openTime,
      entryPrice: round(openTrade.entryPrice),
      exitPrice: round(price),
      quantity: round(openTrade.quantity),
      grossPnl: round(grossPnl),
      fees: round(openTrade.entryFee + exitFee),
      fundingPnl: round(openTrade.fundingPnl),
      borrowCost: round(openTrade.borrowCost),
      netPnl: round(netPnl),
      returnOnAllocatedCapital: round(openTrade.allocatedCapital === 0 ? 0 : netPnl / openTrade.allocatedCapital)
    });
    trades.push(trade);
    fills.push(Object.freeze({
      fillId: `FILL-${fills.length + 1}`,
      decisionId,
      candleId: candle.candleId,
      executedAt: candle.openTime,
      action: forced ? "FORCED_EXIT" : "EXIT",
      previousPosition: position,
      nextPosition: "FLAT",
      executionPrice: price,
      quantity: round(openTrade.quantity),
      notional: round(exitNotional),
      fee: round(exitFee),
      slippageCost: round(Math.abs(price - candle.open) * openTrade.quantity),
      realizedPnl: round(netPnl)
    }));
    audit.push(`${candle.openTime}|${decisionId}|CLOSE_${position}|${round(netPnl)}`);
    position = "FLAT";
    openTrade = null;
  };

  const openPosition = (
    candle: FundingPersistenceBacktestCandle,
    decision: FundingPersistenceStrategyDecision,
    target: "LONG" | "SHORT"
  ): void => {
    const side = target === "LONG" ? "BUY" : "SELL";
    const price = executionPrice(candle.open, side, policy.slippageRate);
    const allocatedCapital = Math.max(0, cash * policy.allocationFraction);
    const quantity = allocatedCapital / price;
    const notional = price * quantity;
    const fee = notional * policy.takerFeeRate;
    if (quantity <= 0 || !Number.isFinite(quantity)) throw new Error("invalid entry quantity");
    if (cash - fee < 0) throw new Error("fees would make cash negative");
    cash -= fee;
    turnoverNotional += notional;
    position = target;
    openTrade = {
      side: target,
      entryAt: candle.openTime,
      entryPrice: price,
      quantity,
      allocatedCapital,
      entryFee: fee,
      fundingPnl: 0,
      borrowCost: 0
    };
    fills.push(Object.freeze({
      fillId: `FILL-${fills.length + 1}`,
      decisionId: decision.decisionId,
      candleId: candle.candleId,
      executedAt: candle.openTime,
      action: target === "LONG" ? "ENTER_LONG" : "ENTER_SHORT",
      previousPosition: "FLAT",
      nextPosition: target,
      executionPrice: price,
      quantity: round(quantity),
      notional: round(notional),
      fee: round(fee),
      slippageCost: round(Math.abs(price - candle.open) * quantity),
      realizedPnl: 0
    }));
    audit.push(`${candle.openTime}|${decision.decisionId}|OPEN_${target}|${round(price)}`);
  };

  for (let candleIndex = 0; candleIndex < candles.length; candleIndex += 1) {
    const candle = candles[candleIndex];
    if (!candle) throw new Error("candle invariant violated");
    const openTime = parseTime(candle.openTime, "openTime");
    const eligibleDecisions: FundingPersistenceStrategyDecision[] = [];
    while (nextDecisionIndex < pending.length) {
      const decision = pending[nextDecisionIndex];
      if (!decision) break;
      const generated = parseTime(decision.generatedAt, `${decision.decisionId}.generatedAt`);
      if (generated >= openTime) break;
      eligibleDecisions.push(decision);
      nextDecisionIndex += 1;
    }
    const decision = eligibleDecisions.at(-1);
    if (decision) {
      if (decision.action === "EXIT" && position !== "FLAT") closePosition(candle, decision.decisionId, false);
      else if (decision.action === "ENTER_LONG" || decision.action === "ENTER_SHORT") {
        const target = decision.action === "ENTER_LONG" ? "LONG" : "SHORT";
        if (position !== target) {
          if (position !== "FLAT") closePosition(candle, decision.decisionId, false);
          openPosition(candle, decision, target);
        }
      }
    }

    if (openTrade && position !== "FLAT") {
      exposedPeriods += 1;
      const notionalAtClose = candle.close * openTrade.quantity;
      const fundingCashFlow = position === "LONG"
        ? -notionalAtClose * candle.fundingRate
        : notionalAtClose * candle.fundingRate;
      openTrade.fundingPnl += fundingCashFlow;
      if (position === "SHORT") openTrade.borrowCost += notionalAtClose * policy.borrowRatePerCandle;
    }

    const unrealizedPnl = !openTrade || position === "FLAT" ? 0 : position === "LONG"
      ? (candle.close - openTrade.entryPrice) * openTrade.quantity + openTrade.fundingPnl - openTrade.borrowCost
      : (openTrade.entryPrice - candle.close) * openTrade.quantity + openTrade.fundingPnl - openTrade.borrowCost;
    const equity = cash + unrealizedPnl;
    finite(equity, "equity");
    if (equity < 0) throw new Error("equity became negative");
    peakEquity = Math.max(peakEquity, equity);
    const drawdown = peakEquity === 0 ? 0 : (peakEquity - equity) / peakEquity;
    equityCurve.push(Object.freeze({
      candleId: candle.candleId,
      closeTime: candle.closeTime,
      cash: round(cash),
      unrealizedPnl: round(unrealizedPnl),
      equity: round(equity),
      drawdown: round(clamp01(drawdown)),
      position
    }));
  }

  if (openTrade && policy.closeOpenPositionAtEnd) {
    const last = candles.at(-1);
    if (!last) throw new Error("last candle missing");
    const synthetic: FundingPersistenceBacktestCandle = { ...last, openTime: last.closeTime, open: last.close };
    closePosition(synthetic, "FORCED-END", true);
    const finalPoint = equityCurve.at(-1);
    if (finalPoint) {
      const equity = cash;
      peakEquity = Math.max(peakEquity, equity);
      equityCurve[equityCurve.length - 1] = Object.freeze({
        ...finalPoint,
        cash: round(cash),
        unrealizedPnl: 0,
        equity: round(equity),
        drawdown: round(peakEquity === 0 ? 0 : clamp01((peakEquity - equity) / peakEquity)),
        position: "FLAT"
      });
    }
  }

  for (const item of fills) Object.freeze(item);
  for (const item of trades) Object.freeze(item);
  for (const item of equityCurve) Object.freeze(item);
  const metrics = calculateMetrics(policy.initialCapital, equityCurve, trades, turnoverNotional, exposedPeriods, policy);
  const result: FundingPersistenceBacktestResult = {
    engineVersion: policy.engineVersion,
    market,
    startedAt: candles[0]?.openTime ?? "",
    endedAt: candles.at(-1)?.closeTime ?? "",
    initialCapital: round(policy.initialCapital),
    finalEquity: round(equityCurve.at(-1)?.equity ?? policy.initialCapital),
    fills: Object.freeze(fills),
    trades: Object.freeze(trades),
    equityCurve: Object.freeze(equityCurve),
    metrics,
    audit: Object.freeze(audit)
  };
  Object.freeze(result.metrics);
  Object.freeze(result.audit);
  return Object.freeze(result);
};
