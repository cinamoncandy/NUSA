import { calmPalette } from "./designSystem";

/**
 * "Calm" design language (presentation only): one status sentence, a big number, hairline rows.
 * Colour carries meaning only: white = normal, lime = my PAPER order, amber = needs attention, red = loss/halt.
 * Pure and React-free so the rules are tested behaviourally. Grants no authority.
 */
export type CalmTone = "NORMAL" | "ORDER" | "ATTENTION" | "LOSS" | "MUTED";

export const calmColors = calmPalette;

export function calmToneColor(tone: CalmTone): string {
  switch (tone) {
    case "ORDER": return calmColors.order;
    case "ATTENTION": return calmColors.attention;
    case "LOSS": return calmColors.loss;
    case "MUTED": return calmColors.muted;
    default: return calmColors.text;
  }
}

/** Money delta tone: only a real loss is red; unknown/zero never reads as gain or loss. */
export function calmDeltaTone(value: number | null | undefined): CalmTone {
  if (value == null || !Number.isFinite(value) || value === 0) return "MUTED";
  return value < 0 ? "LOSS" : "NORMAL";
}

/** Collapses consecutive identical WAIT rows into one line with a count (display grouping only). */
export interface CalmRowInput { readonly key: string; readonly atMs: number; readonly text: string; readonly groupable: boolean }
export interface CalmRow extends CalmRowInput { readonly count: number }
export function groupCalmRows(rows: readonly CalmRowInput[]): readonly CalmRow[] {
  const out: CalmRow[] = [];
  for (const row of rows) {
    const last = out[out.length - 1];
    if (row.groupable && last && last.groupable && last.text === row.text) out[out.length - 1] = { ...last, count: last.count + 1 };
    else out.push({ ...row, count: 1 });
  }
  return Object.freeze(out);
}
