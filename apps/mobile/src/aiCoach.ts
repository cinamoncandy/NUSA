export type CoachInsightKind = "HABIT" | "STRENGTH" | "RISK" | "IMPROVEMENT";
export interface CoachInsight { readonly kind: CoachInsightKind; readonly text: string; readonly source: string; }
export interface AiCoachAnalyticsInput {
  readonly trades: readonly { readonly netPnl: number; readonly timestamp?: number }[];
  readonly winRate: number;
  readonly profitFactor: number | null;
  readonly netProfit: number;
  readonly averageHoldingTimeMs: number | null;
  readonly drawdownCurve?: readonly { readonly drawdown: number }[];
  readonly maximumDrawdown?: number | null;
  readonly consecutiveLosses?: number;
  readonly symbolPerformance?: readonly { readonly symbol: string }[];
  readonly hourlyPerformance?: readonly { readonly hour: number }[];
}
export interface AiCoachInput { readonly analytics: AiCoachAnalyticsInput; readonly datasetVersion: string; readonly datasetChecksum: string; }
export interface AiCoachState { readonly datasetVersion: string; readonly datasetChecksum: string; readonly tradingStyle: "SHORT_TERM" | "MEDIUM_TERM" | "LONG_TERM" | "MIXED" | "UNKNOWN"; readonly insights: readonly CoachInsight[]; readonly suggestions: readonly CoachInsight[]; readonly summary: string; readonly mutationAllowed: false; }

const finite = (value: number, name: string): void => { if (!Number.isFinite(value)) throw new Error(`${name} must be finite`); };
const freeze = <T>(value: T): Readonly<T> => Object.freeze(value);

function validate(input: AiCoachInput): void {
  if (!input.datasetVersion.trim()) throw new Error("datasetVersion is required");
  if (!/^[0-9a-f]{8,64}$/i.test(input.datasetChecksum)) throw new Error("datasetChecksum is invalid");
  finite(input.analytics.winRate, "analytics.winRate");
  if (input.analytics.winRate < 0 || input.analytics.winRate > 1) throw new Error("analytics.winRate is invalid");
}

export function buildAiCoach(input: AiCoachInput): AiCoachState {
  validate(input);
  const analytics = input.analytics;
  const trades = analytics.trades.length;
  const maximumDrawdown = analytics.maximumDrawdown ?? Math.max(0, ...(analytics.drawdownCurve ?? []).map((point) => point.drawdown));
  const orderedTrades = [...analytics.trades].sort((left, right) => (left.timestamp ?? 0) - (right.timestamp ?? 0));
  let derivedConsecutiveLosses = 0;
  for (const trade of orderedTrades) derivedConsecutiveLosses = trade.netPnl < 0 ? derivedConsecutiveLosses + 1 : 0;
  const consecutiveLosses = analytics.consecutiveLosses ?? derivedConsecutiveLosses;
  const symbolPerformance = analytics.symbolPerformance ?? [];
  const hourlyPerformance = analytics.hourlyPerformance ?? [];
  const averageHold = analytics.averageHoldingTimeMs;
  const tradingStyle = averageHold === null ? "UNKNOWN" : averageHold < 3_600_000 ? "SHORT_TERM" : averageHold < 86_400_000 ? "MEDIUM_TERM" : averageHold >= 86_400_000 ? "LONG_TERM" : "MIXED";
  const insights: CoachInsight[] = [];
  const suggestions: CoachInsight[] = [];
  if (trades === 0) insights.push({ kind: "HABIT", text: "No completed Paper trades are available for a habit assessment.", source: "analytics.trades" });
  else insights.push({ kind: "HABIT", text: `${trades} completed trades show a ${(analytics.winRate * 100).toFixed(1)}% win rate and ${analytics.profitFactor == null ? "unavailable" : analytics.profitFactor.toFixed(2)} profit factor.`, source: "analytics.trades,analytics.winRate,analytics.profitFactor" });
  if (analytics.netProfit > 0) insights.push({ kind: "STRENGTH", text: `Net Paper profit is ${analytics.netProfit}; preserve the conditions represented in the dataset.`, source: "analytics.netProfit" });
  if (maximumDrawdown > 0.1) { insights.push({ kind: "RISK", text: `Maximum drawdown is ${(maximumDrawdown * 100).toFixed(1)}%; review exposure before increasing size.`, source: "analytics.maximumDrawdown" }); suggestions.push({ kind: "IMPROVEMENT", text: "Reduce exposure or pause for review while drawdown remains elevated.", source: "analytics.maximumDrawdown" }); }
  if (consecutiveLosses > 2) suggestions.push({ kind: "IMPROVEMENT", text: `${consecutiveLosses} consecutive losses were observed; review the loss sequence before the next entry.`, source: "analytics.consecutiveLosses" });
  if (symbolPerformance[0]) insights.push({ kind: "STRENGTH", text: `The highest net-profit symbol bucket is ${symbolPerformance[0].symbol}.`, source: "analytics.symbolPerformance" });
  if (hourlyPerformance[0]) insights.push({ kind: "HABIT", text: `The strongest UTC hour bucket is ${hourlyPerformance[0].hour}:00.`, source: "analytics.hourlyPerformance" });
  const summary = trades === 0 ? `Coach is waiting for verified Paper trade data from dataset ${input.datasetVersion}.` : `Coach reviewed ${trades} Paper trades from dataset ${input.datasetVersion}.`;
  return freeze({ datasetVersion: input.datasetVersion, datasetChecksum: input.datasetChecksum, tradingStyle, insights: freeze(insights), suggestions: freeze(suggestions), summary, mutationAllowed: false as const });
}
