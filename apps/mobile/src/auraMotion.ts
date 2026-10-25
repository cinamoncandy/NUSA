/**
 * Pure timing math for the one-shot aura entrances (no timers, no React). Each entrance runs once, under one second, and is
 * skipped entirely under reduce-motion. Presentation only.
 */
const clamp01 = (v: number): number => (Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : 0);

export const easeOutCubic = (t: number): number => 1 - Math.pow(1 - clamp01(t), 3);

/** Eased progress 0..1 after `elapsedMs`, starting at `delayMs`, lasting `durationMs`. A zero or invalid duration is already done. */
export function entranceProgress(elapsedMs: number, delayMs: number, durationMs: number): number {
  if (!Number.isFinite(durationMs) || durationMs <= 0) return 1;
  return easeOutCubic((elapsedMs - (Number.isFinite(delayMs) ? delayMs : 0)) / durationMs);
}

/** How many of `total` things are shown at `progress`. Reaches exactly `total` at 1 and never exceeds it. */
export function revealedCount(total: number, progress: number): number {
  if (!Number.isSafeInteger(total) || total <= 0) return 0;
  return Math.min(total, Math.floor(clamp01(progress) * total + 1e-9));
}
