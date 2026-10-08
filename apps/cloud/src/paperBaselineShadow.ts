import type { PaperCandidateStrategySpec } from "../../../packages/contracts/src/paperCandidateExecutionBinding";
import { evaluatePaperCandidateStrategy } from "./paperCandidateStrategy";

/**
 * Uncensored shadow of the owner baseline rule (SMA 5/20 on completed minute closes). It follows the SAME completed-minute bars the
 * PAPER strategy reads and applies the baseline's own BUY/SELL rule to a hypothetical single position, whether or not Risk would have
 * let a real order through. So when the consecutive-loss halt blocks every BUY, the shadow still produces the round trips the rule
 * would have made, with fees, and the PAPER ledger (which a halt censors) is not the only source of evidence.
 *
 * It is display and analysis only: it places no order, writes no ledger, creates no fill, and feeds no Risk, Governance or
 * Research decision. Its totals are NOT PAPER evidence and must never be promoted as such.
 * Persisted state is the totals and the last processed bar per market; an open hypothetical position is NOT persisted, so a
 * restart drops it (the shadow is then flat and re-enters on the next bar the rule says BUY).
 */
export interface BaselineShadowTotals {
  /** Time the shadow started counting (first accepted bar of the first run, kept across restarts). */
  readonly since: number;
  /** Completed hypothetical round trips. */
  readonly trades: number;
  /** Round trips whose return after fees was positive. */
  readonly wins: number;
  /** Sum, in basis points, of the positive gross (before fee) returns. */
  readonly grossGainBp: number;
  /** Sum, in basis points, of the magnitudes of the negative gross returns. */
  readonly grossLossBp: number;
  /** Sum, in basis points, of the fee drag over all round trips. */
  readonly feeBp: number;
}

export interface BaselineShadowPersisted {
  readonly schemaVersion: 1;
  readonly totals: BaselineShadowTotals;
  readonly lastBarAt: Readonly<Record<string, number>>;
}

export interface PaperBaselineShadowOptions {
  readonly spec: PaperCandidateStrategySpec;
  readonly feeRate: number;
  readonly now: () => number;
  readonly restore?: BaselineShadowPersisted;
}

const MARKET = /^KRW-[A-Z0-9]{1,15}$/;
const nonNegativeInteger = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) >= 0;

export function decodeBaselineShadow(value: unknown): BaselineShadowPersisted | undefined {
  if (value == null || typeof value !== "object" || Array.isArray(value)) return undefined;
  const raw = value as Record<string, unknown>;
  const totals = raw.totals as Record<string, unknown> | null | undefined;
  if (raw.schemaVersion !== 1 || totals == null || typeof totals !== "object" || raw.lastBarAt == null || typeof raw.lastBarAt !== "object" || Array.isArray(raw.lastBarAt)) return undefined;
  const keys = ["since", "trades", "wins", "grossGainBp", "grossLossBp", "feeBp"] as const;
  if (!keys.every((key) => nonNegativeInteger(totals[key])) || Number(totals.wins) > Number(totals.trades)) return undefined;
  const lastBarAt: Record<string, number> = {};
  for (const [market, at] of Object.entries(raw.lastBarAt as Record<string, unknown>)) {
    if (!MARKET.test(market) || !nonNegativeInteger(at)) return undefined;
    lastBarAt[market] = at;
  }
  return Object.freeze({
    schemaVersion: 1 as const,
    totals: Object.freeze({ since: Number(totals.since), trades: Number(totals.trades), wins: Number(totals.wins), grossGainBp: Number(totals.grossGainBp), grossLossBp: Number(totals.grossLossBp), feeBp: Number(totals.feeBp) }),
    lastBarAt: Object.freeze(lastBarAt),
  });
}

export class PaperBaselineShadow {
  private totals: { since: number; trades: number; wins: number; grossGainBp: number; grossLossBp: number; feeBp: number };
  private readonly lastBarAt = new Map<string, number>();
  private readonly entry = new Map<string, number>();
  private changed = false;

  public constructor(private readonly options: PaperBaselineShadowOptions) {
    if (!Number.isFinite(options.feeRate) || options.feeRate < 0 || options.feeRate >= 0.1) throw new Error("shadow fee rate is invalid");
    const restored = options.restore;
    this.totals = restored == null
      ? { since: 0, trades: 0, wins: 0, grossGainBp: 0, grossLossBp: 0, feeBp: 0 }
      : { ...restored.totals };
    if (restored != null) for (const [market, at] of Object.entries(restored.lastBarAt)) this.lastBarAt.set(market, at);
  }

  /** Feeds the completed minute closes the strategy just read. Idempotent per bar; never throws; never touches execution. */
  public observe(market: string, bars: readonly (readonly [number, number])[]): void {
    try {
      const key = market.trim().toUpperCase();
      if (!MARKET.test(key)) return;
      const valid = bars.filter((bar) => Number.isSafeInteger(bar[0]) && bar[0] > 0 && Number.isFinite(bar[1]) && bar[1] > 0);
      let processed = this.lastBarAt.get(key) ?? 0;
      for (let index = 0; index < valid.length; index += 1) {
        const [at, close] = valid[index]!;
        if (at <= processed) continue;
        if (index > 0 && at <= valid[index - 1]![0]) continue; // bars must be strictly ascending
        processed = at;
        this.lastBarAt.set(key, at);
        this.changed = true;
        if (this.totals.since === 0) this.totals.since = Math.max(1, this.options.now());
        const decision = evaluatePaperCandidateStrategy(this.options.spec, [], at, key, valid.slice(0, index + 1));
        const open = this.entry.get(key);
        if (open === undefined && decision.action === "BUY") this.entry.set(key, close);
        else if (open !== undefined && decision.action === "SELL") {
          this.entry.delete(key);
          this.settle(open, close);
        }
      }
    } catch { /* the shadow must never affect the runtime */ }
  }

  private settle(entry: number, exit: number): void {
    const fee = this.options.feeRate;
    const grossBp = Math.round((exit / entry - 1) * 10_000);
    const netBp = Math.round(((exit * (1 - fee)) / (entry * (1 + fee)) - 1) * 10_000);
    this.totals.trades += 1;
    if (netBp > 0) this.totals.wins += 1;
    if (grossBp > 0) this.totals.grossGainBp += grossBp; else this.totals.grossLossBp += -grossBp;
    this.totals.feeBp += Math.max(0, grossBp - netBp);
  }

  public summary(): BaselineShadowTotals {
    return Object.freeze({ ...this.totals });
  }

  /** Persisted copy, or undefined when nothing changed since the last call (so a caller writes only on change). */
  public takePersistable(): BaselineShadowPersisted | undefined {
    if (!this.changed) return undefined;
    this.changed = false;
    return Object.freeze({ schemaVersion: 1 as const, totals: this.summary(), lastBarAt: Object.freeze(Object.fromEntries(this.lastBarAt)) });
  }

  /** Puts the change flag back when the caller could not write, so the next tick retries. */
  public markUnpersisted(): void {
    this.changed = true;
  }
}
