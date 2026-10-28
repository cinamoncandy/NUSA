/**
 * The NUSA island mark (owner-approved 2026-10-28; NUSA means "island") on a 24 grid: nested domes over a horizon and one sea
 * ripple, the same shape as the launcher icon (scripts/generate-island-icon.js). Used beside the brand name and, faintly, as a
 * card decoration. Presentation only.
 */
export interface MarkStroke { readonly d: string; readonly width: number; readonly opacity: number }

const f = (n: number): string => n.toFixed(2);

export function islandMarkStrokes(contours = 3): readonly MarkStroke[] {
  const c = 12, hy = 16, out: MarkStroke[] = [];
  for (let i = 0; i < contours; i += 1) {
    const t = 1 - i * (0.6 / Math.max(1, contours - 1)), hg = 10 * t, w = 9.5 * t;
    out.push({ d: `M${f(c - w)},${f(hy)} C${f(c - w * 0.42)},${f(hy)} ${f(c - w * 0.34)},${f(hy - hg)} ${f(c)},${f(hy - hg)} C${f(c + w * 0.34)},${f(hy - hg)} ${f(c + w * 0.42)},${f(hy)} ${f(c + w)},${f(hy)}`, width: 1.5 - 0.4 * (1 - t), opacity: 0.45 + 0.55 * t });
  }
  out.push({ d: "M2.5,18.5 L21.5,18.5", width: 1.3, opacity: 0.85 });
  out.push({ d: "M7,21.5 L17,21.5", width: 1.1, opacity: 0.45 });
  return Object.freeze(out);
}

export const ISLAND_MARK_GRADIENT = ["#7C54FF", "#4F7BFF", "#46D7FF"] as const;
