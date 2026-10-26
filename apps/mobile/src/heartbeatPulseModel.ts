/**
 * Pure model for the Now tab's heartbeat scan line. The line sweeps once each time the server's own heartbeat timestamp advances
 * (a heartbeat that really arrived), and its resting glow fades with the real age of that timestamp. The age is the phone clock minus the server stamp, so a skewed phone clock shifts the brightness (a future-dated stamp reads as stale, the safe side). FRESH_MS/STALE_MS are not derived from the real heartbeat cadence yet. Nothing here is a timer that
 * pretends to be progress. Presentation only.
 */
export const FRESH_MS = 15_000;
export const STALE_MS = 60_000;

/** True only when a newer heartbeat timestamp than the previous one arrived. The first value seen never pulses. */
export function shouldPulse(previous: number | null, next: number | null): boolean {
  if (previous == null || next == null) return false;
  if (!Number.isFinite(previous) || !Number.isFinite(next)) return false;
  return next > previous;
}

/** Resting brightness 1..0.15 from the real age of the last heartbeat; unknown or future-dated stamps rest at the dim floor. */
export function restingGlow(lastHeartbeatAt: number | null, now: number): number {
  if (lastHeartbeatAt == null || !Number.isFinite(lastHeartbeatAt) || !Number.isFinite(now)) return 0.15;
  const age = now - lastHeartbeatAt;
  if (age < 0) return 0.15;
  if (age <= FRESH_MS) return 1;
  if (age >= STALE_MS) return 0.15;
  return 1 - ((age - FRESH_MS) / (STALE_MS - FRESH_MS)) * 0.85;
}
