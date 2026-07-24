import type { EquitySample } from "./equityHistory";

export interface DrawdownStatistics {
  /** Largest peak-to-trough decline observed anywhere in the equity history, in currency. */
  readonly maxDrawdown: number;
  /** null only when there is no equity history yet. */
  readonly maxDrawdownPercent: number | null;
  /** Decline from the running peak to the most recent sample -- 0 if currently at a new peak. */
  readonly currentDrawdown: number;
  readonly currentDrawdownPercent: number | null;
  /** The highest equity value observed in the history; null if there is no history yet. */
  readonly peakEquity: number | null;
}

const EMPTY: DrawdownStatistics = Object.freeze({
  maxDrawdown: 0,
  maxDrawdownPercent: null,
  currentDrawdown: 0,
  currentDrawdownPercent: null,
  peakEquity: null
});

/**
 * Derives max-drawdown/current-drawdown from EquityHistoryRecorder's samples: a running peak
 * is tracked chronologically, and each sample's decline from *its own* running peak is
 * compared against the largest decline seen so far (the standard peak-to-trough definition,
 * not decline from the single overall maximum). Pure, read-only reporting -- same in-memory,
 * resets-on-restart posture as the equity history it's derived from.
 */
export function computeDrawdownStatistics(history: readonly EquitySample[]): DrawdownStatistics {
  if (history.length === 0) return EMPTY;

  let peak = history[0]!.equity;
  let maxDrawdown = 0;
  let maxDrawdownPercent = 0;
  for (const sample of history) {
    if (sample.equity > peak) peak = sample.equity;
    const drawdown = peak - sample.equity;
    if (drawdown > maxDrawdown) {
      maxDrawdown = drawdown;
      maxDrawdownPercent = peak > 0 ? drawdown / peak : 0;
    }
  }

  const latestEquity = history[history.length - 1]!.equity;
  const currentDrawdown = peak - latestEquity;

  return Object.freeze({
    maxDrawdown,
    maxDrawdownPercent,
    currentDrawdown,
    currentDrawdownPercent: peak > 0 ? currentDrawdown / peak : null,
    peakEquity: peak
  });
}
