import { createHash } from "node:crypto";
import { simulateQuoting, type QuoteFn, type SimBook, type SimResult, type SimTrade } from "./researchMarketMakingSim";
import type { SimulationAssumption, VenueSpec } from "./researchVenueSpec";

/**
 * Research-only deterministic regime classifier and inventory-aware quote candidate (RAIM steps 4-5 inputs;
 * WO-RESEARCH-20261015-RAIM-VENUESPEC). Everything here is a HYPOTHESIS with constants fixed in advance (below) and NOT tuned on
 * any data; changing one is a new candidate. It uses only past books (no look-ahead), places nothing, and compares with the
 * touch-joining baseline on the SAME input. An ambiguous or data-poor state yields NO quote (fail closed).
 */
export type Regime = "MEAN_REVERT" | "TREND" | "HIGH_VOL" | "ILLIQUID_EVENT" | "INSUFFICIENT" | "AMBIGUOUS";

export const REGIME_PREREGISTERED = Object.freeze({
  windowBooks: 20, maxGapMs: 30_000, maxSpreadBp: 50, highVolBp: 15, trendDriftZ: 1.5, volMarginBp: 1.5, driftMarginZ: 0.25,
  skewBpAtFullInventory: 5, highVolWidenBp: 10, minFillsForVerdict: 30,
});
const P = REGIME_PREREGISTERED;
const mid = (b: SimBook): number => (b.bestBid + b.bestAsk) / 2;

export function classifyRegime(window: readonly SimBook[]): Regime {
  if (window.length < P.windowBooks) return "INSUFFICIENT";
  const w = window.slice(-P.windowBooks);
  let maxGap = 0;
  for (let i = 1; i < w.length; i += 1) maxGap = Math.max(maxGap, w[i]!.t - w[i - 1]!.t);
  const last = w[w.length - 1]!;
  const spreadBp = ((last.bestAsk - last.bestBid) / mid(last)) * 10_000;
  if (maxGap > P.maxGapMs || spreadBp > P.maxSpreadBp) return "ILLIQUID_EVENT";
  const r: number[] = [];
  for (let i = 1; i < w.length; i += 1) r.push(((mid(w[i]!) - mid(w[i - 1]!)) / mid(w[i - 1]!)) * 10_000);
  const mean = r.reduce((s, x) => s + x, 0) / r.length;
  const vol = Math.sqrt(r.reduce((s, x) => s + (x - mean) ** 2, 0) / r.length);
  const driftZ = vol === 0 ? 0 : Math.abs(r.reduce((s, x) => s + x, 0)) / (vol * Math.sqrt(r.length));
  if (Math.abs(vol - P.highVolBp) < P.volMarginBp || (vol <= P.highVolBp && Math.abs(driftZ - P.trendDriftZ) < P.driftMarginZ)) return "AMBIGUOUS";
  if (vol > P.highVolBp) return "HIGH_VOL";
  return driftZ > P.trendDriftZ ? "TREND" : "MEAN_REVERT";
}

/** Baseline: join the touch on both sides. */
export const baselineQuote = (size: number): QuoteFn => (book) => ({ bid: book.bestBid, ask: book.bestAsk, size });

/** Candidate: regime-gated, inventory-skewed. Stateful only through the past books it has seen (deterministic for an ordered feed). */
export function regimeCandidateQuote(size: number, maxInventory: number): QuoteFn {
  const seen: SimBook[] = [];
  return (book, inventory) => {
    seen.push(book);
    if (seen.length > P.windowBooks) seen.shift();
    const regime = classifyRegime(seen);
    const r = Math.min(1, Math.max(0, inventory / maxInventory));
    if (regime === "MEAN_REVERT") {
      const shift = 1 - (r * P.skewBpAtFullInventory) / 10_000;
      return { bid: book.bestBid * shift, ask: Math.max(book.bestBid, book.bestAsk * shift), size };
    }
    if (regime === "TREND") return inventory > 0 ? { ask: book.bestAsk, size } : null;
    if (regime === "HIGH_VOL") return { bid: book.bestBid * (1 - P.highVolWidenBp / 10_000), ask: book.bestAsk * (1 + P.highVolWidenBp / 10_000), size };
    return null;
  };
}

export interface ComparisonResult {
  readonly status: "BLOCKED" | "COMPARED";
  readonly inputFingerprint?: string;
  readonly baseline?: SimResult; readonly candidate?: SimResult;
  /** INSUFFICIENT until both sides have enough fills; never an approval and never independent. */
  readonly verdict?: "INSUFFICIENT" | "NO_IMPROVEMENT" | "CANDIDATE_AHEAD_NOT_VALIDATED";
  readonly deltaNetPnl?: number;
  readonly blockedBy?: readonly string[];
}

export function compareOnSameInput(o: { spec: VenueSpec; assumptions: readonly SimulationAssumption[]; books: readonly SimBook[]; trades: readonly SimTrade[]; size: number; maxInventory: number }): ComparisonResult {
  const common = { spec: o.spec, assumptions: o.assumptions, books: o.books, trades: o.trades, maxInventory: o.maxInventory };
  const baseline = simulateQuoting({ ...common, quote: baselineQuote(o.size) });
  const candidate = simulateQuoting({ ...common, quote: regimeCandidateQuote(o.size, o.maxInventory) });
  if (baseline.status === "BLOCKED") return { status: "BLOCKED", blockedBy: baseline.unknownFields };
  if (candidate.status === "BLOCKED") return { status: "BLOCKED", blockedBy: candidate.unknownFields };
  const inputFingerprint = createHash("sha256").update(JSON.stringify([o.books, o.trades])).digest("hex");
  const deltaNetPnl = candidate.netPnl - baseline.netPnl;
  const enough = baseline.fills >= P.minFillsForVerdict && candidate.fills >= P.minFillsForVerdict;
  return { status: "COMPARED", inputFingerprint, baseline, candidate, deltaNetPnl, verdict: !enough ? "INSUFFICIENT" : deltaNetPnl > 0 ? "CANDIDATE_AHEAD_NOT_VALIDATED" : "NO_IMPROVEMENT" };
}
