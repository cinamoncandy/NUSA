/**
 * Pure model for the Now tab's aurora (owner-chosen 2026-10-26): what the shader is told. Each real rise in today's decision count
 * becomes one ripple, a real rise in PAPER orders marks that many of them as order ripples, and a newer server heartbeat time starts
 * one sweep. Nothing here invents an event: no rise, no ripple. Presentation only.
 */
export const AURORA_SLOTS = 8;
export const DECISION_MS = 2000;
export const ORDER_MS = 2600;
export const BEAT_MS = 900;
const STAGGER_MS = 240;

export type AuroraTone = "live" | "limit" | "idle";

export interface AuroraEvent { readonly born: number; readonly order: boolean }

const wholeRise = (prev: number | null, next: number | null): number => (
  prev != null && next != null && Number.isSafeInteger(prev) && Number.isSafeInteger(next) && next > prev ? next - prev : 0
);

/** Ripples for a rise from `prev*` to `next*`, at most AURORA_SLOTS, staggered so a burst reads as a sequence. */
export function eventsForRise(prevDecisions: number | null, nextDecisions: number | null, prevOrders: number | null, nextOrders: number | null, now: number): readonly AuroraEvent[] {
  const decisions = Math.min(AURORA_SLOTS, wholeRise(prevDecisions, nextDecisions));
  const orders = Math.min(AURORA_SLOTS, wholeRise(prevOrders, nextOrders));
  const total = Math.min(AURORA_SLOTS, Math.max(decisions, orders));
  const out: AuroraEvent[] = [];
  for (let i = 0; i < total; i += 1) out.push({ born: now + i * STAGGER_MS, order: i >= total - orders });
  return Object.freeze(out);
}

/** True only when a newer server heartbeat time than the previous one arrived. */
export function beatAdvanced(prev: number | null, next: number | null): boolean {
  return prev != null && next != null && Number.isFinite(prev) && Number.isFinite(next) && next > prev;
}

/** Writes the 8 x vec4 event uniform: [age 0..1, order 0/1, 0, 0], or age -1 for an empty or not-yet-born slot. */
export function packEvents(events: readonly AuroraEvent[], now: number, out: number[] = new Array(AURORA_SLOTS * 4).fill(0)): number[] {
  for (let i = 0; i < AURORA_SLOTS; i += 1) {
    const e = events[i];
    const span = e == null ? 1 : e.order ? ORDER_MS : DECISION_MS;
    const age = e == null ? -1 : (now - e.born) / span;
    out[i * 4] = e != null && age >= 0 && age < 1 ? age : -1;
    out[i * 4 + 1] = e != null && e.order ? 1 : 0;
    out[i * 4 + 2] = 0;
    out[i * 4 + 3] = 0;
  }
  return out;
}

/** Keeps only events still playing or not yet born. */
export function liveEvents(events: readonly AuroraEvent[], now: number): readonly AuroraEvent[] {
  return events.filter((e) => now - e.born < (e.order ? ORDER_MS : DECISION_MS)).slice(-AURORA_SLOTS);
}

/** Position of the heartbeat sweep across the width (0..1.13), or -5 when none is playing. */
export function beatPosition(beatBorn: number | null, now: number): number {
  if (beatBorn == null) return -5;
  const k = (now - beatBorn) / BEAT_MS;
  if (!(k >= 0 && k < 1)) return -5;
  return (1 - Math.pow(1 - k, 3)) * 1.25 - 0.12;
}

export interface AuroraMode { readonly speed: number; readonly warm: number; readonly dim: number }

/** Live: full speed, green. Hold (new buying stopped): slow and amber. Idle (no data): very slow, dim, never amber. */
export function auroraMode(tone: AuroraTone): AuroraMode {
  if (tone === "live") return Object.freeze({ speed: 1, warm: 0, dim: 1 });
  if (tone === "limit") return Object.freeze({ speed: 0.3, warm: 1, dim: 0.85 });
  return Object.freeze({ speed: 0.12, warm: 0, dim: 0.4 });
}
