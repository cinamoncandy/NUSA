/**
 * Unit chart for the 학습 funnel (redesign 2026-10-20, 계기판): one cell per tested strategy, so the picture is the count. Above
 * MAX_CELLS each cell stands for `unit` strategies and the legend says so. A nonzero stage always keeps at least one cell and a zero
 * stage keeps none, so 0 holdout passes is never drawn as a pass. Pure; it reads only the three integers it is given.
 */
export const WAFFLE_MAX_CELLS = 600;
export const WAFFLE_COLS = 22;

export type WaffleCell = 0 | 1 | 2; // 0 filtered out, 1 passed discovery, 2 passed the holdout as well

export interface WaffleModel {
  readonly unit: number;
  readonly cols: number;
  readonly rows: number;
  readonly cells: readonly WaffleCell[];
  readonly counts: { readonly tested: number; readonly discovery: number; readonly holdout: number };
}

export function buildWaffle(tested: number, discovery: number, holdout: number): WaffleModel | null {
  const ok = (n: number) => Number.isSafeInteger(n) && n >= 0;
  if (!ok(tested) || !ok(discovery) || !ok(holdout) || tested === 0 || discovery > tested || holdout > discovery) return null;
  const unit = Math.ceil(tested / WAFFLE_MAX_CELLS);
  const n = Math.ceil(tested / unit);
  const scale = (v: number) => (v === 0 ? 0 : Math.min(n, Math.max(1, Math.round(v / unit))));
  const d = scale(discovery);
  const h = Math.min(d, scale(holdout));
  const cells: WaffleCell[] = Array.from({ length: n }, () => 0);
  // Spread the passers evenly so they read as rare across the whole grid, not as a block.
  const passIdx = Array.from({ length: d }, (_, j) => Math.min(n - 1, Math.floor((j * n) / d)));
  passIdx.forEach((i) => { cells[i] = 1; });
  for (let j = 0; j < h; j += 1) cells[passIdx[Math.floor((j * d) / h)]!] = 2;
  return Object.freeze({ unit, cols: WAFFLE_COLS, rows: Math.ceil(n / WAFFLE_COLS), cells: Object.freeze(cells), counts: Object.freeze({ tested, discovery, holdout }) });
}
