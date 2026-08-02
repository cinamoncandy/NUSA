export type AnalyticsPeriod = "TODAY" | "7D" | "30D" | "90D" | "1Y" | "ALL";

export interface AnalyticsTrade {
  readonly id: string;
  readonly netPnl: number;
  readonly fees: number;
  readonly slippage: number | null;
  readonly side: "BUY" | "SELL";
  readonly direction: "LONG" | "SHORT";
  readonly positionSize: number;
  readonly holdingTimeMs: number;
  readonly rMultiple: number | null;
  readonly timestamp: number;
  readonly strategyId: string | null;
  readonly regime: string | null;
}

export interface AnalyticsEquityPoint { readonly timestamp: number; readonly equity: number; }

export interface AnalyticsScreenInput {
  readonly generatedAt: number;
  readonly period: AnalyticsPeriod;
  readonly initialEquity: number;
  readonly equityCurve: readonly AnalyticsEquityPoint[];
  readonly trades: readonly AnalyticsTrade[];
  readonly strategies: readonly { readonly id: string; readonly netProfit: number; readonly drawdown: number; readonly winRate: number; readonly profitFactor: number | null; readonly consistency: number | null; readonly confidence: number | null }[];
  readonly regimes: readonly { readonly name: string; readonly trades: readonly AnalyticsTrade[] }[];
  readonly portfolioScore: number | null;
}

export interface AnalyticsScreenState extends AnalyticsScreenInput {
  readonly netProfit: number;
  readonly totalReturn: number | null;
  readonly winRate: number;
  readonly profitFactor: number | null;
  readonly expectancy: number | null;
  readonly sharpeRatio: number | null;
  readonly sortinoRatio: number | null;
  readonly averageR: number | null;
  readonly averageHoldingTimeMs: number | null;
  readonly averageFee: number | null;
  readonly averageSlippage: number | null;
  readonly drawdownCurve: readonly { readonly timestamp: number; readonly drawdown: number }[];
  readonly dailyReturns: readonly { readonly timestamp: number; readonly value: number }[];
  readonly monthlyReturns: readonly { readonly timestamp: number; readonly value: number }[];
  readonly distribution: Readonly<{ winning: number; losing: number; long: number; short: number; buy: number; sell: number; holdingDuration: readonly { readonly label: string; readonly count: number }[]; positionSize: readonly { readonly label: string; readonly count: number }[] }>;
  readonly strategyComparison: readonly AnalyticsScreenInput["strategies"][number][];
  readonly regimeAnalysis: readonly { readonly name: string; readonly tradeCount: number; readonly netProfit: number; readonly winRate: number; readonly expectancy: number | null }[];
  readonly bestRegime: string | null;
  readonly worstRegime: string | null;
  readonly insights: readonly { readonly kind: "STRENGTH" | "WEAKNESS" | "MISTAKE" | "IMPROVEMENT" | "RISK"; readonly text: string; readonly source: string }[];
  readonly export: Readonly<{ csv: string; json: string }>;
}

const PERIODS: readonly AnalyticsPeriod[] = ["TODAY", "7D", "30D", "90D", "1Y", "ALL"];
const finite = (value: number, name: string): void => { if (!Number.isFinite(value)) throw new Error(`${name} must be finite`); };
const nonNegative = (value: number, name: string): void => { finite(value, name); if (value < 0) throw new Error(`${name} must be non-negative`); };
const freeze = <T>(value: T): Readonly<T> => Object.freeze(value);
const mean = (values: readonly number[]): number | null => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
const deviation = (values: readonly number[]): number | null => { const average = mean(values); return average == null ? null : Math.sqrt(mean(values.map((value) => (value - average) ** 2)) ?? 0); };
const ratio = (wins: number, losses: number): number | null => losses > 0 ? wins / losses : null;

