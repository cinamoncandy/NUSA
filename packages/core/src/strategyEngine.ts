import { classifyPriceRegime, DEFAULT_REGIME_CONFIG, type TradingRegime } from "./regimePolicy";

export type StrategySignalType = "BUY" | "SELL" | "HOLD";

export interface MarketTick {
  market: string;
  price: number;
  timestamp: number;
}

export interface StrategySignal {
  type: StrategySignalType;
  reason: string;
  confidence: number;
  timestamp: number;
  regime?: TradingRegime;
}

export interface StrategyContext {
  readonly market: string;
  readonly prices: readonly number[];
  readonly positionQuantity: number;
}

export interface TradingStrategy {
  readonly id: string;
  readonly name: string;
  onTick(tick: MarketTick, context: StrategyContext): StrategySignal;
  reset(): void;
}

const averageLastIncludingTick = (prices: readonly number[], tickPrice: number, count: number): number => {
  const start = Math.max(0, prices.length - (count - 1));
  let total = 0;
  let length = 0;
  for (let index = start; index < prices.length; index += 1) {
    total += prices[index]!;
    length += 1;
  }
  total += tickPrice;
  return total / (length + 1);
};

export class SmaCrossoverStrategy implements TradingStrategy {
  readonly id = "sma-crossover";
  readonly name = "SMA Crossover";
  private previousSpread?: number;

  constructor(private readonly shortPeriod = 5, private readonly longPeriod = 20) {
    if (!Number.isInteger(shortPeriod) || !Number.isInteger(longPeriod) || shortPeriod < 2 || longPeriod <= shortPeriod) {
      throw new Error("invalid SMA periods");
    }
  }

  onTick(tick: MarketTick, context: StrategyContext): StrategySignal {
    const available = Math.min(this.longPeriod, context.prices.length + 1);
    if (available < this.longPeriod) {
      return { type: "HOLD", reason: "warming-up", confidence: 0, timestamp: tick.timestamp };
    }
    const short = averageLastIncludingTick(context.prices, tick.price, this.shortPeriod);
    const long = averageLastIncludingTick(context.prices, tick.price, this.longPeriod);
    const spread = short - long;
    const prior = this.previousSpread;
    this.previousSpread = spread;
    if (prior == null) return { type: "HOLD", reason: "baseline-established", confidence: 0, timestamp: tick.timestamp };
    if (prior <= 0 && spread > 0) return { type: "BUY", reason: "short-SMA crossed above long-SMA", confidence: Math.min(1, Math.abs(spread) / long), timestamp: tick.timestamp };
    if (prior >= 0 && spread < 0) return { type: "SELL", reason: "short-SMA crossed below long-SMA", confidence: Math.min(1, Math.abs(spread) / long), timestamp: tick.timestamp };
    return { type: "HOLD", reason: "no-cross", confidence: Math.min(1, Math.abs(spread) / long), timestamp: tick.timestamp };
  }

  reset(): void { this.previousSpread = undefined; }
}

export class StrategyEngine {
  private readonly prices: number[] = [];
  private readonly signalHistory: StrategySignal[] = [];
  private running = false;
  private latestSignal?: StrategySignal;
  private lastTickKey?: string;

  constructor(private strategy: TradingStrategy, private readonly maxHistory = 500, private readonly maxSignalHistory = 20) {}

  start(): void { this.running = true; }
  stop(): void { this.running = false; }
  isRunning(): boolean { return this.running; }
  getStrategyId(): string { return this.strategy.id; }
  restoreRunning(running: boolean): void { this.running = running; }
  /**
   * Restores tick price history after a restart so warm-up doesn't silently restart
   * from zero. Does not restore per-strategy internal state (e.g. SmaCrossoverStrategy's
   * previousSpread), which stays fresh: the first tick after restore establishes a new
   * baseline (HOLD), and ordinary crossover detection resumes from the second tick
   * onward rather than after a full requiredWarmupSamples wait.
   */
  restoreHistory(prices: readonly number[]): void {
    if (!prices.every((price) => Number.isFinite(price) && price > 0)) throw new Error("restored price history must contain only positive finite numbers");
    this.prices.length = 0;
    this.prices.push(...prices.slice(-this.maxHistory));
  }
  setStrategy(strategy: TradingStrategy): void { this.strategy = strategy; this.prices.length = 0; this.signalHistory.length = 0; this.latestSignal = undefined; this.lastTickKey = undefined; strategy.reset(); }
  getLatestSignal(): StrategySignal | undefined { return this.latestSignal; }
  getHistory(): readonly number[] { return [...this.prices]; }
  /** Recorded transitions only (type or reason changed from the prior entry), oldest to
   * newest, capped at maxSignalHistory -- most ticks re-confirm the same HOLD state, and a
   * buffer of "no-cross" repeats would drown out the handful of signals worth narrating. */
  getSignalHistory(): readonly StrategySignal[] { return [...this.signalHistory]; }

  onTick(tick: MarketTick, positionQuantity: number): StrategySignal {
    if (!Number.isFinite(tick.price) || tick.price <= 0) throw new Error("tick price must be positive");
    if (!Number.isSafeInteger(tick.timestamp) || tick.timestamp < 0) throw new Error("tick timestamp must be a non-negative integer");
    const tickKey = `${tick.market}:${tick.timestamp}:${tick.price}`;
    if (tickKey === this.lastTickKey && this.latestSignal !== undefined) return this.latestSignal;
    // classifyPriceRegime only ever reads its own trailing trendLookback+1 window
    // (see regimePolicy.ts), so copying the full up-to-maxHistory price buffer on every
    // tick just to have it re-sliced down internally was pure waste. Pre-trim to the
    // window it actually needs -- this.prices.slice(-N).concat(tick) has length
    // min(N, prices.length)+1, identical to what classifyPriceRegime would itself slice
    // out of the full array, so behavior is unchanged.
    const regime = classifyPriceRegime(this.prices.slice(-DEFAULT_REGIME_CONFIG.trendLookback).concat(tick.price), tick.timestamp);
    const signal = this.running
      ? this.strategy.onTick(tick, { market: tick.market, prices: this.prices, positionQuantity })
      : { type: "HOLD" as const, reason: "strategy-stopped", confidence: 0, timestamp: tick.timestamp };
    const signalWithRegime = regime === undefined ? signal : { ...signal, regime };
    this.prices.push(tick.price);
    if (this.prices.length > this.maxHistory) this.prices.splice(0, this.prices.length - this.maxHistory);
    const previous = this.signalHistory.at(-1);
    if (previous === undefined || previous.type !== signalWithRegime.type || previous.reason !== signalWithRegime.reason) {
      this.signalHistory.push(signalWithRegime);
      if (this.signalHistory.length > this.maxSignalHistory) this.signalHistory.splice(0, this.signalHistory.length - this.maxSignalHistory);
    }
    this.latestSignal = signalWithRegime;
    this.lastTickKey = tickKey;
    return signalWithRegime;
  }
}

