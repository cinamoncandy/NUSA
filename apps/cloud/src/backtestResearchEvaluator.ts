import type { ResearchEvaluation, ResearchEvaluationContext } from "../../../packages/contracts/src/researchRuntime";
import { runDslBacktest, type BacktestCandle } from "../../../packages/core/src/optimizer/aiBacktestEngine";
import { StrategyRegistry, validateStrategy, type GeneratedStrategy } from "../../../packages/core/src/optimizer/aiStrategyEngine";
import { candleChecksum } from "./closedCandleAggregator";

/**
 * Research evaluator over the deterministic DSL backtest engine. It is a research proxy: the DSL cannot express
 * every behaviour of the live PAPER strategy, so its results are labelled research evidence and never PAPER fills.
 *
 * The coordinator hands evaluators only close prices; the evaluator therefore reads the exact candles from the
 * durable candle store and refuses (throws, which the coordinator records as INCONCLUSIVE) unless they match the
 * input point for point. Fee, slippage and cash are explicit options; there are no defaults.
 */
export interface ResearchCandleRow {
  readonly closeTimeMs: number;
  readonly open: number;
  readonly high: number;
  readonly low: number;
  readonly close: number;
}

export interface ResearchCandleSource {
  read(market: string, intervalMs: number, fromCloseMs: number, toCloseMs: number): readonly ResearchCandleRow[];
}

export interface BacktestEvaluatorOptions<A extends "PAPER_ONLY" | "ZERO_AUTHORITY" = "PAPER_ONLY" | "ZERO_AUTHORITY"> {
  readonly strategyId: string;
  readonly strategyVersion: string;
  readonly authority: A;
  readonly evaluatorVersion: string;
  readonly strategy: GeneratedStrategy;
  readonly candles: ResearchCandleSource;
  readonly intervalMs: number;
  readonly backtest: { readonly initialCash: number; readonly feeRate: number; readonly slippageBps: number };
}

export class BacktestEvaluatorError extends Error {
  public constructor(readonly code: string, message: string) {
    super(message);
    this.name = "BacktestEvaluatorError";
  }
}

const fail = (code: string, message: string): never => { throw new BacktestEvaluatorError(code, message); };
const finiteOr = (value: number | null | undefined, fallback: number): number => (typeof value === "number" && Number.isFinite(value) ? value : fallback);

/** Builds a validated SMA-crossover research strategy (the DSL requires both a take-profit and a stop-loss exit). */
export function buildSmaResearchStrategy(input: {
  readonly strategyId: string;
  readonly version: string;
  readonly market: string;
  readonly fastPeriod: number;
  readonly slowPeriod: number;
  readonly takeProfitPercent: number;
  readonly stopLossPercent: number;
  readonly positionPercent: number;
  readonly maxPositionNotional: number;
}): GeneratedStrategy {
  const draft: GeneratedStrategy = {
    strategyId: input.strategyId,
    name: `SMA ${input.fastPeriod}/${input.slowPeriod} research proxy`,
    version: input.version,
    status: "VALIDATED",
    dsl: {
      entry: { type: "SMA_CROSSOVER", fastPeriod: input.fastPeriod, slowPeriod: input.slowPeriod, direction: "ABOVE" },
      exits: [{ type: "TAKE_PROFIT", percent: input.takeProfitPercent }, { type: "STOP_LOSS", percent: input.stopLossPercent }],
      risk: { positionSize: { mode: "PERCENT_OF_EQUITY", value: input.positionPercent }, maxRiskPercent: input.stopLossPercent, maxPositionNotional: input.maxPositionNotional },
      scope: { symbols: [input.market], regimes: ["ANY"] },
    },
    evidence: { sourceText: `research proxy ${input.strategyId}@${input.version}`, generationReasons: ["research:sma-crossover-proxy"] },
    createdAt: 1,
    paperOnly: true,
    productionMutationAllowed: false,
    executionAllowed: false,
  };
  const validated = validateStrategy(draft);
  if (validated.status !== "VALIDATED" || validated.strategy == null) return fail("STRATEGY_INVALID", `research strategy is invalid: ${validated.errors.join(",")}`);
  return validated.strategy;
}

