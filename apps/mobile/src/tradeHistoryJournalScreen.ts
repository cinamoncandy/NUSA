export type HistoryPeriod = "TODAY" | "7D" | "30D" | "90D" | "CUSTOM";
export type TradeResult = "PROFIT" | "LOSS" | "BREAK_EVEN";

export interface HistoryTrade {
  readonly id: string;
  readonly timestamp: number;
  readonly symbol: string;
  readonly strategy: string | null;
  readonly direction: "LONG" | "SHORT";
  readonly entryPrice: number;
  readonly exitPrice: number;
  readonly quantity: number;
  readonly holdingTimeMs: number;
  readonly pnl: number;
  readonly rMultiple: number | null;
  readonly fees: number;
  readonly slippage: number | null;
  readonly status: "FILLED" | "PARTIAL" | "CANCELLED" | "REJECTED";
  readonly mae: number | null;
  readonly mfe: number | null;
  readonly maximumProfit: number | null;
  readonly maximumLoss: number | null;
  readonly exitEfficiency: number | null;
  readonly ruleViolations: readonly string[];
  readonly entryCondition: string | null;
  readonly exitCondition: string | null;
  readonly executionTimeline: readonly string[];
  readonly fillTimeline: readonly string[];
  readonly riskTimeline: readonly string[];
  readonly ledgerEvents: readonly string[];
}

export interface TradeJournalEntry {
  readonly tradeId: string;
  readonly reason: string;
  readonly marketContext: string;
  readonly confidence: number | null;
  readonly emotion: string | null;
  readonly lessons: string;
  readonly improvementNotes: string;
  readonly tags: readonly string[];
  readonly screenshotCount: number;
  readonly chartSnapshot: string | null;
  readonly voiceMemoAvailable: boolean;
}

export interface TradeHistoryJournalInput {
  readonly generatedAt: number;
  readonly period: HistoryPeriod;
  readonly trades: readonly HistoryTrade[];
  readonly journals: readonly TradeJournalEntry[];
  readonly selectedTradeId: string | null;
}

export interface TradeHistoryJournalState extends TradeHistoryJournalInput {
  readonly header: Readonly<{ totalTrades: number; winRate: number; netProfit: number; averageR: number | null; averageHoldingTimeMs: number | null }>;
  readonly tradeList: readonly (HistoryTrade & { readonly result: TradeResult })[];
  readonly selectedDetail?: Readonly<{ trade: HistoryTrade & { readonly result: TradeResult }; journal: TradeJournalEntry | null }>;
  readonly aiReview: readonly { readonly kind: "WENT_WELL" | "WENT_WRONG" | "RULE_VIOLATION" | "MISSED_OPPORTUNITY" | "SIMILAR_TRADE" | "IMPROVEMENT"; readonly text: string; readonly sourceTradeIds: readonly string[] }[];
  readonly patterns: Readonly<{ repeatedMistakes: readonly string[]; bestEntryConditions: readonly string[]; bestExitConditions: readonly string[]; bestTradingHours: readonly number[]; bestHoldingTimeMs: number | null; worstHabits: readonly string[] }>;
  readonly export: Readonly<{ csv: string; json: string; pdf: null }>;
  readonly journalMutation: Readonly<{ requiresTradeId: true; affectsLedger: false; affectsOrderState: false }>;
}

const periods: readonly HistoryPeriod[] = ["TODAY", "7D", "30D", "90D", "CUSTOM"];
const finite = (value: number, name: string): void => { if (!Number.isFinite(value)) throw new Error(`${name} must be finite`); };
const nonNegative = (value: number, name: string): void => { finite(value, name); if (value < 0) throw new Error(`${name} must be non-negative`); };
const freeze = <T>(value: T): Readonly<T> => Object.freeze(value);
const resultOf = (pnl: number): TradeResult => pnl > 0 ? "PROFIT" : pnl < 0 ? "LOSS" : "BREAK_EVEN";
const average = (values: readonly number[]): number | null => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;

function validate(input: TradeHistoryJournalInput): void {
  if (!Number.isSafeInteger(input.generatedAt) || input.generatedAt < 0) throw new Error("generatedAt is invalid");
  if (!periods.includes(input.period)) throw new Error("history period is invalid");
  const ids = new Set<string>();
  for (const trade of input.trades) {
    if (!trade.id.trim() || ids.has(trade.id) || !trade.symbol.trim()) throw new Error("trade identity is invalid");
    ids.add(trade.id); if (!Number.isSafeInteger(trade.timestamp) || trade.timestamp < 0) throw new Error("trade timestamp is invalid");
    for (const [name, value] of [["entryPrice", trade.entryPrice], ["exitPrice", trade.exitPrice], ["quantity", trade.quantity], ["holdingTimeMs", trade.holdingTimeMs], ["fees", trade.fees]] as const) nonNegative(value, name);
    for (const value of [trade.pnl, trade.rMultiple, trade.slippage, trade.mae, trade.mfe, trade.maximumProfit, trade.maximumLoss, trade.exitEfficiency]) if (value !== null) finite(value, "trade metric");
    if (trade.exitEfficiency !== null && (trade.exitEfficiency < 0 || trade.exitEfficiency > 1)) throw new Error("exitEfficiency must be between 0 and 1");
  }
  for (const journal of input.journals) { if (!ids.has(journal.tradeId)) throw new Error("journal trade is unavailable"); if (journal.confidence !== null && (journal.confidence < 0 || journal.confidence > 1)) throw new Error("journal confidence must be between 0 and 1"); nonNegative(journal.screenshotCount, "screenshotCount"); }
  if (input.selectedTradeId !== null && !ids.has(input.selectedTradeId)) throw new Error("selected trade is unavailable");
}

