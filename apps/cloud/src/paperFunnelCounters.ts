/**
 * Cumulative PAPER decision-funnel counters, fed by the canonical stage recorder (PaperLearningEventRecorder). The recorder keeps only the
 * latest 250 events, a few minutes of cycles, so a funnel over hours needs counts that outlive the events. Every event the recorder accepts
 * for the first time adds one count to "<STAGE>:<STATUS>" and, when the event carries a reason, one count per coded reason (or, for a
 * decision, its action) to "<STAGE>:<STATUS>:<CODE>".
 *
 * Display and measurement only: it reads the recorder's sanitized events and never feeds anything back into Decision, Risk, Order or
 * Ledger. Counts are per process (they restart with the runtime, together with `since`). Only fixed codes are kept: a reason is split into
 * upper-case words made of letters, digits and underscores, anything else (values, identifiers, free text) is dropped, so nothing here
 * can carry a price, an amount, an identifier or a key. The number of distinct keys is bounded.
 */
export interface FunnelEventLike {
  readonly stage: string;
  readonly status: string;
  readonly reason?: string;
  readonly decision?: { readonly action?: string };
}

export interface PaperFunnelSnapshot {
  readonly since: number;
  /** "<STAGE>:<STATUS>" or "<STAGE>:<STATUS>:<CODE>" to a count. */
  readonly counts: Readonly<Record<string, number>>;
}

export const FUNNEL_MAX_KEYS = 64;
export const FUNNEL_OTHER_KEY = "OTHER";
const STAGE = /^[A-Z][A-Z_]{1,23}$/;
const STATUS = /^(PASS|SKIP|FAIL)$/;
const CODE = /^[A-Z][A-Z0-9_]{1,47}$/;
const MAX_CODES_PER_EVENT = 4;

/** The fixed codes in a reason string: its comma/semicolon/colon separated pieces that are already plain upper-case codes. */
export function funnelReasonCodes(reason: string | undefined): readonly string[] {
  // The whole reason must be code pieces joined by , ; or :. A sentence, a key=value pair or anything with a space is not a code list.
  if (reason == null || reason.length === 0 || reason.length > 400 || !/^[A-Z0-9_]+(?:[,;:][A-Z0-9_]+)*$/.test(reason)) return [];
  const out: string[] = [];
  for (const piece of reason.split(/[,;:]/)) {
    if (CODE.test(piece) && !out.includes(piece)) out.push(piece);
    if (out.length >= MAX_CODES_PER_EVENT) break;
  }
  return out;
}

export class PaperFunnelCounters {
  private readonly counts = new Map<string, number>();
  private readonly since: number;

  public constructor(now: () => number = Date.now) {
    this.since = now();
  }

  public observe(event: FunnelEventLike): void {
    if (!STAGE.test(event.stage) || !STATUS.test(event.status)) return;
    const base = `${event.stage}:${event.status}`;
    this.add(base);
    const codes = [...funnelReasonCodes(event.reason)];
    const action = event.decision?.action;
    if (event.stage === "DECISION" && typeof action === "string" && CODE.test(action) && !codes.includes(action)) codes.unshift(action);
    for (const code of codes) this.add(`${base}:${code}`);
  }

  public snapshot(): PaperFunnelSnapshot {
    return Object.freeze({ since: this.since, counts: Object.freeze(Object.fromEntries([...this.counts.entries()].sort(([a], [b]) => a.localeCompare(b)))) });
  }

  private detailKeys = 0;

  private add(key: string): void {
    // Stage totals ("<STAGE>:<STATUS>", at most one per stage and status) always get their own key. Detail keys ("...:<CODE>") are bounded
    // at FUNNEL_MAX_KEYS; past that their counts go to OTHER, so the total stays honest and nothing is dropped silently.
    let target = key;
    if (key.split(":").length > 2 && !this.counts.has(key)) {
      if (this.detailKeys >= FUNNEL_MAX_KEYS) target = FUNNEL_OTHER_KEY;
      if (!this.counts.has(target)) this.detailKeys += 1;
    }
    this.counts.set(target, (this.counts.get(target) ?? 0) + 1);
  }
}

/** Stage-to-stage conversion rates from a snapshot, as fractions; null when the earlier stage has no count. Used by the host diagnosis and tests. */
export function funnelConversions(counts: Readonly<Record<string, number>>): Readonly<Record<string, number | null>> {
  const n = (key: string): number => counts[key] ?? 0;
  const rate = (to: number, from: number): number | null => (from > 0 ? to / from : null);
  const actionable = n("DECISION:PASS:BUY") + n("DECISION:PASS:SELL");
  return Object.freeze({
    marketToDecision: rate(n("DECISION:PASS") + n("DECISION:SKIP") + n("DECISION:FAIL"), n("MARKET_DATA:PASS")),
    decisionToActionable: rate(actionable, n("DECISION:PASS") + n("DECISION:SKIP")),
    actionableToRiskPass: rate(n("RISK:PASS"), n("RISK:PASS") + n("RISK:FAIL")),
    riskPassToIntent: rate(n("ORDER_INTENT:PASS"), n("RISK:PASS")),
    intentToFill: rate(n("FILL:PASS"), n("ORDER_INTENT:PASS")),
    fillToPnl: rate(n("PNL:PASS"), n("FILL:PASS")),
  });
}
