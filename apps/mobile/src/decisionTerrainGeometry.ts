/** Pure helpers for the decision ridgeline: row smoothing and easing. */
export const TERRAIN_POINTS = 48;

export const easeOutCubic = (x: number): number => 1 - Math.pow(1 - Math.min(1, Math.max(0, x)), 3);

/** Catmull-Rom through the 12 bucket heights; unobserved buckets are ground (0) and flagged so they can be drawn faint. */
export function smoothTerrainRow(values: readonly (number | null)[], points = TERRAIN_POINTS): readonly { readonly h: number; readonly seen: boolean }[] {
  const n = values.length;
  if (n === 0) return Array.from({ length: points }, () => ({ h: 0, seen: false }));
  const v = (i: number): number => values[Math.min(n - 1, Math.max(0, i))] ?? 0;
  const out: { h: number; seen: boolean }[] = [];
  for (let p = 0; p < points; p += 1) {
    const u = (p / (points - 1)) * (n - 1), i = Math.floor(u), t = u - i;
    const p0 = v(i - 1), p1 = v(i), p2 = v(i + 1), p3 = v(i + 2);
    const h = 0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t + (-p0 + 3 * p1 - 3 * p2 + p3) * t * t * t);
    out.push({ h: Math.max(0, Math.min(1.2, h)), seen: values[Math.min(n - 1, Math.round(u))] != null });
  }
  return out;
}