/**
 * Builds a validated RSI mean-reversion research strategy: buy when RSI(period) falls below the threshold, exit on take-profit,
 * stop-loss or a time limit. A second strategy family next to the SMA crossover, expressed in the same DSL and backtest engine.
 */
export function buildRsiResearchStrategy(input: {
  readonly strategyId: string;
  readonly version: string;
  readonly market: string;
  readonly period: number;
  readonly threshold: number;
  readonly takeProfitPercent: number;
  readonly stopLossPercent: number;
  readonly timeoutMinutes: number;
  readonly positionPercent: number;
  readonly maxPositionNotional: number;
}): GeneratedStrategy {
  const draft: GeneratedStrategy = {
    strategyId: input.strategyId,
    name: `RSI ${input.period}<${input.threshold} research proxy`,
    version: input.version,
    status: "VALIDATED",
    dsl: {
      entry: { type: "RSI_THRESHOLD", period: input.period, operator: "BELOW", threshold: input.threshold },
      exits: [{ type: "TAKE_PROFIT", percent: input.takeProfitPercent }, { type: "STOP_LOSS", percent: input.stopLossPercent }, { type: "TIMEOUT", minutes: input.timeoutMinutes }],
      risk: { positionSize: { mode: "PERCENT_OF_EQUITY", value: input.positionPercent }, maxRiskPercent: input.stopLossPercent, maxPositionNotional: input.maxPositionNotional },
      scope: { symbols: [input.market], regimes: ["ANY"] },
    },
    evidence: { sourceText: `research proxy ${input.strategyId}@${input.version}`, generationReasons: ["research:rsi-mean-reversion-proxy"] },
    createdAt: 1,
    paperOnly: true,
    productionMutationAllowed: false,
    executionAllowed: false,
  };
  const validated = validateStrategy(draft);
  if (validated.status !== "VALIDATED" || validated.strategy == null) return fail("STRATEGY_INVALID", `research strategy is invalid: ${validated.errors.join(",")}`);
  return validated.strategy;
}

/**
 * Builds a validated Donchian breakout research strategy: buy when the close breaks above the highest high of the previous
 * `period` bars, exit on take-profit, stop-loss or a time limit. A third strategy family (momentum / breakout) next to the SMA
 * crossover and the RSI mean reversion, in the same DSL and backtest engine.
 */
export function buildDonchianResearchStrategy(input: {
  readonly strategyId: string;
  readonly version: string;
  readonly market: string;
  readonly period: number;
  readonly takeProfitPercent: number;
  readonly stopLossPercent: number;
  readonly timeoutMinutes: number;
  readonly positionPercent: number;
  readonly maxPositionNotional: number;
}): GeneratedStrategy {
  const draft: GeneratedStrategy = {
    strategyId: input.strategyId,
    name: `Donchian ${input.period} breakout research proxy`,
    version: input.version,
    status: "VALIDATED",
    dsl: {
      entry: { type: "DONCHIAN_BREAKOUT", period: input.period },
      exits: [{ type: "TAKE_PROFIT", percent: input.takeProfitPercent }, { type: "STOP_LOSS", percent: input.stopLossPercent }, { type: "TIMEOUT", minutes: input.timeoutMinutes }],
      risk: { positionSize: { mode: "PERCENT_OF_EQUITY", value: input.positionPercent }, maxRiskPercent: input.stopLossPercent, maxPositionNotional: input.maxPositionNotional },
      scope: { symbols: [input.market], regimes: ["ANY"] },
    },
    evidence: { sourceText: `research proxy ${input.strategyId}@${input.version}`, generationReasons: ["research:donchian-breakout-proxy"] },
    createdAt: 1,
    paperOnly: true,
    productionMutationAllowed: false,
    executionAllowed: false,
  };
  const validated = validateStrategy(draft);
  if (validated.status !== "VALIDATED" || validated.strategy == null) return fail("STRATEGY_INVALID", `research strategy is invalid: ${validated.errors.join(",")}`);
  return validated.strategy;
}

export class BacktestResearchEvaluator<A extends "PAPER_ONLY" | "ZERO_AUTHORITY" = "PAPER_ONLY" | "ZERO_AUTHORITY"> {
  public readonly strategyId: string;
  public readonly strategyVersion: string;
  public readonly authority: A;
  public readonly evaluatorVersion: string;

