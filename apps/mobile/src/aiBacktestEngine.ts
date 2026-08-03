import { StrategyRegistry, type GeneratedStrategy } from "./aiStrategyEngine";

export interface BacktestCandle {
  readonly timestamp: number;
  readonly open: number;
  readonly high: number;
  readonly low: number;
  readonly close: number;
  readonly volume: number;
}

export interface BacktestDatasetIdentity { readonly version: string; readonly checksum: string; }
export interface BacktestConfig { readonly initialCash?: number; readonly feeRate?: number; readonly slippageBps?: number; }
export interface BacktestFill { readonly side: "BUY" | "SELL"; readonly timestamp: number; readonly quantity: number; readonly referencePrice: number; readonly price: number; readonly fee: number; }
export interface BacktestTrade { readonly entryTime: number; readonly exitTime: number; readonly quantity: number; readonly entryPrice: number; readonly exitPrice: number; readonly fees: number; readonly netPnl: number; readonly holdingTimeMs: number; }
export interface BacktestDecision { readonly timestamp: number; readonly action: "ENTRY" | "EXIT" | "HOLD"; readonly outcome: "FILLED" | "REJECTED" | "NONE"; readonly reason: string; readonly dataThroughTimestamp: number; }
export interface BacktestMetrics {
  readonly initialEquity: number;
  readonly finalEquity: number;
  readonly totalReturn: number;
  readonly winRate: number;
  readonly profitFactor: number | null;
  readonly sharpeRatio: number | null;
  readonly sortinoRatio: number | null;
  readonly cagr: number | null;
  readonly maxDrawdown: number;
  readonly tradeCount: number;
  readonly closedTradeCount: number;
  readonly feesPaid: number;
  readonly slippageCost: number;
}
export interface BacktestReport {
  readonly schemaVersion: 1;
  readonly reportId: string;
  readonly strategy: Readonly<{ strategyId: string; version: string }>;
  readonly dataset: BacktestDatasetIdentity;
  readonly config: Readonly<{ initialCash: number; feeRate: number; slippageBps: number }>;
  readonly decisions: readonly BacktestDecision[];
  readonly fills: readonly BacktestFill[];
  readonly trades: readonly BacktestTrade[];
  readonly equityCurve: readonly { timestamp: number; equity: number }[];
  readonly metrics: BacktestMetrics;
  readonly safety: Readonly<{ researchOnly: true; paperOnly: true; liveMutationAllowed: false; lookAheadSafe: true }>;
}

export interface BacktestRunInput {
  readonly candles: readonly BacktestCandle[];
  readonly dataset: BacktestDatasetIdentity;
  readonly strategy: GeneratedStrategy;
  readonly registry: StrategyRegistry;
  readonly config?: BacktestConfig;
}

export interface BacktestResultRepository { save(report: BacktestReport): void; load(reportId: string): BacktestReport | null; }

export class InMemoryBacktestResultRepository implements BacktestResultRepository {
  private readonly values = new Map<string, string>();
  save(report: BacktestReport): void { this.values.set(report.reportId, serializeBacktestReport(report)); }
  load(reportId: string): BacktestReport | null { const value = this.values.get(reportId); return value == null ? null : restoreBacktestReport(value); }
}

const freeze = <T>(value: T): Readonly<T> => Object.freeze(value);
const DATASET_CHECKSUM = /^[a-f0-9]{64}$/i;
const DEFAULT_INITIAL_CASH = 10_000_000;
const DEFAULT_FEE_RATE = 0.0005;
const DEFAULT_SLIPPAGE_BPS = 0;
const DAY_MS = 86_400_000;

