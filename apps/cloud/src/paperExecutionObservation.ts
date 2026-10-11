/**
 * Observation time handed to the PAPER execution loop and canonical risk gate for an Upbit ticker
 * that the runtime has already admitted.
 *
 * Admission (classifyTickerRejectReason) accepts a trade timestamp up to the configured clock-skew
 * tolerance ahead of the local clock, because Upbit's clock routinely runs about a second ahead.
 * The execution and risk gates, however, reject any observation later than `now` as stale. Without
 * this clamp an admitted ticker is always rejected downstream whenever the host clock trails Upbit,
 * so no PAPER order can ever be placed. Clamping to `now` only removes that sub-tolerance lead; the
 * data is never made to look fresher than it is, and staleness is still judged against `now`.
 */
export function paperExecutionObservedAt(tradeTimestamp: number, now: number): number {
  return Math.min(tradeTimestamp, now);
}
