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

export class RsiMeanReversionStrategy implements TradingStrategy {
  readonly id = "rsi-mean-reversion";
  readonly name = "RSI Mean Reversion";
  private previousRsi?: number;

  constructor(
    private readonly period = 14,
    private readonly oversold = 30,
    private readonly overbought = 70,
  ) {
    if (!Number.isInteger(period) || period < 2) throw new Error("invalid RSI period");
    if (!(oversold > 0 && oversold < overbought && overbought < 100)) {
      throw new Error("invalid RSI thresholds");
    }
  }

  private rsi(closes: readonly number[]): number | undefined {
    if (closes.length < this.period + 1) return undefined;
    let gain = 0;
    let loss = 0;
    for (let index = 1; index <= this.period; index += 1) {
      const change = closes[index]! - closes[index - 1]!;
      if (change > 0) gain += change;
      else loss -= change;
    }
    gain /= this.period;
    loss /= this.period;
    for (let index = this.period + 1; index < closes.length; index += 1) {
      const change = closes[index]! - closes[index - 1]!;
      gain = (gain * (this.period - 1) + Math.max(0, change)) / this.period;
      loss = (loss * (this.period - 1) + Math.max(0, -change)) / this.period;
    }
    if (loss === 0) return gain === 0 ? 50 : 100;
    return 100 - 100 / (1 + gain / loss);
  }

  onTick(tick: MarketTick, context: StrategyContext): StrategySignal {
    const closes = [...context.prices, tick.price];
    const value = this.rsi(closes);
    if (value === undefined) {
      return { type: "HOLD", reason: "warming-up", confidence: 0, timestamp: tick.timestamp };
    }
    const prior = this.previousRsi;
    this.previousRsi = value;
    if (prior === undefined) {
      return { type: "HOLD", reason: "baseline-established", confidence: 0, timestamp: tick.timestamp };
    }
    const strength = Math.min(1, Math.abs(value - 50) / 50);
    if (prior <= this.oversold && value > this.oversold) {
      return { type: "BUY", reason: "rsi-recovered-from-oversold", confidence: strength, timestamp: tick.timestamp };
    }
    if (prior >= this.overbought && value < this.overbought) {
      return { type: "SELL", reason: "rsi-rejected-from-overbought", confidence: strength, timestamp: tick.timestamp };
    }
    return { type: "HOLD", reason: "rsi-no-signal", confidence: strength, timestamp: tick.timestamp };
  }

  reset(): void { this.previousRsi = undefined; }
}

export class BollingerBreakoutStrategy implements TradingStrategy {
  readonly id = "bollinger-breakout";
  readonly name = "Bollinger Breakout";
  private previousPosition?: -1 | 0 | 1;

  constructor(
    private readonly period = 20,
    private readonly multiplier = 2,
  ) {
    if (!Number.isInteger(period) || period < 2) throw new Error("invalid Bollinger period");
    if (!Number.isFinite(multiplier) || multiplier <= 0) throw new Error("invalid Bollinger multiplier");
  }

  onTick(tick: MarketTick, context: StrategyContext): StrategySignal {
    const closes = [...context.prices, tick.price];
    if (closes.length < this.period) {
      return { type: "HOLD", reason: "warming-up", confidence: 0, timestamp: tick.timestamp };
    }
    const window = closes.slice(-this.period);
    const mean = window.reduce((total, price) => total + price, 0) / window.length;
    const variance = window.reduce((total, price) => total + (price - mean) ** 2, 0) / window.length;
    const deviation = Math.sqrt(variance);
    const upper = mean + this.multiplier * deviation;
    const lower = mean - this.multiplier * deviation;
    const position = tick.price > upper ? 1 : tick.price < lower ? -1 : 0;
    const prior = this.previousPosition;
    this.previousPosition = position as -1 | 0 | 1;
    if (prior === undefined) {
      return { type: "HOLD", reason: "baseline-established", confidence: 0, timestamp: tick.timestamp };
    }
    if (prior <= 0 && position === 1) {
      const confidence = upper > 0 ? Math.min(1, (tick.price - upper) / upper) : 1;
      return { type: "BUY", reason: "close-broke-above-upper-band", confidence, timestamp: tick.timestamp };
    }
    if (prior >= 0 && position === -1) {
      const confidence = lower > 0 ? Math.min(1, (lower - tick.price) / lower) : 1;
      return { type: "SELL", reason: "close-broke-below-lower-band", confidence, timestamp: tick.timestamp };
    }
    return { type: "HOLD", reason: "band-ride", confidence: 0, timestamp: tick.timestamp };
  }

  reset(): void { this.previousPosition = undefined; }
}

export class MacdMomentumStrategy implements TradingStrategy {
  readonly id = "macd-momentum";
  readonly name = "MACD Momentum";
  private fastEma?: number;
  private slowEma?: number;
  private signalEma?: number;
  private previousSpread?: number;

  constructor(
    private readonly fastPeriod = 12,
    private readonly slowPeriod = 26,
    private readonly signalPeriod = 9,
  ) {
    for (const period of [fastPeriod, slowPeriod, signalPeriod]) {
      if (!Number.isInteger(period) || period < 2) throw new Error("invalid MACD period");
    }
    if (fastPeriod >= slowPeriod) throw new Error("invalid MACD periods");
  }

  onTick(tick: MarketTick, context: StrategyContext): StrategySignal {
    const closes = [...context.prices, tick.price];
    if (closes.length < this.slowPeriod + this.signalPeriod) {
      return { type: "HOLD", reason: "warming-up", confidence: 0, timestamp: tick.timestamp };
    }
    // Recursive Wilder-style EMAs seeded from the first observed close. State
    // is rebuilt deterministically from the same tick sequence, so replaying a
    // prefix always yields identical signals (no lookahead by construction).
    // Like SmaCrossoverStrategy.previousSpread, this internal state is
    // intentionally not restored by StrategyEngine.restoreHistory.
    const fastFactor = 2 / (this.fastPeriod + 1);
    const slowFactor = 2 / (this.slowPeriod + 1);
    const signalFactor = 2 / (this.signalPeriod + 1);
    this.fastEma = this.fastEma === undefined ? tick.price : tick.price * fastFactor + this.fastEma * (1 - fastFactor);
    this.slowEma = this.slowEma === undefined ? tick.price : tick.price * slowFactor + this.slowEma * (1 - slowFactor);
    const macd = this.fastEma - this.slowEma;
    this.signalEma = this.signalEma === undefined ? macd : macd * signalFactor + this.signalEma * (1 - signalFactor);
    const spread = macd - this.signalEma;
    const prior = this.previousSpread;
    this.previousSpread = spread;
    if (prior === undefined) {
      return { type: "HOLD", reason: "baseline-established", confidence: 0, timestamp: tick.timestamp };
    }
    const confidence = Math.min(1, Math.abs(spread) / (tick.price > 0 ? tick.price : 1));
    if (prior <= 0 && spread > 0) {
      return { type: "BUY", reason: "macd-crossed-above-signal", confidence, timestamp: tick.timestamp };
    }
    if (prior >= 0 && spread < 0) {
      return { type: "SELL", reason: "macd-crossed-below-signal", confidence, timestamp: tick.timestamp };
    }
    return { type: "HOLD", reason: "macd-no-cross", confidence, timestamp: tick.timestamp };
  }

  reset(): void {
    this.fastEma = undefined;
    this.slowEma = undefined;
    this.signalEma = undefined;
    this.previousSpread = undefined;
  }
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