  public constructor(private readonly options: BacktestEvaluatorOptions<A>) {
    const { initialCash, feeRate, slippageBps } = options.backtest ?? {};
    if (!(typeof initialCash === "number" && Number.isFinite(initialCash) && initialCash > 0)) fail("INVALID_CONFIG", "initialCash must be explicit and positive");
    if (!(typeof feeRate === "number" && Number.isFinite(feeRate) && feeRate >= 0 && feeRate < 0.05)) fail("INVALID_CONFIG", "feeRate must be explicit and below 5%");
    if (!(typeof slippageBps === "number" && Number.isFinite(slippageBps) && slippageBps >= 0 && slippageBps <= 500)) fail("INVALID_CONFIG", "slippageBps must be explicit and at most 500");
    if (!Number.isSafeInteger(options.intervalMs) || options.intervalMs < 1_000) fail("INVALID_CONFIG", "interval is invalid");
    this.strategyId = options.strategyId;
    this.strategyVersion = options.strategyVersion;
    this.authority = options.authority;
    this.evaluatorVersion = options.evaluatorVersion;
  }

  public evaluate(context: ResearchEvaluationContext): ResearchEvaluation {
    const points = context.input.marketData;
    if (points.length === 0) return fail("NO_DATA", "input has no market data");
    const market = points[0]!.market;
    if (points.some((point) => point.market !== market)) return fail("MIXED_MARKETS", "input must contain a single market");
    const { intervalMs } = this.options;
    const first = points[0]!.observedAt;
    const last = points[points.length - 1]!.observedAt;
    const rows = this.options.candles.read(market, intervalMs, first, last);
    if (rows.length !== points.length) return fail("CANDLE_COUNT_MISMATCH", "stored candles do not match the input point for point");
    const candles: BacktestCandle[] = rows.map((row, index) => {
      const point = points[index]!;
      if (row.closeTimeMs !== point.observedAt || row.close !== point.price) return fail("CANDLE_MISMATCH", "a stored candle differs from the input");
      return { timestamp: row.closeTimeMs, open: row.open, high: row.high, low: row.low, close: row.close, volume: 0 };
    });

    const dataset = { version: `${market}:${intervalMs}:${first}-${last}`, checksum: candleChecksum(candles) };
    const strategy: GeneratedStrategy = { ...this.options.strategy, evidence: { ...this.options.strategy.evidence, datasetVersion: dataset.version, datasetChecksum: dataset.checksum } };
    const registry = new StrategyRegistry();
    const registered = registry.register(strategy);
    const report = runDslBacktest({ candles, dataset, strategy: registered, registry, config: this.options.backtest });

    const entries = report.decisions.filter((decision) => decision.action === "ENTRY");
    const filled = entries.filter((decision) => decision.outcome === "FILLED").length;
    const lastAction = report.decisions[report.decisions.length - 1]?.action ?? "HOLD";
    const m = report.metrics;
    const netReturn = finiteOr(m.totalReturn, 0);
    return Object.freeze({
      strategyId: this.strategyId,
      strategyVersion: this.strategyVersion,
      authority: this.authority,
      evaluatorVersion: this.evaluatorVersion,
      canonicalInputHash: context.canonicalInputHash,
      metrics: Object.freeze({
        netReturn,
        // The engine already deducts explicit fees and slippage from equity, so the cost-adjusted return is the same figure.
        costAdjustedReturn: netReturn,
        maximumDrawdown: finiteOr(m.maxDrawdown, 0),
        // A null Sharpe (no variance or no trades) is treated as 0, never as a favourable value.
        sharpeRatio: finiteOr(m.sharpeRatio, 0),
        // Share of intended entries that actually filled under the cash and risk limits (1 when none were attempted).
        executionQuality: entries.length === 0 ? 1 : filled / entries.length,
        tradeCount: m.tradeCount,
        closedTradeCount: m.closedTradeCount,
        feesPaid: finiteOr(m.feesPaid, 0),
        slippageCost: finiteOr(m.slippageCost, 0),
      }),
      signal: lastAction === "ENTRY" ? "BUY" : lastAction === "EXIT" ? "SELL" : "HOLD",
    });
  }
}
