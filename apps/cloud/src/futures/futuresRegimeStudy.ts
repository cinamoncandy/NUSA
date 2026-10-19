import { PAPER_FUTURES_OWNER_LIMITS, type PaperFuturesAccount, type PaperFuturesCostProfile, type PaperFuturesSide } from "../../../../packages/contracts/src/paperFutures";
import { paperTradingDayKey } from "../paperTradingDay";
import { accountEquity, applyFunding, applyMarkPrices, applyOrder, emptyPaperFuturesAccount } from "./paperFuturesSimulator";
import { evaluatePaperFuturesOrder } from "./paperFuturesRiskGate";

/**
 * Evaluation of the pre-registered futures regime long/short rule (docs/RESEARCH_PREREG_2026-10-14_FUTURES_REGIME_LONG_SHORT.md).
 * Pure and deterministic: frozen input bars in, a result out. It uses the merged PAPER futures simulator and risk gate unchanged and
 * places nothing. Nothing in §2-§6 is a parameter here except N (only N = 50 can pass; 20 and 100 are reported sensitivity).
 *
 * Stated modelling choices (fixed with the code, before the holdout is read):
 * - Signals at a bar's close, orders at the NEXT bar's open (no look-ahead). Indicators may use bars before the window.
 * - Liquidation is checked every bar against the bar's adverse extreme (low for LONG, high for SHORT), conservatively.
 * - Funding at each funding time inside a bar is settled at that bar's close price.
 * - One shared PAPER account (10,000 USDT) across the five symbols; margin per entry = 20% of start-of-KST-day equity at 2x.
 * - A position still open at the window end is closed at the last bar's close and counted as a round trip (exit costs count in drawdown).
 * - Funding stamped at a bar's open (00/08/16 UTC) belongs to that bar and is charged when a position is held in it.
 * - Drawdown is measured on bar-close equity; liquidation (not drawdown) uses the intrabar extreme.
 * - Regime ties (close == SMA) are DOWN. A SHORT counts toward §5 by the UTC month it opened. Net return = net PnL / entry notional.
 */
export interface StudyBar { readonly openTime: number; readonly open: number; readonly high: number; readonly low: number; readonly close: number; readonly closeTime: number }
export interface StudyFunding { readonly time: number; readonly rate: number }
export interface StudyInput {
  readonly bars: Readonly<Record<string, readonly StudyBar[]>>;
  readonly funding: Readonly<Record<string, readonly StudyFunding[]>>;
  readonly windowStart: number;
  readonly windowEnd: number;
  readonly breakoutN: number;
  readonly costs: PaperFuturesCostProfile;
}
export interface StudyTrade { readonly symbol: string; readonly side: PaperFuturesSide; readonly openAt: number; readonly closeAt: number; readonly notional: number; readonly netPnl: number; readonly liquidated: boolean }
export interface StudyResult {
  readonly trades: readonly StudyTrade[];
  readonly roundTrips: number;
  readonly meanNetReturn: number;
  readonly pnlBySymbol: Readonly<Record<string, number>>;
  readonly profitableSymbols: number;
  readonly shortPnlInDownMonths: number;
  readonly maxDrawdown: number;
  readonly liquidations: number;
  readonly finalEquity: number;
}

export const STUDY_START_EQUITY = 10_000;
const SMA_N = 200;
const LEVERAGE = 2;

const sma = (bars: readonly StudyBar[], i: number): number | null => {
  if (i < SMA_N - 1) return null;
  let s = 0;
  for (let k = i - SMA_N + 1; k <= i; k += 1) s += bars[k]!.close;
  return s / SMA_N;
};
const highest = (bars: readonly StudyBar[], i: number, n: number): number | null => {
  if (i < n) return null;
  let h = -Infinity; for (let k = i - n; k < i; k += 1) h = Math.max(h, bars[k]!.high); return h;
};
const lowest = (bars: readonly StudyBar[], i: number, n: number): number | null => {
  if (i < n) return null;
  let l = Infinity; for (let k = i - n; k < i; k += 1) l = Math.min(l, bars[k]!.low); return l;
};

/** Month label (UTC calendar month) -> "UP" | "DOWN" by BTCUSDT's month-end close against its 200-bar SMA (§5). */
export function monthRegimes(btc: readonly StudyBar[]): ReadonlyMap<string, "UP" | "DOWN"> {
  const out = new Map<string, "UP" | "DOWN">();
  for (let i = 0; i < btc.length; i += 1) {
    const month = new Date(btc[i]!.openTime).toISOString().slice(0, 7);
    const next = btc[i + 1];
    if (next != null && new Date(next.openTime).toISOString().slice(0, 7) === month) continue;
    const avg = sma(btc, i);
    if (avg != null) out.set(month, btc[i]!.close > avg ? "UP" : "DOWN");
  }
  return out;
}