function validate(input: AnalyticsScreenInput): void {
  if (!Number.isSafeInteger(input.generatedAt) || input.generatedAt < 0) throw new Error("generatedAt is invalid");
  if (!PERIODS.includes(input.period)) throw new Error("analytics period is invalid");
  nonNegative(input.initialEquity, "initialEquity");
  if (input.portfolioScore !== null && (input.portfolioScore < 0 || input.portfolioScore > 100)) throw new Error("portfolioScore must be between 0 and 100");
  for (const point of input.equityCurve) { if (!Number.isSafeInteger(point.timestamp) || point.timestamp < 0) throw new Error("equity timestamp is invalid"); nonNegative(point.equity, "equity"); }
  for (const trade of input.trades) { if (!trade.id.trim()) throw new Error("trade id is required"); finite(trade.netPnl, "trade.netPnl"); nonNegative(trade.fees, "trade.fees"); if (trade.slippage !== null) nonNegative(trade.slippage, "trade.slippage"); nonNegative(trade.positionSize, "trade.positionSize"); nonNegative(trade.holdingTimeMs, "trade.holdingTimeMs"); if (trade.rMultiple !== null) finite(trade.rMultiple, "trade.rMultiple"); if (!Number.isSafeInteger(trade.timestamp) || trade.timestamp < 0) throw new Error("trade timestamp is invalid"); }
  for (const strategy of input.strategies) { if (!strategy.id.trim()) throw new Error("strategy id is required"); finite(strategy.netProfit, "strategy.netProfit"); nonNegative(strategy.drawdown, "strategy.drawdown"); if (strategy.winRate < 0 || strategy.winRate > 1) throw new Error("strategy.winRate must be between 0 and 1"); for (const value of [strategy.profitFactor, strategy.consistency, strategy.confidence]) if (value !== null) nonNegative(value, "strategy metric"); }
  for (const regime of input.regimes) if (!regime.name.trim()) throw new Error("regime name is required");
}

function buildCurve(curve: readonly AnalyticsEquityPoint[]): { drawdown: readonly { timestamp: number; drawdown: number }[]; returns: readonly { timestamp: number; value: number }[] } {
  let peak = curve[0]?.equity ?? 0;
  const drawdown: { timestamp: number; drawdown: number }[] = [];
  const returns: { timestamp: number; value: number }[] = [];
  for (let index = 0; index < curve.length; index += 1) {
    const point = curve[index]!;
    peak = Math.max(peak, point.equity);
    drawdown.push({ timestamp: point.timestamp, drawdown: peak === 0 ? 0 : (peak - point.equity) / peak });
    if (index > 0) { const previous = curve[index - 1]!.equity; returns.push({ timestamp: point.timestamp, value: previous === 0 ? 0 : point.equity / previous - 1 }); }
  }
  return { drawdown: Object.freeze(drawdown), returns: Object.freeze(returns) };
}

function groupedReturns(values: readonly { timestamp: number; value: number }[], divisor: number): readonly { timestamp: number; value: number }[] {
  const groups = new Map<number, number>();
  for (const item of values) { const key = Math.floor(item.timestamp / divisor); groups.set(key, (groups.get(key) ?? 0) + item.value); }
  return Object.freeze([...groups.entries()].sort(([left], [right]) => left - right).map(([timestamp, value]) => ({ timestamp, value })));
}

function csv(state: Pick<AnalyticsScreenState, "netProfit" | "winRate" | "profitFactor" | "expectancy">): string {
  return `metric,value\nnetProfit,${state.netProfit}\nwinRate,${state.winRate}\nprofitFactor,${state.profitFactor ?? ""}\nexpectancy,${state.expectancy ?? ""}`;
}

