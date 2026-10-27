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

/** Known free-text order-intent reasons and their fixed codes. Text is never turned into a code by rewriting it: it could carry an identifier or a value. */
const ORDER_INTENT_TEXT_CODES: Readonly<Record<string, string>> = Object.freeze({
  "paper account persistence failed": "PAPER_ACCOUNT_PERSISTENCE_FAILED",
  "decision allocation is zero": "DECISION_ALLOCATION_ZERO",
  "insufficient paper position": "PAPER_POSITION_INSUFFICIENT",
});

/**
 * A fixed funnel code for an order-intent result whose reason is not already a code list (the funnel drops such text, so the counts say
 * only "ORDER_INTENT:FAIL"). A known text maps to its code; any other free text maps to "<STATUS>_UNCODED_REASON" so the status
 * (BLOCKED, REJECTED, FAILED, DUPLICATE, ...) is at least visible. Returns undefined when the reason already yields codes. Display only.
 */
export function orderIntentFunnelCode(status: string, reason: string | undefined): string | undefined {
  if (funnelReasonCodes(reason).length > 0) return undefined;
  if (reason != null && Object.prototype.hasOwnProperty.call(ORDER_INTENT_TEXT_CODES, reason)) return ORDER_INTENT_TEXT_CODES[reason];
  const code = `${status}_UNCODED_REASON`;
  return CODE.test(code) ? code : undefined;
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

  /** Counts one detail key "<STAGE>:<STATUS>:<CODE>" only (no stage total), for a fixed code the caller derived for a free-text reason (see orderIntentFunnelCode). */
  public observeDetail(stage: string, status: string, code: string): void {
    if (!STAGE.test(stage) || !STATUS.test(status) || !CODE.test(code)) return;
    this.add(`${stage}:${status}:${code}`);
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

/** Adds the detail counts of `extra` to `base`; `base` keeps its own `since`. Display only. */
export function mergeFunnelSnapshots(base: PaperFunnelSnapshot, extra: PaperFunnelSnapshot): PaperFunnelSnapshot {
  const counts: Record<string, number> = { ...base.counts };
  for (const [key, value] of Object.entries(extra.counts)) counts[key] = (counts[key] ?? 0) + value;
  return Object.freeze({ since: base.since, counts: Object.freeze(Object.fromEntries(Object.entries(counts).sort(([a], [b]) => a.localeCompare(b)))) });
}

/**
 * Records an ORDER_INTENT through `record` and, only when the recorder counted it as new (its stage total rose), counts the fixed reason code beside it.
 * A repeated event id is ignored by the recorder, so it adds nothing here either. Display only.
 */
export function recordOrderIntentWithReasonCode(
  recorder: { readonly funnelSnapshot: () => PaperFunnelSnapshot },
  record: () => void,
  counters: PaperFunnelCounters,
  intentStatus: string,
  resultStatus: string,
  reason: string | undefined
): void {
  const key = `ORDER_INTENT:${intentStatus}`;
  const before = recorder.funnelSnapshot().counts[key] ?? 0;
  record();
  const code = orderIntentFunnelCode(resultStatus, reason);
  if (code != null && (recorder.funnelSnapshot().counts[key] ?? 0) > before) counters.observeDetail("ORDER_INTENT", intentStatus, code);
}
