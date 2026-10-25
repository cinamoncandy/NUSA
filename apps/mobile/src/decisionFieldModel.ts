/**
 * Pure model for the Now tab's decision band: one smooth bar for today's decisions, with the share that became orders drawn as
 * a brighter part of it. No dots or repeated small shapes. Nothing is invented: an unknown count draws an empty track with no
 * number, and the order share is the real orders divided by the real decisions (capped at 1). Presentation only.
 */
export interface DecisionBandModel {
  /** Share of decisions that became orders, 0..1; 0 when unknown or no decisions. */
  readonly orderShare: number;
  readonly caption: string;
  /** True when the decision count is known (unknown draws a dim empty track). */
  readonly known: boolean;
}

const safeCount = (v: number | null | undefined): number | null => (typeof v === "number" && Number.isSafeInteger(v) && v >= 0 ? v : null);

export function buildDecisionBand(input: { readonly decisionCount: number | null | undefined; readonly orderCount: number | null | undefined }): DecisionBandModel {
  const decisions = safeCount(input.decisionCount);
  const orders = safeCount(input.orderCount);
  if (decisions == null) return Object.freeze({ orderShare: 0, caption: "판단 건수를 아직 받지 못했어요", known: false });
  const share = decisions === 0 || orders == null ? 0 : Math.min(1, orders / decisions);
  const orderNote = orders == null ? "" : ` · 그중 주문 ${orders.toLocaleString("en-US")}건`;
  return Object.freeze({ orderShare: share, caption: `오늘 판단 ${decisions.toLocaleString("en-US")}건${orderNote}`, known: true });
}