function assertFinite(value: number, name: string): void { if (!Number.isFinite(value)) throw new Error(`${name} must be finite`); }
function assertPositive(value: number, name: string): void { assertFinite(value, name); if (value <= 0) throw new Error(`${name} must be positive`); }
function stableDigest(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) { hash ^= value.charCodeAt(index); hash = Math.imul(hash, 16777619); }
  return (hash >>> 0).toString(16).padStart(8, "0").repeat(8);
}
function payloadOf(report: BacktestReport): string { const { integrityDigest: _ignored, ...payload } = report as BacktestReport & { integrityDigest?: string }; return JSON.stringify(payload); }
function validateDataset(dataset: BacktestDatasetIdentity): void {
  if (!dataset.version.trim()) throw new Error("dataset version is required");
  if (!DATASET_CHECKSUM.test(dataset.checksum)) throw new Error("dataset checksum must be SHA-256");
}
function validateCandles(candles: readonly BacktestCandle[]): void {
  if (candles.length < 2) throw new Error("backtest requires at least two candles");
  let previous = -Infinity;
  for (const candle of candles) {
    if (!Number.isSafeInteger(candle.timestamp) || candle.timestamp <= previous) throw new Error("candle timestamps must be strictly increasing");
    for (const [name, value] of [["open", candle.open], ["high", candle.high], ["low", candle.low], ["close", candle.close]] as const) assertPositive(value, `candle ${name}`);
    if (candle.low > candle.high || candle.open < candle.low || candle.open > candle.high || candle.close < candle.low || candle.close > candle.high) throw new Error("candle OHLC bounds are invalid");
    if (!Number.isFinite(candle.volume) || candle.volume < 0) throw new Error("candle volume must be non-negative");
    previous = candle.timestamp;
  }
}
function simpleAverage(closes: readonly number[], endIndex: number, period: number): number | null {
  if (endIndex + 1 < period) return null;
  let total = 0;
  for (let index = endIndex - period + 1; index <= endIndex; index += 1) total += closes[index]!;
  return total / period;
}
function rsi(closes: readonly number[], endIndex: number, period: number): number | null {
  if (endIndex < period) return null;
  let gains = 0; let losses = 0;
  for (let index = endIndex - period + 1; index <= endIndex; index += 1) { const change = closes[index]! - closes[index - 1]!; if (change > 0) gains += change; else losses -= change; }
  if (losses === 0) return 100;
  return 100 - (100 / (1 + gains / losses));
}
function entrySignal(strategy: GeneratedStrategy, candles: readonly BacktestCandle[], index: number): boolean {
  const closes = candles.slice(0, index + 1).map((candle) => candle.close);
  const rule = strategy.dsl.entry;
  if (rule.type === "PRICE_THRESHOLD") return candles[index]!.close > rule.price;
  if (rule.type === "RSI_THRESHOLD") { const current = rsi(closes, index, rule.period); return current != null && current < rule.threshold; }
  const currentFast = simpleAverage(closes, index, rule.fastPeriod); const currentSlow = simpleAverage(closes, index, rule.slowPeriod);
  const previousFast = simpleAverage(closes, index - 1, rule.fastPeriod); const previousSlow = simpleAverage(closes, index - 1, rule.slowPeriod);
  if (currentFast == null || currentSlow == null || previousFast == null || previousSlow == null) return false;
  return rule.direction === "ABOVE" ? previousFast <= previousSlow && currentFast > currentSlow : previousFast >= previousSlow && currentFast < currentSlow;
}
function exitSignal(strategy: GeneratedStrategy, position: { entryPrice: number; entryTime: number }, candle: BacktestCandle): { reason: string; price: number } | null {
  const stop = strategy.dsl.exits.find((exit) => exit.type === "STOP_LOSS");
  const take = strategy.dsl.exits.find((exit) => exit.type === "TAKE_PROFIT");
  const timeout = strategy.dsl.exits.find((exit) => exit.type === "TIMEOUT");
  if (stop?.type === "STOP_LOSS" && candle.low <= position.entryPrice * (1 - stop.percent / 100)) return { reason: "STOP_LOSS", price: position.entryPrice * (1 - stop.percent / 100) };
  if (take?.type === "TAKE_PROFIT" && candle.high >= position.entryPrice * (1 + take.percent / 100)) return { reason: "TAKE_PROFIT", price: position.entryPrice * (1 + take.percent / 100) };
  if (timeout?.type === "TIMEOUT" && candle.timestamp - position.entryTime >= timeout.minutes * 60_000) return { reason: "TIMEOUT", price: candle.close };
  return null;
}
function positionNotional(strategy: GeneratedStrategy, equity: number, feeRate: number, slippageBps: number): number {
  const requested = strategy.dsl.risk.positionSize.mode === "PERCENT_OF_EQUITY" ? equity * strategy.dsl.risk.positionSize.value / 100 : strategy.dsl.risk.positionSize.value;
  const stop = strategy.dsl.exits.find((exit) => exit.type === "STOP_LOSS");
  const riskCap = stop?.type === "STOP_LOSS" ? equity * strategy.dsl.risk.maxRiskPercent / 100 / (stop.percent / 100) : equity * strategy.dsl.risk.maxRiskPercent / 100;
  const friction = 1 + feeRate + slippageBps / 10_000;
  return Math.min(requested, strategy.dsl.risk.maxPositionNotional, riskCap, equity / friction);
}
function mean(values: readonly number[]): number { return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0; }
function deviation(values: readonly number[]): number { const average = mean(values); return Math.sqrt(mean(values.map((value) => (value - average) ** 2))); }
function calculateMetrics(initialEquity: number, equityCurve: readonly { timestamp: number; equity: number }[], trades: readonly BacktestTrade[], feesPaid: number, slippageCost: number): BacktestMetrics {
  const finalEquity = equityCurve.at(-1)!.equity;
  const returns = equityCurve.slice(1).map((point, index) => { const prior = equityCurve[index]!.equity; return prior === 0 ? 0 : point.equity / prior - 1; });
  const positive = trades.filter((trade) => trade.netPnl > 0).reduce((sum, trade) => sum + trade.netPnl, 0);
  const negative = trades.filter((trade) => trade.netPnl < 0).reduce((sum, trade) => sum - trade.netPnl, 0);
  const meanReturn = mean(returns); const standardDeviation = deviation(returns); const downside = returns.filter((value) => value < 0).map((value) => value ** 2);
  const averageDelta = mean(equityCurve.slice(1).map((point, index) => point.timestamp - equityCurve[index]!.timestamp));
  const periodsPerYear = averageDelta > 0 ? 365.25 * DAY_MS / averageDelta : 0;
  let peak = initialEquity; let maxDrawdown = 0;
  for (const point of equityCurve) { peak = Math.max(peak, point.equity); if (peak > 0) maxDrawdown = Math.max(maxDrawdown, (peak - point.equity) / peak); }
  const elapsedYears = (equityCurve.at(-1)!.timestamp - equityCurve[0]!.timestamp) / (365.25 * DAY_MS);
  const annualizedReturn = elapsedYears > 0 && finalEquity > 0 ? (finalEquity / initialEquity) ** (1 / elapsedYears) - 1 : null;
  return freeze({ initialEquity, finalEquity, totalReturn: finalEquity / initialEquity - 1, winRate: trades.length ? trades.filter((trade) => trade.netPnl > 0).length / trades.length : 0, profitFactor: negative > 0 ? positive / negative : null, sharpeRatio: standardDeviation > 0 && periodsPerYear > 0 ? meanReturn / standardDeviation * Math.sqrt(periodsPerYear) : null, sortinoRatio: downside.length && mean(downside.map(Math.sqrt)) > 0 && periodsPerYear > 0 ? meanReturn / mean(downside.map(Math.sqrt)) * Math.sqrt(periodsPerYear) : null, cagr: annualizedReturn != null && Number.isFinite(annualizedReturn) ? annualizedReturn : null, maxDrawdown, tradeCount: trades.length, closedTradeCount: trades.length, feesPaid, slippageCost });
}
function reportId(strategy: GeneratedStrategy, dataset: BacktestDatasetIdentity): string { return `backtest:${strategy.strategyId}:${strategy.version}:${dataset.version}`; }

