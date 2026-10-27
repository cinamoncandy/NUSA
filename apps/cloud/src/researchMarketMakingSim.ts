import { createHash } from "node:crypto";
import { tickForPrice, unknownFieldsBlockingSimulation, type SimulationAssumption, type VenueSpec } from "./researchVenueSpec";

/**
 * Research-only, deterministic, CONSERVATIVE quote simulator (RAIM validation step 3; WO-RESEARCH-20261015-RAIM-VENUESPEC).
 * It places nothing: it replays recorded public books and trades against hypothetical resting quotes of a SPOT account
 * (no shorting; asks only against inventory). The result is research evidence, never a PAPER fill, and never independent.
 *
 * Conservative fill rule (queue position is unknown, so it is never assumed): a resting bid fills only when a taker SELL trades
 * strictly BELOW the bid price, an ask only when a taker BUY trades strictly ABOVE it, after a placement latency, limited by
 * the trade volume. Trades AT the quote price never fill it. Every book update cancels and replaces the quotes.
 */
export interface SimBook { readonly t: number; readonly bestBid: number; readonly bestAsk: number }
export interface SimTrade { readonly t: number; readonly price: number; readonly volume: number; readonly side: "ASK" | "BID" }
export interface SimQuote { readonly bid?: number; readonly ask?: number; readonly size: number }
export type QuoteFn = (book: SimBook, inventory: number) => SimQuote | null;

export interface SimOptions {
  readonly spec: VenueSpec;
  readonly assumptions: readonly SimulationAssumption[];
  readonly books: readonly SimBook[];
  readonly trades: readonly SimTrade[];
  readonly quote: QuoteFn;
  readonly latencyMs?: number;
  readonly adverseHorizonMs?: number;
  readonly maxInventory: number;
}

export type SimResult =
  | { readonly status: "BLOCKED"; readonly unknownFields: readonly string[] }
  | {
    readonly status: "SIMULATED";
    readonly independent: false;
    readonly assumptions: readonly SimulationAssumption[];
    readonly quotesPlaced: number; readonly cancels: number; readonly fills: number; readonly filledOrders: number; readonly fillRate: number;
    readonly tradedNotional: number; readonly feePaid: number; readonly netPnl: number; readonly netBp: number;
    readonly avgSpreadCaptureBp: number; readonly avgAdverseSelectionBp: number;
    readonly maxInventory: number; readonly maxDrawdown: number; readonly endInventory: number;
    readonly fingerprint: string;
  };

const sorted = (a: readonly { readonly t: number }[]): boolean => a.every((x, i) => i === 0 || a[i - 1]!.t <= x.t);
const snap = (price: number, spec: VenueSpec, side: "BID" | "ASK"): number | undefined => {
  const tick = tickForPrice(spec, price);
  if (tick === undefined) return undefined;
  const n = price / tick;
  const snapped = (side === "BID" ? Math.floor(n + 1e-9) : Math.ceil(n - 1e-9)) * tick;
  return snapped > 0 ? snapped : undefined;
};