export function runRegimeStudy(input: StudyInput): StudyResult {
  const symbols = Object.keys(input.bars).sort();
  const length = input.bars[symbols[0]!]!.length;
  for (const s of symbols) {
    const b = input.bars[s]!;
    if (b.length !== length || b.some((bar, i) => bar.openTime !== input.bars[symbols[0]!]![i]!.openTime)) throw new Error("STUDY_BARS_NOT_ALIGNED");
  }
  const times = input.bars[symbols[0]!]!;
  const exitN = Math.floor(input.breakoutN / 2);
  let account: PaperFuturesAccount = emptyPaperFuturesAccount(STUDY_START_EQUITY);
  const open = new Map<string, { side: PaperFuturesSide; openAt: number; notional: number; ledgerFrom: number }>();
  const trades: StudyTrade[] = [];
  const fundingIdx = new Map(symbols.map((s) => [s, 0]));
  let pending = new Map<string, "OPEN_LONG" | "OPEN_SHORT" | "CLOSE">();
  let dayKey = ""; let sodEquity = STUDY_START_EQUITY; let peak = STUDY_START_EQUITY; let maxDd = 0; let seq = 0;
  const closes = (i: number) => Object.fromEntries(symbols.map((s) => [s, input.bars[s]![i]!.close]));

  const settle = (symbol: string, closeAt: number, liquidated: boolean) => {
    const t = open.get(symbol)!;
    const entries = account.ledger.slice(t.ledgerFrom).filter((e) => e.symbol === symbol);
    const netPnl = entries.reduce((sum, e) => sum + (e.kind === "OPEN" ? -e.fee : e.realizedPnl), 0);
    trades.push(Object.freeze({ symbol, side: t.side, openAt: t.openAt, closeAt, notional: t.notional, netPnl, liquidated }));
    open.delete(symbol);
  };

  for (let i = 0; i < length; i += 1) {
    const at = times[i]!.openTime;
    if (at >= input.windowEnd) break;
    const inWindow = at >= input.windowStart;
    if (inWindow) {
      // 1) Orders decided at the previous close fill at this bar's open.
      const marksNow = closes(Math.max(0, i - 1));
      const key = paperTradingDayKey(at);
      if (key !== dayKey) { dayKey = key; sodEquity = accountEquity(account, marksNow); }
      for (const symbol of symbols) {
        const action = pending.get(symbol); if (action == null) continue;
        const price = input.bars[symbol]![i]!.open;
        const position = account.positions.find((p) => p.symbol === symbol);
        if (action === "CLOSE" && position != null) {
          const r = applyOrder(account, { id: `o${seq += 1}`, symbol, side: position.side === "LONG" ? "SHORT" : "LONG", quantity: position.quantity, leverage: position.leverage, marginMode: "ISOLATED", reduceOnly: true }, price, at, input.costs);
          if (r.status === "FILLED") { account = r.account; settle(symbol, at, false); }
        } else if (action !== "CLOSE" && position == null) {
          const side: PaperFuturesSide = action === "OPEN_LONG" ? "LONG" : "SHORT";
          // Sized against the slippage-adjusted fill so the margin stays at (never above) the 20% cap the gate enforces.
          const quantity = (sodEquity * PAPER_FUTURES_OWNER_LIMITS.maxPositionMarginRatio * LEVERAGE * (1 - 1e-9)) / (price * (1 + input.costs.slippageBps / 10_000));
          const intent = { id: `o${seq += 1}`, symbol, side, quantity, leverage: LEVERAGE, marginMode: "ISOLATED" as const, reduceOnly: false };
          const gate = evaluatePaperFuturesOrder({ account, intent, markPrice: price, markObservedAt: at, now: at, maxMarkAgeMs: 60_000, startOfDayEquity: sodEquity, costs: input.costs });
          if (gate.status === "ALLOW") {
            const before = account.ledger.length;
            const r = applyOrder(account, intent, price, at, input.costs);
            if (r.status === "FILLED") { account = r.account; open.set(symbol, { side, openAt: at, notional: quantity * r.entry.price, ledgerFrom: before }); }
          }
        }
      }
      pending = new Map();
      // 2) Liquidation against the bar's adverse extreme, then funding inside the bar at its close.
      for (const symbol of symbols) {
        const bar = input.bars[symbol]![i]!;
        const position = account.positions.find((p) => p.symbol === symbol);
        if (position != null) {
          const next = applyMarkPrices(account, { [symbol]: position.side === "LONG" ? bar.low : bar.high }, bar.openTime);
          if (next !== account) { account = next; settle(symbol, bar.openTime, true); }
        }
        const fs = input.funding[symbol] ?? [];
        let k = fundingIdx.get(symbol)!;
        while (k < fs.length && fs[k]!.time <= bar.closeTime) {
          if (fs[k]!.time >= bar.openTime && account.positions.some((p) => p.symbol === symbol)) {
            const before = account.positions.length;
            account = applyFunding(account, symbol, fs[k]!.rate, bar.close, fs[k]!.time, input.costs);
            if (account.positions.length < before) settle(symbol, fs[k]!.time, true);
          }
          k += 1;
        }
        fundingIdx.set(symbol, k);
      }
      const equity = accountEquity(account, closes(i));
      peak = Math.max(peak, equity); maxDd = Math.max(maxDd, (peak - equity) / peak);
    } else {
      // Before the window: only advance the funding cursor.
      for (const symbol of symbols) {
        const fs = input.funding[symbol] ?? []; let k = fundingIdx.get(symbol)!;
        while (k < fs.length && fs[k]!.time <= times[i]!.closeTime) k += 1;
        fundingIdx.set(symbol, k);
      }
    }
    // 3) Signals at this bar's close (for the next bar's open), only when the next bar is still inside the window.
    const nextAt = times[i + 1]?.openTime;
    if (nextAt == null || nextAt < input.windowStart || nextAt >= input.windowEnd) continue;
    for (const symbol of symbols) {
      const bars = input.bars[symbol]!;
      const avg = sma(bars, i); const hi = highest(bars, i, input.breakoutN); const lo = lowest(bars, i, input.breakoutN);
      const exitHi = highest(bars, i, exitN); const exitLo = lowest(bars, i, exitN);
      if (avg == null || hi == null || lo == null || exitHi == null || exitLo == null) continue;
      const c = bars[i]!.close; const regime = c > avg ? "UP" : "DOWN";
      const position = account.positions.find((p) => p.symbol === symbol);
      if (position != null) {
        if ((position.side === "LONG" && (c < exitLo || regime === "DOWN")) || (position.side === "SHORT" && (c > exitHi || regime === "UP"))) pending.set(symbol, "CLOSE");
      } else if (regime === "UP" && c > hi) pending.set(symbol, "OPEN_LONG");
      else if (regime === "DOWN" && c < lo) pending.set(symbol, "OPEN_SHORT");
    }
  }
  // Close what is still open at the last in-window bar's close.
  let last = -1; for (let i = 0; i < length && times[i]!.openTime < input.windowEnd; i += 1) last = i;
  for (const symbol of [...open.keys()]) {
    const position = account.positions.find((p) => p.symbol === symbol)!;
    const bar = input.bars[symbol]![last]!;
    const r = applyOrder(account, { id: `o${seq += 1}`, symbol, side: position.side === "LONG" ? "SHORT" : "LONG", quantity: position.quantity, leverage: position.leverage, marginMode: "ISOLATED", reduceOnly: true }, bar.close, bar.closeTime, input.costs);
    if (r.status === "FILLED") { account = r.account; settle(symbol, bar.closeTime, false); }
  }
  if (last >= 0) { const equity = accountEquity(account, closes(last)); peak = Math.max(peak, equity); maxDd = Math.max(maxDd, (peak - equity) / peak); }
  if (input.bars.BTCUSDT == null) throw new Error("STUDY_BTC_REGIME_MISSING");
  const months = monthRegimes(input.bars.BTCUSDT);
  const pnlBySymbol = Object.fromEntries(symbols.map((s) => [s, trades.filter((t) => t.symbol === s).reduce((sum, t) => sum + t.netPnl, 0)]));
  return Object.freeze({
    trades: Object.freeze(trades),
    roundTrips: trades.length,
    meanNetReturn: trades.length === 0 ? 0 : trades.reduce((sum, t) => sum + t.netPnl / t.notional, 0) / trades.length,
    pnlBySymbol: Object.freeze(pnlBySymbol),
    profitableSymbols: Object.values(pnlBySymbol).filter((v) => v > 0).length,
    shortPnlInDownMonths: trades.filter((t) => t.side === "SHORT" && months.get(new Date(t.openAt).toISOString().slice(0, 7)) === "DOWN").reduce((sum, t) => sum + t.netPnl, 0),
    maxDrawdown: maxDd,
    liquidations: trades.filter((t) => t.liquidated).length,
    finalEquity: account.walletBalance,
  });
}

/** §6: all must hold on the holdout, at base AND doubled costs. */
export function passRule(base: StudyResult, stressed: StudyResult): { readonly pass: boolean; readonly failed: readonly string[] } {
  const failed: string[] = [];
  if (!(base.meanNetReturn > 0)) failed.push("MEAN_NET_BASE");
  if (!(stressed.meanNetReturn > 0)) failed.push("MEAN_NET_STRESS");
  if (base.roundTrips < 30) failed.push("ROUND_TRIPS");
  if (base.profitableSymbols < 3) failed.push("SYMBOLS");
  if (!(base.shortPnlInDownMonths > 0)) failed.push("SHORT_DOWN");
  if (base.maxDrawdown > 0.2) failed.push("DRAWDOWN");
  if (base.liquidations > 0) failed.push("LIQUIDATION");
  return Object.freeze({ pass: failed.length === 0, failed: Object.freeze(failed) });
}
