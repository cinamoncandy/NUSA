import type { BacktestPoint } from "./backtestEngine";
import { StrategyEngine, type StrategySignal, type TradingStrategy } from "./strategyEngine";

export interface SignalStabilityConfig {
  readonly startOffsets: readonly number[];
  readonly stabilizationPoints: number;
  readonly minimumComparisons: number;
  readonly market?: string;
}

export interface SignalStabilityMismatch {
  readonly offset: number;
  readonly timestamp: number;
  readonly baselineType: StrategySignal["type"];
  readonly comparisonType: StrategySignal["type"];
}

export interface SignalStabilityResult {
  readonly stable: boolean;
  readonly deterministicReplay: boolean;
  readonly comparisonCount: number;
  readonly mismatches: readonly SignalStabilityMismatch[];
  readonly warnings: readonly string[];
}

const replay = (points: readonly BacktestPoint[], factory: () => TradingStrategy, market: string): readonly StrategySignal[] => {
  const engine = new StrategyEngine(factory());
  engine.start();
  return Object.freeze(points.map((point) => Object.freeze(engine.onTick({ market, price: point.close, timestamp: point.timestamp }, 0))));
};

export function analyzeSignalStability(
  points: readonly BacktestPoint[],
  factory: () => TradingStrategy,
  config: SignalStabilityConfig
): SignalStabilityResult {
  if (points.length === 0) throw new Error("signal stability requires points");
  if (!Number.isInteger(config.stabilizationPoints) || config.stabilizationPoints < 0 || !Number.isInteger(config.minimumComparisons) || config.minimumComparisons <= 0) throw new Error("signal stability config is invalid");
  const offsets = [...new Set(config.startOffsets)].sort((a, b) => a - b);
  if (offsets.some((offset) => !Number.isInteger(offset) || offset <= 0 || offset >= points.length)) throw new Error("signal stability offset is invalid");
  for (let index = 0; index < points.length; index += 1) {
    const point = points[index];
    if (!Number.isFinite(point.close) || point.close <= 0 || !Number.isSafeInteger(point.timestamp) || (index > 0 && point.timestamp <= points[index - 1].timestamp)) throw new Error("signal stability points are invalid");
  }

  const market = config.market ?? "RESEARCH";
  const first = replay(points, factory, market);
  const second = replay(points, factory, market);
  const deterministicReplay = JSON.stringify(first) === JSON.stringify(second);
  const baseline = new Map(first.map((signal) => [signal.timestamp, signal]));
  const mismatches: SignalStabilityMismatch[] = [];
  let comparisonCount = 0;

  for (const offset of offsets) {
    const comparison = replay(points.slice(offset), factory, market);
    for (let index = config.stabilizationPoints; index < comparison.length; index += 1) {
      const signal = comparison[index];
      const expected = baseline.get(signal.timestamp)!;
      comparisonCount += 1;
      if (expected.type !== signal.type) mismatches.push(Object.freeze({ offset, timestamp: signal.timestamp, baselineType: expected.type, comparisonType: signal.type }));
    }
  }

  const warnings: string[] = [];
  if (!deterministicReplay) warnings.push("NON_DETERMINISTIC_REPLAY");
  if (mismatches.length > 0) warnings.push("WARMUP_SENSITIVE_SIGNALS");
  if (comparisonCount < config.minimumComparisons) warnings.push("INSUFFICIENT_SIGNAL_COMPARISONS");
  return Object.freeze({
    stable: deterministicReplay && mismatches.length === 0 && comparisonCount >= config.minimumComparisons,
    deterministicReplay,
    comparisonCount,
    mismatches: Object.freeze(mismatches),
    warnings: Object.freeze(warnings.sort())
  });
}
