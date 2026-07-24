import { calculatePerformanceMetrics, type MatchedTrade, type PerformanceMetrics } from "./backtestAnalytics";
import type { MarketRegime, RegimeTimeline } from "./marketRegime";
import type { WalkForwardResult } from "./walkForwardEngine";

export type RegimeAttributionBasis = "ENTRY" | "EXIT";

export interface RegimeTradeAttribution {
  readonly trade: MatchedTrade;
  readonly entryRegime: MarketRegime;
  readonly exitRegime: MarketRegime;
}

export interface RegimePerformanceBucket {
  readonly regimeKey: string;
  readonly trades: readonly MatchedTrade[];
  readonly performance: PerformanceMetrics;
  readonly profitableTradeRatio: number;
  readonly averageHoldingTime?: number;
}

export interface RegimeOosAttributionResult {
  readonly basis: RegimeAttributionBasis;
  readonly attributedTrades: readonly RegimeTradeAttribution[];
  readonly buckets: readonly RegimePerformanceBucket[];
  readonly unattributedTradeCount: number;
  readonly warnings: readonly string[];
}

const freeze = <T>(value: T): Readonly<T> => Object.freeze(value);

export function marketRegimeKey(regime: Pick<MarketRegime, "trend" | "volatility" | "liquidity">): string {
  return `${regime.trend}|${regime.volatility}|${regime.liquidity}`;
}

export function attributeWalkForwardOosByRegime(
  walkForward: WalkForwardResult,
  timeline: RegimeTimeline,
  basis: RegimeAttributionBasis = "ENTRY"
): RegimeOosAttributionResult {
  if (basis !== "ENTRY" && basis !== "EXIT") throw new Error("regime attribution basis must be ENTRY or EXIT");
  const byTimestamp = new Map<number, MarketRegime>();
  for (const entry of timeline.points) {
    if (byTimestamp.has(entry.point.timestamp)) throw new Error("regime timeline contains duplicate timestamps");
    byTimestamp.set(entry.point.timestamp, entry.regime);
  }

  const attributed: RegimeTradeAttribution[] = [];
  let unattributedTradeCount = 0;
  for (const window of walkForward.windows) {
    for (const trade of window.testResult.trades) {
      const entryRegime = byTimestamp.get(trade.entryTime);
      const exitRegime = byTimestamp.get(trade.exitTime);
      if (entryRegime == null || exitRegime == null) {
        unattributedTradeCount += 1;
        continue;
      }
      attributed.push(freeze({ trade, entryRegime, exitRegime }));
    }
  }

  const grouped = new Map<string, MatchedTrade[]>();
  for (const item of attributed) {
    const regime = basis === "ENTRY" ? item.entryRegime : item.exitRegime;
    const key = marketRegimeKey(regime);
    const trades = grouped.get(key) ?? [];
    trades.push(item.trade);
    grouped.set(key, trades);
  }

  const buckets = [...grouped.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([regimeKey, trades]) => {
      const frozenTrades = Object.freeze([...trades]);
      const performance = calculatePerformanceMetrics(frozenTrades, 0);
      return freeze({
        regimeKey,
        trades: frozenTrades,
        performance,
        profitableTradeRatio: trades.length === 0 ? 0 : trades.filter((trade) => trade.netPnL > 0).length / trades.length,
        averageHoldingTime: performance.averageHoldingTime
      });
    });

  const warnings: string[] = [];
  if (unattributedTradeCount > 0) warnings.push("UNATTRIBUTED_TRADES");
  if (attributed.length === 0) warnings.push("NO_ATTRIBUTED_OOS_TRADES");
  if (buckets.some((bucket) => bucket.trades.length < 3)) warnings.push("SPARSE_REGIME_SAMPLE");
  if (buckets.length === 1 && attributed.length > 0) warnings.push("SINGLE_REGIME_DOMINATES");

  return freeze({
    basis,
    attributedTrades: Object.freeze(attributed),
    buckets: Object.freeze(buckets),
    unattributedTradeCount,
    warnings: Object.freeze(warnings)
  });
}
