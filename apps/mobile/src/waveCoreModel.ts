/**
 * Pure model for the Now tab's wave (owner-chosen 2026-10-26): a few overlapping light waves that rise when a real decision arrives.
 * Each real rise in today's decision count sends one pulse along the waves and leaves one tick in the last-minute strip; a real
 * rise in PAPER orders makes those pulses order pulses (pink). No rise, no motion beyond the quiet idle flow. Presentation only.
 */
export const WAVE_PULSE_MS = 1500;
export const WAVE_HISTORY_MS = 60_000;
export const WAVE_MAX_PULSES = 8;
const STAGGER_MS = 260;

export interface WavePulse { readonly born: number; readonly order: boolean }

const rise = (prev: number | null, next: number | null): number => (
  prev != null && next != null && Number.isSafeInteger(prev) && Number.isSafeInteger(next) && next > prev ? next - prev : 0
);

/** Pulses for a rise from prev to next (capped), staggered; the last `orders` of them are order pulses. */
export function pulsesForRise(prevDecisions: number | null, nextDecisions: number | null, prevOrders: number | null, nextOrders: number | null, now: number): readonly WavePulse[] {
  const decisions = Math.min(WAVE_MAX_PULSES, rise(prevDecisions, nextDecisions));
  const orders = Math.min(WAVE_MAX_PULSES, rise(prevOrders, nextOrders));
  const total = Math.min(WAVE_MAX_PULSES, Math.max(decisions, orders));
  const out: WavePulse[] = [];
  for (let i = 0; i < total; i += 1) out.push({ born: now + i * STAGGER_MS, order: i >= total - orders });
  return Object.freeze(out);
}

/** How many real fills arrived (capped); a fill draws the waves together into one line and sends a shockwave. */
export function fillRise(prev: number | null, next: number | null): number {
  return Math.min(WAVE_MAX_PULSES, rise(prev, next));
}

/** How far the waves are drawn together (0..1) `ms` after a fill; it eases out over about 1.4 s. */
export function fillLock(ms: number): number {
  if (!(ms >= 0) || ms > 1400) return 0;
  const k = ms / 1400;
  return Math.pow(1 - k, 2) * Math.min(1, ms / 120);
}

/** Wave height factor at x in 0..1: a soft hump pinched at both ends, plus a travelling bump for each live pulse. */
export function waveEnvelope(x: number, pulses: readonly WavePulse[], now: number): number {
  const u = 2 * x - 1;
  const base = Math.max(0, 1 - u * u);
  let e = Math.pow(base, 2.2);
  for (const p of pulses) {
    const k = (now - p.born) / WAVE_PULSE_MS;
    if (k < 0 || k > 1) continue;
    const d = (x - (-0.1 + k * 1.2)) / 0.12;
    e += Math.exp(-d * d) * (p.order ? 2.2 : 1.6) * (1 - k * 0.45) * Math.pow(base, 0.5);
  }
  return e;
}

/** One step of the amplitude spring toward `rest`; a kick is added to the velocity by the caller. */
export function springStep(amp: number, velocity: number, rest: number, dt: number): { readonly amp: number; readonly velocity: number } {
  const acc = (rest - amp) * 34 - velocity * 3.6;
  const v = velocity + acc * dt;
  return { amp: Math.max(0, amp + v * dt), velocity: v };
}

/** Resting height: quiet while live, rising a little with recent activity; flat without data. */
export const restAmplitude = (live: boolean, energy: number): number => (live ? 0.22 + 0.14 * Math.max(0, Math.min(1.5, energy)) : 0);

/** Kick added to the spring velocity for one pulse. */
export const pulseKick = (order: boolean): number => (order ? 8.5 : 6);

/** Tick x positions (0..1, 1 = now) for rises seen in the last minute. */
export function historyTicks(ticks: readonly WavePulse[], now: number): readonly { readonly x: number; readonly order: boolean; readonly fresh: number }[] {
  return ticks.filter((t) => now - t.born >= 0 && now - t.born <= WAVE_HISTORY_MS)
    .map((t) => ({ x: 1 - (now - t.born) / WAVE_HISTORY_MS, order: t.order, fresh: Math.max(0, 1 - (now - t.born) / 2500) }));
}
