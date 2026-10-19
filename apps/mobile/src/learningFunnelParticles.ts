/**
 * Particle scene for the 학습 funnel (redesign 2026-10-19, step 5). One particle stands for one tested strategy, so the count follows
 * the server's integers: all of them fall in, only the discovery passers get through the first sieve, and only the holdout passers
 * get through the last gate. With zero holdout passes nothing is ever drawn below the last gate. Pure and deterministic for a
 * seed; presentation only, it reads nothing but the three integers it is given.
 */
export const FUNNEL_MAX_PARTICLES = 520;
export const FUNNEL_SIEVE_Y = 0.42;
export const FUNNEL_GATE_Y = 0.8;

export interface FunnelCounts { readonly total: number; readonly discovery: number; readonly holdout: number }
export type FunnelTone = "FLOW" | "REJECTED" | "GATE";

export interface FunnelField {
  readonly count: number;
  /** 0 = stops at the first sieve, 1 = stops at the last gate, 2 = passes everything. */
  readonly tier: Uint8Array;
  readonly lane: Float32Array;
  readonly t: Float32Array;
  readonly v: Float32Array;
  readonly scatter: Float32Array;
  readonly size: Float32Array;
  readonly rng: () => number;
}
export interface FunnelGeometry { readonly width: number; readonly height: number }

export function funnelRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

/**
 * Scales the real counts down to at most FUNNEL_MAX_PARTICLES while keeping the shape: a nonzero count always keeps at least one
 * particle, and a zero count keeps none.
 */
export function funnelCounts(tested: number, discovery: number, holdout: number): FunnelCounts {
  const total = Math.max(0, Math.min(tested, FUNNEL_MAX_PARTICLES));
  if (tested <= 0 || total === 0) return { total: 0, discovery: 0, holdout: 0 };
  const scale = (n: number) => (n <= 0 ? 0 : Math.min(total, Math.max(1, Math.round((n / tested) * total))));
  const d = scale(discovery);
  return { total, discovery: d, holdout: Math.min(d, scale(holdout)) };
}

const spawn = (f: FunnelField, i: number, initial: boolean) => {
  const r = f.rng;
  f.lane[i] = r() * 2 - 1;
  f.t[i] = initial ? r() : 0;
  f.v[i] = 0.075 + r() * 0.05;
  f.scatter[i] = (r() < 0.5 ? -1 : 1) * (10 + r() * 26);
  f.size[i] = 2.2 + r() * 1.6;
};

export function createFunnelField(counts: FunnelCounts, seed: number): FunnelField {
  const n = counts.total;
  const f: FunnelField = { count: n, tier: new Uint8Array(n), lane: new Float32Array(n), t: new Float32Array(n), v: new Float32Array(n), scatter: new Float32Array(n), size: new Float32Array(n), rng: funnelRandom(seed) };
  // Spread the passers evenly through the index range so they are visible from the first frame.
  for (let j = 0; j < counts.discovery; j += 1) f.tier[Math.min(n - 1, Math.floor((j * n) / counts.discovery))] = 1;
  const passers: number[] = [];
  for (let i = 0; i < n; i += 1) if (f.tier[i] === 1) passers.push(i);
  for (let j = 0; j < counts.holdout; j += 1) f.tier[passers[Math.floor((j * passers.length) / counts.holdout)]!] = 2;
  for (let i = 0; i < n; i += 1) spawn(f, i, true);
  return f;
}

export function funnelHalfWidth(y: number, g: FunnelGeometry): number { return g.width * (0.46 - 0.3 * Math.min(1, y / g.height)); }

export function stepFunnelField(f: FunnelField, dtSec: number): void {
  const dt = Math.max(0, Math.min(0.1, dtSec));
  for (let i = 0; i < f.count; i += 1) { f.t[i]! += f.v[i]! * dt; if (f.t[i]! >= 1.12) spawn(f, i, false); }
}

export function warmFunnelField(f: FunnelField, seconds: number): void { for (let s = 0; s < seconds / 0.04; s += 1) stepFunnelField(f, 0.04); }

export function funnelParticlePoint(f: FunnelField, i: number, g: FunnelGeometry): { readonly x: number; readonly y: number; readonly alpha: number; readonly tone: FunnelTone } {
  const H = g.height, cx = g.width / 2, y = f.t[i]! * H, y1 = FUNNEL_SIEVE_Y * H, y2 = FUNNEL_GATE_Y * H, tier = f.tier[i]!, lane = f.lane[i]!;
  if (tier === 0) {
    if (y < y1) return { x: cx + lane * funnelHalfWidth(y, g) * 0.92, y, alpha: 0.8, tone: "FLOW" };
    // Rejected at the sieve: it bounces off sideways and fades (the over-fitted ones).
    const k = Math.min(1, (y - y1) / (H * 0.16));
    return { x: cx + lane * funnelHalfWidth(y1, g) * 0.92 + f.scatter[i]! * k * 1.6, y: y1 + (y - y1) * 0.35, alpha: 0.8 * (1 - k), tone: "REJECTED" };
  }
  const narrow = y < y1 ? 0.92 : 0.92 - 0.37 * Math.min(1, (y - y1) / (H * 0.1));
  const x = cx + lane * funnelHalfWidth(y, g) * narrow;
  if (tier === 1) {
    if (y < y2) return { x, y, alpha: 0.95, tone: "FLOW" };
    return { x, y: y2 - 2, alpha: Math.max(0, 1 - (y - y2) / (H * 0.14)), tone: "GATE" };
  }
  return { x, y: Math.min(y, H), alpha: 0.95 * (1 - Math.max(0, (y - H * 0.95) / (H * 0.17))), tone: "FLOW" };
}