export function runDslBacktest(input: BacktestRunInput): BacktestReport {
  validateDataset(input.dataset); validateCandles(input.candles);
  const registered = input.registry.get(input.strategy.strategyId, input.strategy.version);
  if (!registered || registered.status !== "VALIDATED") throw new Error("STRATEGY_NOT_REGISTERED");
  if (registered.evidence.datasetVersion !== input.dataset.version || registered.evidence.datasetChecksum !== input.dataset.checksum) throw new Error("DATASET_PROVENANCE_MISMATCH");
  if (registered.paperOnly !== true || registered.productionMutationAllowed !== false || registered.executionAllowed !== false) throw new Error("PAPER_BOUNDARY_INVALID");
  const initialCash = input.config?.initialCash ?? DEFAULT_INITIAL_CASH; const feeRate = input.config?.feeRate ?? DEFAULT_FEE_RATE; const slippageBps = input.config?.slippageBps ?? DEFAULT_SLIPPAGE_BPS;
  assertPositive(initialCash, "initialCash"); if (!Number.isFinite(feeRate) || feeRate < 0) throw new Error("feeRate must be non-negative"); if (!Number.isFinite(slippageBps) || slippageBps < 0 || slippageBps >= 10_000) throw new Error("slippageBps is invalid");
  let cash = initialCash; let position: { quantity: number; entryPrice: number; entryTime: number; entryFee: number } | null = null; let feesPaid = 0; let slippageCost = 0;
  const fills: BacktestFill[] = []; const trades: BacktestTrade[] = []; const decisions: BacktestDecision[] = []; const equityCurve: Array<{ timestamp: number; equity: number }> = [];
  for (let index = 0; index < input.candles.length; index += 1) {
    const candle = input.candles[index]!;
    if (position) {
      const exit = exitSignal(registered, position, candle);
      if (exit) {
        const price = exit.price * (1 - slippageBps / 10_000); const fee = price * position.quantity * feeRate; cash += price * position.quantity - fee; feesPaid += fee; slippageCost += Math.abs(exit.price - price) * position.quantity;
        fills.push(freeze({ side: "SELL", timestamp: candle.timestamp, quantity: position.quantity, referencePrice: exit.price, price, fee }));
        trades.push(freeze({ entryTime: position.entryTime, exitTime: candle.timestamp, quantity: position.quantity, entryPrice: position.entryPrice, exitPrice: price, fees: position.entryFee + fee, netPnl: (price - position.entryPrice) * position.quantity - position.entryFee - fee, holdingTimeMs: candle.timestamp - position.entryTime }));
        decisions.push(freeze({ timestamp: candle.timestamp, action: "EXIT", outcome: "FILLED", reason: exit.reason, dataThroughTimestamp: candle.timestamp })); position = null;
      }
    } else if (entrySignal(registered, input.candles, index)) {
      const equity = cash; const requestedNotional = positionNotional(registered, equity, feeRate, slippageBps); const price = candle.close * (1 + slippageBps / 10_000); const quantity = requestedNotional / price; const fee = price * quantity * feeRate;
      if (quantity > 0 && price * quantity + fee <= cash) { cash -= price * quantity + fee; feesPaid += fee; slippageCost += Math.abs(price - candle.close) * quantity; position = { quantity, entryPrice: price, entryTime: candle.timestamp, entryFee: fee }; fills.push(freeze({ side: "BUY", timestamp: candle.timestamp, quantity, referencePrice: candle.close, price, fee })); decisions.push(freeze({ timestamp: candle.timestamp, action: "ENTRY", outcome: "FILLED", reason: "DSL_ENTRY", dataThroughTimestamp: candle.timestamp })); }
      else decisions.push(freeze({ timestamp: candle.timestamp, action: "ENTRY", outcome: "REJECTED", reason: "RISK_OR_BALANCE_LIMIT", dataThroughTimestamp: candle.timestamp }));
    } else decisions.push(freeze({ timestamp: candle.timestamp, action: "HOLD", outcome: "NONE", reason: "NO_RULE_TRIGGERED", dataThroughTimestamp: candle.timestamp }));
    equityCurve.push(freeze({ timestamp: candle.timestamp, equity: cash + (position ? position.quantity * candle.close : 0) }));
  }
  const metrics = calculateMetrics(initialCash, equityCurve, trades, feesPaid, slippageCost);
  return freeze({ schemaVersion: 1, reportId: reportId(registered, input.dataset), strategy: freeze({ strategyId: registered.strategyId, version: registered.version }), dataset: freeze({ ...input.dataset }), config: freeze({ initialCash, feeRate, slippageBps }), decisions: freeze(decisions), fills: freeze(fills), trades: freeze(trades), equityCurve: freeze(equityCurve), metrics, safety: freeze({ researchOnly: true, paperOnly: true, liveMutationAllowed: false, lookAheadSafe: true }) });
}

export function serializeBacktestReport(report: BacktestReport): string {
  const payload = payloadOf(report); return JSON.stringify({ ...report, integrityDigest: stableDigest(payload) });
}

export function restoreBacktestReport(serialized: string): BacktestReport {
  let parsed: unknown;
  try { parsed = JSON.parse(serialized); } catch { throw new Error("BACKTEST_REPORT_INVALID_JSON"); }
  if (!parsed || typeof parsed !== "object") throw new Error("BACKTEST_REPORT_INVALID");
  const record = parsed as BacktestReport & { integrityDigest?: string };
  if (record.schemaVersion !== 1 || typeof record.integrityDigest !== "string" || record.integrityDigest !== stableDigest(payloadOf(record))) throw new Error("BACKTEST_REPORT_INTEGRITY_FAILURE");
  if (record.safety?.liveMutationAllowed !== false || record.safety?.lookAheadSafe !== true) throw new Error("BACKTEST_REPORT_SAFETY_FAILURE");
  const { integrityDigest, ...withoutDigest } = record;
  void integrityDigest;
  return freeze({ ...withoutDigest, decisions: freeze(record.decisions), fills: freeze(record.fills), trades: freeze(record.trades), equityCurve: freeze(record.equityCurve) });
}
