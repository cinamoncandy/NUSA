/**
 * Pure model for the Now tab's decision field: a grid of dots where the number of lit dots encodes today's real decision count.
 * When the count exceeds the grid, one dot stands for `unit` decisions and the card says so. Nothing is invented: unknown
 * counts draw an empty grid, and the order dots are a subset of the lit ones. Presentation only.
 */
export const FIELD_COLUMNS = 24;
export const FIELD_ROWS = 10;
export const FIELD_CAPACITY = FIELD_COLUMNS * FIELD_ROWS;

export interface DecisionFieldModel {
  /** Decisions each lit dot stands for (1 when the day fits the grid). */
  readonly unit: number;
  readonly litDots: number;
  /** Bright order dots; never more than the lit dots and never more than the real order count. */
  readonly orderDots: number;
  readonly caption: string;
  /** True when the count is known (an unknown count draws a dim empty grid). */
  readonly known: boolean;
}

const safeCount = (v: number | null | undefined): number | null => (typeof v === "number" && Number.isSafeInteger(v) && v >= 0 ? v : null);

export function buildDecisionField(input: { readonly decisionCount: number | null | undefined; readonly orderCount: number | null | undefined }): DecisionFieldModel {
  const decisions = safeCount(input.decisionCount);
  const orders = safeCount(input.orderCount);
  if (decisions == null) return Object.freeze({ unit: 1, litDots: 0, orderDots: 0, caption: "판단 건수를 아직 받지 못했어요", known: false });
  const unit = Math.max(1, Math.ceil(decisions / FIELD_CAPACITY));
  const litDots = decisions === 0 ? 0 : Math.min(FIELD_CAPACITY, Math.ceil(decisions / unit));
  const orderDots = Math.min(orders ?? 0, litDots);
  const scale = unit === 1 ? "점 1개 = 1건" : `점 1개 = ${unit.toLocaleString("en-US")}건`;
  const orderNote = orders == null ? "" : orders === 0 ? " · 주문 0건" : ` · 밝은 점 = 주문 ${orders.toLocaleString("en-US")}건`;
  return Object.freeze({ unit, litDots, orderDots, caption: `오늘 판단 ${decisions.toLocaleString("en-US")}건 · ${scale}${orderNote}`, known: true });
}

/** Column indices (0-based) lit by the sweeping highlight at `phase` 0..1; a window `width` wide that wraps around. */
export function sweepColumns(phase: number, columns: number, width = 3): readonly number[] {
  if (!Number.isSafeInteger(columns) || columns <= 0 || !Number.isSafeInteger(width) || width <= 0) return Object.freeze([]);
  const p = Number.isFinite(phase) ? ((phase % 1) + 1) % 1 : 0;
  const head = Math.floor(p * columns);
  const out: number[] = [];
  for (let k = 0; k < Math.min(width, columns); k += 1) out.push((head - k + columns) % columns);
  return Object.freeze(out);
}
