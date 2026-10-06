/** Stagger delay for the nth item of a screen: capped so a long list never makes the user wait. */
export function revealDelayMs(index: number, staggerMs: number, maxIndex: number): number {
  if (!Number.isFinite(index) || index <= 0) return 0;
  return Math.min(Math.trunc(index), maxIndex) * staggerMs;
}