export function buildAnalyticsScreen(input: AnalyticsScreenInput): AnalyticsScreenState {
  validate(input);
  const wins = input.trades.filter((trade) => trade.netPnl > 0);
  const losses = input.trades.filter((trade) => trade.netPnl < 0);
  const netProfit = input.trades.reduce((sum, trade) => sum + trade.netPnl, 0);
  const grossWins = wins.reduce((sum, trade) => sum + trade.netPnl, 0);
  const grossLosses = losses.reduce((sum, trade) => sum + Math.abs(trade.netPnl), 0);
  const returns = buildCurve(input.equityCurve);
  const dailyReturns = groupedReturns(returns.returns, 86_400_000);
  const monthlyReturns = groupedReturns(returns.returns, 2_592_000_000);
  const returnValues = returns.returns.map((item) => item.value);
  const returnDeviation = deviation(returnValues);
  const downsideDeviation = deviation(returnValues.filter((value) => value < 0));
  const strategyComparison = Object.freeze([...input.strategies].sort((left, right) => right.netProfit - left.netProfit || left.id.localeCompare(right.id)));
  const regimeAnalysis = Object.freeze(input.regimes.map((regime) => { const regimeWins = regime.trades.filter((trade) => trade.netPnl > 0); const profit = regime.trades.reduce((sum, trade) => sum + trade.netPnl, 0); return { name: regime.name, tradeCount: regime.trades.length, netProfit: profit, winRate: regime.trades.length ? regimeWins.length / regime.trades.length : 0, expectancy: regime.trades.length ? profit / regime.trades.length : null }; }).sort((left, right) => right.netProfit - left.netProfit || left.name.localeCompare(right.name)));
  const insightSource = (source: string): string => `source:${source}`;
  const bestRegime = regimeAnalysis[0]?.name ?? null;
  const worstRegime = regimeAnalysis.at(-1)?.name ?? null;
  const insights = Object.freeze([
    ...(wins.length ? [{ kind: "STRENGTH" as const, text: `Winning trades contribute ${grossWins} net PnL.`, source: insightSource("trades.netPnl") }] : []),
    ...(losses.length ? [{ kind: "WEAKNESS" as const, text: `Losing trades cost ${grossLosses} net PnL.`, source: insightSource("trades.netPnl") }, { kind: "MISTAKE" as const, text: `Review the ${losses.length} losing trades before increasing size.`, source: insightSource("trades.lossCount") }] : []),
    ...(bestRegime ? [{ kind: "IMPROVEMENT" as const, text: `Compare allocation with the ${bestRegime} regime, the highest net-PnL bucket.`, source: insightSource("regimes.netProfit") }] : []),
    ...(worstRegime && worstRegime !== bestRegime ? [{ kind: "RISK" as const, text: `Treat the ${worstRegime} regime as a review area before adding exposure.`, source: insightSource("regimes.netProfit") }] : [])
  ]);
  const distribution = freeze({ winning: wins.length, losing: losses.length, long: input.trades.filter((trade) => trade.direction === "LONG").length, short: input.trades.filter((trade) => trade.direction === "SHORT").length, buy: input.trades.filter((trade) => trade.side === "BUY").length, sell: input.trades.filter((trade) => trade.side === "SELL").length, holdingDuration: Object.freeze([{ label: "<1h", count: input.trades.filter((trade) => trade.holdingTimeMs < 3_600_000).length }, { label: "1h-1d", count: input.trades.filter((trade) => trade.holdingTimeMs >= 3_600_000 && trade.holdingTimeMs < 86_400_000).length }, { label: ">=1d", count: input.trades.filter((trade) => trade.holdingTimeMs >= 86_400_000).length }]), positionSize: Object.freeze([{ label: "small", count: input.trades.filter((trade) => trade.positionSize < 100).length }, { label: "medium", count: input.trades.filter((trade) => trade.positionSize >= 100 && trade.positionSize < 1_000).length }, { label: "large", count: input.trades.filter((trade) => trade.positionSize >= 1_000).length }]) });
  const state = { ...input, netProfit, totalReturn: input.initialEquity === 0 || !input.equityCurve.length ? null : input.equityCurve.at(-1)!.equity / input.initialEquity - 1, winRate: input.trades.length ? wins.length / input.trades.length : 0, profitFactor: ratio(grossWins, grossLosses), expectancy: input.trades.length ? netProfit / input.trades.length : null, sharpeRatio: returnDeviation && returnDeviation > 0 ? mean(returnValues)! / returnDeviation * Math.sqrt(252) : null, sortinoRatio: downsideDeviation && downsideDeviation > 0 ? mean(returnValues)! / downsideDeviation * Math.sqrt(252) : null, averageR: mean(input.trades.map((trade) => trade.rMultiple).filter((value): value is number => value !== null)), averageHoldingTimeMs: mean(input.trades.map((trade) => trade.holdingTimeMs)), averageFee: mean(input.trades.map((trade) => trade.fees)), averageSlippage: mean(input.trades.map((trade) => trade.slippage).filter((value): value is number => value !== null)), drawdownCurve: returns.drawdown, dailyReturns, monthlyReturns, distribution, strategyComparison, regimeAnalysis, bestRegime, worstRegime, insights, export: { csv: "", json: "" } };
  const exported = freeze({ csv: csv(state), json: JSON.stringify({ period: state.period, metrics: { netProfit: state.netProfit, totalReturn: state.totalReturn, winRate: state.winRate, profitFactor: state.profitFactor, expectancy: state.expectancy }, insights: state.insights }) });
  return freeze({ ...state, export: exported });
}
