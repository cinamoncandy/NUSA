import type { MarketTick, StrategyContext, StrategySignal, TradingStrategy } from "../../desktop/src/strategyEngine";
import { EmaIndicator } from "./pipeline/emaIndicator";

/**
 * EMA crossover, implementing the same TradingStrategy interface SmaCrossoverStrategy
 * (apps/desktop/src/strategyEngine.ts) already implements, so StrategyEngine can run
 * either one interchangeably via setStrategy(). Addresses the "EMA 없음" gap: this repo
 * previously had only the SMA crossover strategy.
 *
 * Composed from two independent EmaIndicator instances (the "Indicator(EMA)" pipeline
 * stage) -- this class's own job is only crossover detection (spread sign crossing zero),
 * identical to SmaCrossoverStrategy's logic so the two are directly comparable; only the
 * moving-average formula each indicator uses differs.
 */
export class EmaCrossoverStrategy implements TradingStrategy {
  readonly id = "ema-crossover";
  readonly name = "EMA Crossover";
  private previousSpread?: number;
  private readonly shortIndicator: EmaIndicator;
  private readonly longIndicator: EmaIndicator;

  constructor(private readonly shortPeriod = 5, private readonly longPeriod = 20) {
    if (!Number.isInteger(shortPeriod) || !Number.isInteger(longPeriod) || shortPeriod < 2 || longPeriod <= shortPeriod) {
      throw new Error("invalid EMA periods");
    }
    this.shortIndicator = new EmaIndicator(shortPeriod);
    this.longIndicator = new EmaIndicator(longPeriod);
  }

  onTick(tick: MarketTick, context: StrategyContext): StrategySignal {
    const priorCount = context.prices.length;
    const shortEma = this.shortIndicator.update(tick.price);
    const longEma = this.longIndicator.update(tick.price);

    if (priorCount + 1 < this.longPeriod) {
      return { type: "HOLD", reason: "warming-up", confidence: 0, timestamp: tick.timestamp };
    }
    const spread = shortEma - longEma;
    const prior = this.previousSpread;
    this.previousSpread = spread;
    if (prior == null) return { type: "HOLD", reason: "baseline-established", confidence: 0, timestamp: tick.timestamp };
    if (prior <= 0 && spread > 0) return { type: "BUY", reason: "short-EMA crossed above long-EMA", confidence: Math.min(1, Math.abs(spread) / longEma), timestamp: tick.timestamp };
    if (prior >= 0 && spread < 0) return { type: "SELL", reason: "short-EMA crossed below long-EMA", confidence: Math.min(1, Math.abs(spread) / longEma), timestamp: tick.timestamp };
    return { type: "HOLD", reason: "no-cross", confidence: Math.min(1, Math.abs(spread) / longEma), timestamp: tick.timestamp };
  }

  reset(): void {
    this.previousSpread = undefined;
    this.shortIndicator.reset();
    this.longIndicator.reset();
  }
}
