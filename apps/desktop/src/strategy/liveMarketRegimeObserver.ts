import type { UpbitTicker } from "../exchange/upbitWebSocket";

export type ObservedLiveMarketRegime = "UP_TREND" | "RANGE" | "DOWN_TREND";

export interface LiveMarketRegimeObserverConfig {
  readonly minimumValidTicks: number;
  readonly trendThreshold: number;
}

const DEFAULT_CONFIG: LiveMarketRegimeObserverConfig = Object.freeze({
  minimumValidTicks: 20,
  trendThreshold: 0.02
});

export class LiveMarketRegimeObserver {
  private validTicks = 0;
  private readonly recorded = new Set<ObservedLiveMarketRegime>();

  public constructor(private readonly config: LiveMarketRegimeObserverConfig = DEFAULT_CONFIG) {
    if (!Number.isSafeInteger(config.minimumValidTicks) || config.minimumValidTicks <= 0) {
      throw new Error("minimumValidTicks must be a positive safe integer");
    }
    if (!Number.isFinite(config.trendThreshold) || config.trendThreshold <= 0) {
      throw new Error("trendThreshold must be positive and finite");
    }
  }

  public observe(ticker: Pick<UpbitTicker, "signed_change_rate">): ObservedLiveMarketRegime | undefined {
    const changeRate = ticker.signed_change_rate;
    if (changeRate == null || !Number.isFinite(changeRate)) return undefined;
    this.validTicks += 1;
    if (this.validTicks < this.config.minimumValidTicks) return undefined;

    const regime: ObservedLiveMarketRegime = changeRate > this.config.trendThreshold
      ? "UP_TREND"
      : changeRate < -this.config.trendThreshold
        ? "DOWN_TREND"
        : "RANGE";
    if (this.recorded.has(regime)) return undefined;
    this.recorded.add(regime);
    return regime;
  }
}
