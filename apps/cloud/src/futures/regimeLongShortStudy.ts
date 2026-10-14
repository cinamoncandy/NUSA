import { PAPER_FUTURES_OWNER_LIMITS, type PaperFuturesAccount, type PaperFuturesCostProfile, type PaperFuturesSide } from "../../../../packages/contracts/src/paperFutures";
import { paperTradingDayKey } from "../paperTradingDay";
import { evaluatePaperFuturesOrder } from "./paperFuturesRiskGate";
import { accountEquity, applyFunding, applyMarkPrices, applyOrder, emptyPaperFuturesAccount } from "./paperFuturesSimulator";

/**
 * Offline evaluator for docs/RESEARCH_PREREG_2026-10-14_FUTURES_REGIME_LONG_SHORT.md. Pure: data in, metrics out. It
 * drives the merged PAPER futures simulator and risk gate unchanged; nothing here can reach an exchange.
 *
 * Rule (fixed by the pre-registration): on 4h bars, regime UP when close > SMA(200) of closes, DOWN otherwise. Flat and
 * UP with close > highest high of the previous N bars → LONG; flat and DOWN with close < lowest low of the previous N
 * bars → SHORT. A LONG exits when close < lowest low of the previous N/2 bars or the regime turns DOWN (SHORT mirrors).
 * Signals use the bar's close; orders fill at the next bar's open. Funding applies at its time while a position is open.
 * Liquidation is checked against the bar's adverse extreme (low for LONG, high for SHORT). A position still open when
 * the window ends is closed at the last close with full costs, so every trade is a round trip.
 */
export type StudyBar = readonly [t: number, open: number, high: number, low: number, close: number];
export type StudyFunding = readonly [t: number, rate: number, mark: number | null];

export interface StudyInput {
  readonly bars: Readonly<Record<string, readonly StudyBar[]>>;
  readonly funding: Readonly<Record<string, readonly StudyFunding[]>>;
  readonly breakoutN: number;
  readonly costs: PaperFuturesCostProfile;
  readonly startEquity: number;
  /** Trading happens only for bars with fromMs <= t < toMs; earlier bars only warm up the indicators. */
  readonly fromMs: number;
  readonly toMs: number;
  /** Symbol whose month-end close vs SMA(200) labels each calendar month UP or DOWN. */
  readonly regimeSymbol: string;
}

export interface StudyTrade {
  readonly symbol: string;
  readonly side: PaperFuturesSide;
  readonly openTime: number;
  readonly closeTime: number;
  readonly net: number;
  readonly returnOnMargin: number;
  readonly liquidated: boolean;
}

export interface StudyResult {
  readonly trades: readonly StudyTrade[];
  readonly meanReturnOnMargin: number | null;
  readonly netBySymbol: Readonly<Record<string, number>>;
  readonly shortNetInDownMonths: number;
  readonly maxDrawdown: number;
  readonly liquidations: number;
  readonly finalEquity: number;
  readonly monthRegimes: Readonly<Record<string, "UP" | "DOWN">>;
}

const SMA = 200;
const BAR_MS = 4 * 60 * 60 * 1000;
const SIZE_FRACTION = 0.98; // stay just under the 20% margin cap after slippage

const mean = (values: readonly number[]): number => values.reduce((sum, value) => sum + value, 0) / values.length;
const monthKey = (t: number): string => new Date(t).toISOString().slice(0, 7);

function sma(bars: readonly StudyBar[], i: number): number | null {
  if (i + 1 < SMA) return null;
  let sum = 0;
  for (let k = i - SMA + 1; k <= i; k += 1) sum += bars[k]![4];
  return sum / SMA;
}

function channel(bars: readonly StudyBar[], i: number, n: number, pick: 2 | 3, op: (a: number, b: number) => number): number | null {
  if (i < n) return null;
  let value = bars[i - n]![pick];
  for (let k = i - n + 1; k < i; k += 1) value = op(value, bars[k]![pick]);
  return value;
}

export function labelMonths(bars: readonly StudyBar[]): Record<string, "UP" | "DOWN"> {
  const labels: Record<string, "UP" | "DOWN"> = {};
  for (let i = 0; i < bars.length; i += 1) {
    const average = sma(bars, i);
    const next = bars[i + 1];
    const monthEnds = next === undefined || monthKey(next[0]) !== monthKey(bars[i]![0]);
    if (average !== null && monthEnds) labels[monthKey(bars[i]![0])] = bars[i]![4] > average ? "UP" : "DOWN";
  }
  return labels;
}