export function buildTradeHistoryJournalScreen(input: TradeHistoryJournalInput): TradeHistoryJournalState {
  validate(input);
  const tradeList = Object.freeze([...input.trades].sort((left, right) => right.timestamp - left.timestamp || left.id.localeCompare(right.id)).map((trade) => freeze({ ...trade, result: resultOf(trade.pnl) })));
  const wins = input.trades.filter((trade) => trade.pnl > 0);
  const netProfit = input.trades.reduce((sum, trade) => sum + trade.pnl, 0);
  const selectedTrade = input.selectedTradeId === null ? undefined : tradeList.find((trade) => trade.id === input.selectedTradeId);
  const selectedJournal = input.selectedTradeId === null ? null : input.journals.find((journal) => journal.tradeId === input.selectedTradeId) ?? null;
  const violations = input.trades.filter((trade) => trade.ruleViolations.length > 0);
  const winningEntries = input.trades.filter((trade) => trade.pnl > 0 && trade.entryCondition).map((trade) => trade.entryCondition!);
  const winningExits = input.trades.filter((trade) => trade.pnl > 0 && trade.exitCondition).map((trade) => trade.exitCondition!);
  const bestEntry = [...new Set(winningEntries)].slice(0, 3);
  const bestExit = [...new Set(winningExits)].slice(0, 3);
  const aiReview = Object.freeze([
    ...(wins.length ? [{ kind: "WENT_WELL" as const, text: `${wins.length} trades closed with positive PnL.`, sourceTradeIds: Object.freeze(wins.map((trade) => trade.id)) }] : []),
    ...(input.trades.length - wins.length ? [{ kind: "WENT_WRONG" as const, text: `${input.trades.length - wins.length} trades were not profitable; review their context.`, sourceTradeIds: Object.freeze(input.trades.filter((trade) => trade.pnl <= 0).map((trade) => trade.id)) }] : []),
    ...(violations.length ? [{ kind: "RULE_VIOLATION" as const, text: `${violations.length} trades contain recorded rule violations.`, sourceTradeIds: Object.freeze(violations.map((trade) => trade.id)) }] : []),
    ...(bestEntry.length ? [{ kind: "IMPROVEMENT" as const, text: `Compare future entries with the recorded winning conditions: ${bestEntry.join(", ")}.`, sourceTradeIds: Object.freeze(input.trades.filter((trade) => bestEntry.includes(trade.entryCondition ?? "")).map((trade) => trade.id)) }] : [])
  ]);
  const patterns = freeze({ repeatedMistakes: Object.freeze([...new Set(violations.flatMap((trade) => trade.ruleViolations))]), bestEntryConditions: Object.freeze(bestEntry), bestExitConditions: Object.freeze(bestExit), bestTradingHours: Object.freeze([...new Set(wins.map((trade) => new Date(trade.timestamp).getUTCHours()))].sort((left, right) => left - right)), bestHoldingTimeMs: average(wins.map((trade) => trade.holdingTimeMs)), worstHabits: Object.freeze([...new Set(violations.flatMap((trade) => trade.ruleViolations))]) });
  const csv = `id,timestamp,symbol,strategy,direction,pnl,rMultiple,holdingTimeMs,status\n${tradeList.map((trade) => [trade.id, trade.timestamp, trade.symbol, trade.strategy ?? "", trade.direction, trade.pnl, trade.rMultiple ?? "", trade.holdingTimeMs, trade.status].join(",")).join("\n")}`;
  const state = { ...input, header: freeze({ totalTrades: input.trades.length, winRate: input.trades.length ? wins.length / input.trades.length : 0, netProfit, averageR: average(input.trades.map((trade) => trade.rMultiple).filter((value): value is number => value !== null)), averageHoldingTimeMs: average(input.trades.map((trade) => trade.holdingTimeMs)) }), tradeList, ...(selectedTrade ? { selectedDetail: freeze({ trade: selectedTrade, journal: selectedJournal }) } : {}), aiReview, patterns, export: { csv, json: "", pdf: null }, journalMutation: { requiresTradeId: true as const, affectsLedger: false as const, affectsOrderState: false as const } };
  return freeze({ ...state, export: freeze({ csv, json: JSON.stringify({ period: input.period, header: state.header, tradeIds: tradeList.map((trade) => trade.id), aiReview: state.aiReview }), pdf: null }) });
}