export function simulateQuoting(o: SimOptions): SimResult {
  const unknownFields = unknownFieldsBlockingSimulation(o.spec, o.assumptions);
  if (unknownFields.length > 0) return { status: "BLOCKED", unknownFields };
  // Fail closed on unordered or invalid input: look-ahead and duplicate-order bugs must not produce a result.
  if (!sorted(o.books) || !sorted(o.trades) || o.books.some((b) => !(b.bestBid > 0 && b.bestAsk >= b.bestBid)) || o.trades.some((x) => !(x.price > 0 && x.volume > 0))) {
    return { status: "BLOCKED", unknownFields: ["INPUT_INVALID_OR_UNORDERED"] };
  }
  const feeRate = (o.spec.listedFeeBp.status === "VERIFIED" ? o.spec.listedFeeBp.value : 0) / 10_000;
  const latency = o.latencyMs ?? 1000;
  const horizon = o.adverseHorizonMs ?? 60_000;
  let cash = 0; let inventory = 0; let fees = 0; let notional = 0;
  let placed = 0; let cancels = 0; let fills = 0; let filledOrders = 0; let peakInv = 0; let peak = 0; let maxDd = 0;
  let live: { bid?: number; ask?: number; bidLeft: number; askLeft: number; since: number; bidHit: boolean; askHit: boolean } | undefined;
  const captures: number[] = []; const fillList: { t: number; side: "BID" | "ASK"; price: number }[] = [];
  let ti = 0;
  const equity = (mid: number): number => cash + inventory * mid;
  for (let i = 0; i < o.books.length; i += 1) {
    const book = o.books[i]!;
    const next = o.books[i + 1]?.t ?? Number.POSITIVE_INFINITY;
    // Trades between the previous book and this one hit the quotes that were live BEFORE this book.
    while (ti < o.trades.length && o.trades[ti]!.t < book.t) {
      const tr = o.trades[ti]!; ti += 1;
      if (live === undefined || tr.t < live.since + latency) continue;
      if (live.bid !== undefined && tr.side === "ASK" && tr.price < live.bid && live.bidLeft > 0) {
        const q = Math.min(live.bidLeft, tr.volume, Math.max(0, o.maxInventory - inventory));
        if (q > 0) { live.bidLeft -= q; inventory += q; const n = q * live.bid; cash -= n; fees += n * feeRate; notional += n; fills += 1; if (!live.bidHit) { live.bidHit = true; filledOrders += 1; } fillList.push({ t: tr.t, side: "BID", price: live.bid }); }
      } else if (live.ask !== undefined && tr.side === "BID" && tr.price > live.ask && live.askLeft > 0) {
        const q = Math.min(live.askLeft, tr.volume, inventory);
        if (q > 0) { live.askLeft -= q; inventory -= q; const n = q * live.ask; cash += n; fees += n * feeRate; notional += n; fills += 1; if (!live.askHit) { live.askHit = true; filledOrders += 1; } fillList.push({ t: tr.t, side: "ASK", price: live.ask }); }
      }
      peakInv = Math.max(peakInv, inventory);
    }
    const mid = (book.bestBid + book.bestAsk) / 2;
    const eq = equity(mid) - fees; peak = Math.max(peak, eq); maxDd = Math.max(maxDd, peak - eq);
    if (live !== undefined) cancels += 1;
    live = undefined;
    const want = o.quote(book, inventory);
    if (want != null && want.size > 0 && next > book.t) {
      const bid = want.bid === undefined || inventory >= o.maxInventory ? undefined : snap(Math.min(want.bid, book.bestAsk), o.spec, "BID");
      const ask = want.ask === undefined || inventory <= 0 ? undefined : snap(Math.max(want.ask, book.bestBid), o.spec, "ASK");
      // Minimum order notional is a VERIFIED fact: smaller quotes are not placed.
      const minN = o.spec.minOrderNotional.status === "VERIFIED" ? o.spec.minOrderNotional.value : Number.POSITIVE_INFINITY;
      const okBid = bid !== undefined && bid * want.size >= minN ? bid : undefined;
      const okAsk = ask !== undefined && ask * Math.min(want.size, inventory) >= minN ? ask : undefined;
      if (okBid !== undefined || okAsk !== undefined) {
        placed += (okBid !== undefined ? 1 : 0) + (okAsk !== undefined ? 1 : 0);
        live = { ...(okBid !== undefined ? { bid: okBid } : {}), ...(okAsk !== undefined ? { ask: okAsk } : {}), bidLeft: want.size, askLeft: Math.min(want.size, inventory), since: book.t, bidHit: false, askHit: false };
      }
    }
  }
  // Spread capture and adverse selection are measured against the last mid at or before the fill and the first mid at or after fill + horizon.
  // m0 is the mid of the last book AT OR BEFORE the fill (no look-ahead); m1 is the first book at or after fill + horizon.
  const midAtOrBefore = (t: number): number | undefined => { let r: SimBook | undefined; for (const b of o.books) { if (b.t > t) break; r = b; } return r === undefined ? undefined : (r.bestBid + r.bestAsk) / 2; };
  const midAt = (t: number): number | undefined => { const b = o.books.find((x) => x.t >= t); return b === undefined ? undefined : (b.bestBid + b.bestAsk) / 2; };
  const adverse: number[] = [];
  for (const f of fillList) {
    const m0 = midAtOrBefore(f.t); const m1 = midAt(f.t + horizon);
    if (m0 === undefined || m1 === undefined) continue;
    captures.push(((f.side === "BID" ? m0 - f.price : f.price - m0) / m0) * 10_000);
    adverse.push(((f.side === "BID" ? m1 - m0 : m0 - m1) / m0) * 10_000);
  }
  const avg = (a: number[]): number => (a.length === 0 ? 0 : a.reduce((s, x) => s + x, 0) / a.length);
  // Conservative exit: leftover inventory is valued at the LAST BEST BID net of the same fee rate, not at the mid.
  const lastBid = o.books.length === 0 ? 0 : o.books[o.books.length - 1]!.bestBid;
  const netPnl = cash + inventory * lastBid * (1 - feeRate) - fees;
  const body = { assumptions: [...o.assumptions].sort(), placed, cancels, fills, filledOrders, notional, fees, netPnl, peakInv, maxDd, inventory, books: o.books.length, trades: o.trades.length };
  return {
    status: "SIMULATED", independent: false, assumptions: [...o.assumptions].sort(),
    quotesPlaced: placed, cancels, fills, filledOrders, fillRate: placed === 0 ? 0 : filledOrders / placed, tradedNotional: notional, feePaid: fees, netPnl,
    netBp: notional === 0 ? 0 : (netPnl / notional) * 10_000, avgSpreadCaptureBp: avg(captures), avgAdverseSelectionBp: avg(adverse),
    maxInventory: peakInv, maxDrawdown: maxDd, endInventory: inventory,
    fingerprint: createHash("sha256").update(JSON.stringify(body)).digest("hex"),
  };
}