type Pending = { readonly kind: "OPEN"; readonly side: PaperFuturesSide } | { readonly kind: "CLOSE" };
interface OpenTrade { side: PaperFuturesSide; openTime: number; openFee: number; margin: number; funding: number }

export function runRegimeLongShortStudy(input: StudyInput): StudyResult {
  const n = input.breakoutN;
  if (!Number.isInteger(n) || n < 2) throw new Error("STUDY_BREAKOUT_N_INVALID");
  const symbols = Object.keys(input.bars).sort();
  const index = new Map(symbols.map((symbol) => [symbol, new Map(input.bars[symbol]!.map((bar, i) => [bar[0], i]))]));
  const times = [...new Set(symbols.flatMap((symbol) => input.bars[symbol]!.map((bar) => bar[0])))].filter((t) => t >= input.fromMs && t < input.toMs).sort((a, b) => a - b);
  const limits = PAPER_FUTURES_OWNER_LIMITS;

  let account: PaperFuturesAccount = emptyPaperFuturesAccount(input.startEquity);
  const pending = new Map<string, Pending>();
  const open = new Map<string, OpenTrade>();
  const lastClose: Record<string, number> = {};
  const trades: StudyTrade[] = [];
  let dayKey = "";
  let dayStartEquity = input.startEquity;
  let peak = input.startEquity;
  let maxDrawdown = 0;
  let seq = 0;

  const settle = (ledgerFrom: number): void => {
    for (const entry of account.ledger.slice(ledgerFrom)) {
      const trade = open.get(entry.symbol);
      if (trade == null) continue;
      if (entry.kind === "FUNDING") trade.funding += entry.realizedPnl;
      if (entry.kind === "CLOSE" || entry.kind === "LIQUIDATION") {
        const net = entry.realizedPnl + trade.funding - trade.openFee;
        trades.push(Object.freeze({ symbol: entry.symbol, side: trade.side, openTime: trade.openTime, closeTime: entry.at, net, returnOnMargin: net / trade.margin, liquidated: entry.kind === "LIQUIDATION" }));
        open.delete(entry.symbol);
      }
    }
  };

  for (const t of times) {
    const key = paperTradingDayKey(t);
    if (key !== dayKey) { dayKey = key; dayStartEquity = accountEquity(account, lastClose); }
    for (const symbol of symbols) {
      const i = index.get(symbol)!.get(t);
      if (i === undefined) continue;
      const bars = input.bars[symbol]!;
      const [, o, h, l, c] = bars[i]!;
      const ledgerFrom = account.ledger.length;

      // 1. The previous bar's signal fills at this bar's open.
      const action = pending.get(symbol);
      pending.delete(symbol);
      const position = account.positions.find((p) => p.symbol === symbol);
      if (action?.kind === "CLOSE" && position != null) {
        const result = applyOrder(account, { id: `s${(seq += 1)}`, symbol, side: position.side === "LONG" ? "SHORT" : "LONG", quantity: position.quantity, leverage: position.leverage, marginMode: "ISOLATED", reduceOnly: true }, o, t, input.costs);
        if (result.status === "FILLED") account = result.account;
      } else if (action?.kind === "OPEN" && position == null) {
        const quantity = (dayStartEquity * limits.maxPositionMarginRatio * limits.maxLeverage * SIZE_FRACTION) / o;
        const intent = { id: `s${(seq += 1)}`, symbol, side: action.side, quantity, leverage: limits.maxLeverage, marginMode: "ISOLATED" as const, reduceOnly: false };
        const decision = evaluatePaperFuturesOrder({ account, intent, markPrice: o, markObservedAt: t, now: t, maxMarkAgeMs: BAR_MS, startOfDayEquity: dayStartEquity, costs: input.costs });
        if (decision.status === "ALLOW") {
          const result = applyOrder(account, intent, o, t, input.costs);
          if (result.status === "FILLED") {
            account = result.account;
            const opened = account.positions.find((p) => p.symbol === symbol)!;
            open.set(symbol, { side: action.side, openTime: t, openFee: result.entry.fee, margin: opened.isolatedMargin, funding: 0 });
          }
        }
      }

      // 2. Funding due during this bar while a position is open.
      for (const [ft, rate, mark] of input.funding[symbol] ?? []) {
        if (ft >= t && ft < t + BAR_MS) account = applyFunding(account, symbol, rate, mark ?? o, ft, input.costs);
      }

      // 3. Liquidation against the bar's adverse extreme.
      const held = account.positions.find((p) => p.symbol === symbol);
      if (held != null) account = applyMarkPrices(account, { [symbol]: held.side === "LONG" ? l : h }, t + BAR_MS - 1);
      settle(ledgerFrom);
      lastClose[symbol] = c;

      // 4. Signal at the close for the next bar's open.
      const average = sma(bars, i);
      if (average === null) continue;
      const up = c > average;
      const still = account.positions.find((p) => p.symbol === symbol);
      if (still == null) {
        const high = channel(bars, i, n, 2, Math.max);
        const low = channel(bars, i, n, 3, Math.min);
        if (up && high !== null && c > high) pending.set(symbol, { kind: "OPEN", side: "LONG" });
        else if (!up && low !== null && c < low) pending.set(symbol, { kind: "OPEN", side: "SHORT" });
      } else {
        const half = Math.max(1, Math.floor(n / 2));
        const exitLong = still.side === "LONG" && (!up || (channel(bars, i, half, 3, Math.min) ?? -Infinity) > c);
        const exitShort = still.side === "SHORT" && (up || (channel(bars, i, half, 2, Math.max) ?? Infinity) < c);
        if (exitLong || exitShort) pending.set(symbol, { kind: "CLOSE" });
      }
    }
    const equity = accountEquity(account, lastClose);
    peak = Math.max(peak, equity);
    maxDrawdown = Math.max(maxDrawdown, peak > 0 ? (peak - equity) / peak : 0);
  }

  // Positions still open when the window ends are closed at the last close, paying the same costs, so every opened
  // trade becomes a round trip (conservative: no open profit is counted without its exit cost).
  const endAt = times.length === 0 ? input.toMs : times[times.length - 1]! + BAR_MS - 1;
  for (const position of [...account.positions]) {
    const price = lastClose[position.symbol];
    if (price === undefined) continue;
    const ledgerFrom = account.ledger.length;
    const result = applyOrder(account, { id: `s${(seq += 1)}`, symbol: position.symbol, side: position.side === "LONG" ? "SHORT" : "LONG", quantity: position.quantity, leverage: position.leverage, marginMode: "ISOLATED", reduceOnly: true }, price, endAt, input.costs);
    if (result.status === "FILLED") { account = result.account; settle(ledgerFrom); }
  }

  const months = labelMonths(input.bars[input.regimeSymbol] ?? []);
  const netBySymbol: Record<string, number> = Object.fromEntries(symbols.map((symbol) => [symbol, 0]));
  for (const trade of trades) netBySymbol[trade.symbol] = (netBySymbol[trade.symbol] ?? 0) + trade.net;
  const shortNetInDownMonths = trades.filter((trade) => trade.side === "SHORT" && months[monthKey(trade.closeTime)] === "DOWN").reduce((sum, trade) => sum + trade.net, 0);
  return Object.freeze({
    trades: Object.freeze(trades),
    meanReturnOnMargin: trades.length === 0 ? null : mean(trades.map((trade) => trade.returnOnMargin)),
    netBySymbol: Object.freeze(netBySymbol),
    shortNetInDownMonths,
    maxDrawdown,
    liquidations: trades.filter((trade) => trade.liquidated).length,
    finalEquity: accountEquity(account, lastClose),
    monthRegimes: Object.freeze(months),
  });
}

export interface StudyVerdict { readonly pass: boolean; readonly checks: Readonly<Record<string, boolean>> }

/** The pre-registered pass rule (§6): every check must hold on the holdout. */
export function preregisteredVerdict(base: StudyResult, doubledCosts: StudyResult): StudyVerdict {
  const positiveSymbols = Object.values(base.netBySymbol).filter((net) => net > 0).length;
  const checks = {
    positiveMeanAtBaseCosts: base.meanReturnOnMargin !== null && base.meanReturnOnMargin > 0,
    positiveMeanAtDoubledCosts: doubledCosts.meanReturnOnMargin !== null && doubledCosts.meanReturnOnMargin > 0,
    atLeast30RoundTrips: base.trades.length >= 30,
    atLeast3of5SymbolsPositive: positiveSymbols >= 3,
    shortsProfitableInDownMonths: base.shortNetInDownMonths > 0,
    maxDrawdownAtMost20Percent: base.maxDrawdown <= 0.2,
    noLiquidation: base.liquidations === 0,
  };
  return Object.freeze({ pass: Object.values(checks).every(Boolean), checks: Object.freeze(checks) });
}
