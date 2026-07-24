import type { MarketTick, StrategyContext, StrategySignal, TradingStrategy } from "../../desktop/src/strategyEngine";

/**
 * EMA crossover, implementing the same TradingStrategy interface SmaCrossoverStrategy
 * (apps/desktop/src/strategyEngine.ts) already implements, so StrategyEngine can run
 * either one interchangeably via setStrategy(). Addresses the "EMA 없음" gap: this repo
 * previously had only the SMA crossover strategy.
 *
 * EMA reacts faster to recent prices than SMA (each new price is weighted by a smoothing
 * factor alpha = 2 / (period + 1), rather than every price in the window counting equally).
 * Signal logic (spread sign crossing zero) mirrors SmaCrossoverStrategy exactly so the two
 * are directly comparable -- only the moving-average formula differs.
 */
export class EmaCrossoverStrategy implements TradingStrategy {
  readonly id = "ema-crossover";
  readonly name = "EMA Crossover";
  private previousSpread?: number;
  private shortEma?: number;
  private longEma?: number;
  private readonly shortAlpha: number;
  private readonly longAlpha: number;

  constructor(private readonly shortPeriod = 5, private readonly longPeriod = 20) {
    if (!Number.isInteger(shortPeriod) || !Number.isInteger(longPeriod) || shortPeriod < 2 || longPeriod <= shortPeriod) {
      throw new Error("invalid EMA periods");
    }
    this.shortAlpha = 2 / (shortPeriod + 1);
    this.longAlpha = 2 / (longPeriod + 1);
  }

  onTick(tick: MarketTick, context: StrategyContext): StrategySignal {
    const priorCount = context.prices.length;
    this.shortEma = this.shortEma === undefined ? tick.price : this.shortEma + this.shortAlpha * (tick.price - this.shortEma);
    this.longEma = this.longEma === undefined ? tick.price : this.longEma + this.longAlpha * (tick.price - this.longEma);

    if (priorCount + 1 < this.longPeriod) {
      return { type: "HOLD", reason: "warming-up", confidence: 0, timestamp: tick.timestamp };
    }
    const spread = this.shortEma - this.longEma;
    const prior = this.previousSpread;
    this.previousSpread = spread;
    if (prior == null) return { type: "HOLD", reason: "baseline-established", confidence: 0, timestamp: tick.timestamp };
    if (prior <= 0 && spread > 0) return { type: "BUY", reason: "short-EMA crossed above long-EMA", confidence: Math.min(1, Math.abs(spread) / this.longEma), timestamp: tick.timestamp };
    if (prior >= 0 && spread < 0) return { type: "SELL", reason: "short-EMA crossed below long-EMA", confidence: Math.min(1, Math.abs(spread) / this.longEma), timestamp: tick.timestamp };
    return { type: "HOLD", reason: "no-cross", confidence: Math.min(1, Math.abs(spread) / this.longEma), timestamp: tick.timestamp };
  }

  reset(): void {
    this.previousSpread = undefined;
    this.shortEma = undefined;
    this.longEma = undefined;
  }
}
