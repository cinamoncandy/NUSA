/**
 * Particle scene for the Now screen's risk gate (redesign 2026-10-19, step 4). Pure and deterministic given a seed, so the motion is
 * testable without a renderer. It is presentation only: it draws that decisions keep arriving and that none passes the gate while
 * the consecutive-loss limit holds new buys. It reads no server value, so it cannot show an order, a fill or a changed limit.
 */
export const GATE_Y_RATIO = 0.68;
export const GATE_STREAMLINES = 16;
export const GATE_SETTLED_LIFE_SEC = 16;
const HEIGHT_BINS = 64;
const MAX_PILE_PX = 70;

export interface GateField {
  readonly count: number;
  readonly x0: Float32Array;
  readonly t: Float32Array;
  readonly v: Float32Array;
  readonly phase: Float32Array;
  readonly alpha: Float32Array;
  readonly size: Float32Array;
  readonly settledX: Float32Array;
  readonly settledY: Float32Array;
  readonly settledBorn: Float32Array;
  readonly heights: Float32Array;
  settledCount: number;
  timeSec: number;
  glow: number;
  readonly rng: () => number;
}

export interface GateGeometry { readonly width: number; readonly height: number }

export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const gateY = (g: GateGeometry): number => g.height * GATE_Y_RATIO;

function respawn(field: GateField, i: number, width: number, initial: boolean): void {
  const r = field.rng;
  field.x0[i] = width * (0.06 + 0.88 * r());
  field.t[i] = initial ? r() : 0;
  field.v[i] = 0.07 + r() * 0.09;
  field.phase[i] = r() * 6.2832;
  field.alpha[i] = 0.35 + r() * 0.6;
  field.size[i] = 1 + r() * 1.5;
}

export function createGateField(count: number, seed: number, width: number, settledCapacity = 2400): GateField {
  const field: GateField = {
    count, x0: new Float32Array(count), t: new Float32Array(count), v: new Float32Array(count), phase: new Float32Array(count),
    alpha: new Float32Array(count), size: new Float32Array(count),
    settledX: new Float32Array(settledCapacity), settledY: new Float32Array(settledCapacity), settledBorn: new Float32Array(settledCapacity).fill(-1e9),
    heights: new Float32Array(HEIGHT_BINS), settledCount: 0, timeSec: 0, glow: 0, rng: seededRandom(seed),
  };
  for (let i = 0; i < count; i += 1) respawn(field, i, width, true);
  return field;
}

const gauss = (r: () => number): number => (r() + r() + r() - 1.5) / 1.5;

/** Where a flowing particle is. It narrows toward the gate and never goes below it. */
export function gateParticlePoint(field: GateField, i: number, g: GateGeometry): { readonly x: number; readonly y: number; readonly u: number } {
  const u = Math.min(1, field.t[i]!);
  const e = Math.pow(u, 1.5);
  const cx = g.width / 2, k = g.width / 390;
  const x = field.x0[i]! + (cx - field.x0[i]!) * e * 0.8 + Math.sin(u * 7 + field.phase[i]!) * 9 * k * (1 - u * 0.7);
  return { x, y: 6 + u * (gateY(g) - 10), u };
}

/** Streamline i of GATE_STREAMLINES as polyline points, for the faint guide hairlines. */
export function gateStreamline(i: number, g: GateGeometry, steps = 24): readonly { readonly x: number; readonly y: number }[] {
  const x0 = g.width * (0.04 + 0.92 * (i / (GATE_STREAMLINES - 1))), cx = g.width / 2, k = g.width / 390, out: { x: number; y: number }[] = [];
  for (let s = 0; s <= steps; s += 1) {
    const u = s / steps, e = Math.pow(u, 1.5);
    out.push({ x: x0 + (cx - x0) * e * 0.8 + Math.sin(u * 7 + i * 0.9) * 9 * k * (1 - u * 0.7), y: 6 + u * (gateY(g) - 10) });
  }
  return out;
}

export function stepGateField(field: GateField, dtSec: number, g: GateGeometry): void {
  const dt = Math.max(0, Math.min(0.1, dtSec));
  field.timeSec += dt;
  const decay = Math.exp(-dt / 9);
  for (let b = 0; b < field.heights.length; b += 1) field.heights[b]! *= decay;
  field.glow *= Math.exp(-dt * 2.2);
  const cap = field.settledX.length, cx = g.width / 2, gy = gateY(g);
  for (let i = 0; i < field.count; i += 1) {
    field.t[i]! += field.v[i]! * dt;
    if (field.t[i]! < 1) continue;
    // Arrived at the gate: it waits in the pile in front of it. Nothing is ever placed past the gate line.
    const sx = Math.max(8, Math.min(g.width - 8, cx + gauss(field.rng) * g.width * 0.17));
    const bin = Math.min(HEIGHT_BINS - 1, Math.floor((sx / g.width) * HEIGHT_BINS)), h = field.heights[bin]!;
    field.heights[bin] = Math.min(MAX_PILE_PX, h + 0.9);
    const slot = field.settledCount % cap;
    field.settledX[slot] = sx; field.settledY[slot] = gy - 3 - h * (0.6 + field.rng() * 0.5); field.settledBorn[slot] = field.timeSec;
    field.settledCount += 1;
    field.glow = Math.min(1, field.glow + 0.05);
    respawn(field, i, g.width, false);
  }
}

/** Runs the scene forward without drawing, so a still frame (reduce-motion) already shows a settled pile. */
export function warmGateField(field: GateField, seconds: number, g: GateGeometry): void {
  for (let s = 0; s < seconds / 0.04; s += 1) stepGateField(field, 0.04, g);
}

/** 0..1 brightness of a settled particle; it fades out over GATE_SETTLED_LIFE_SEC. */
export function settledLight(field: GateField, slot: number): number {
  return Math.max(0, 1 - (field.timeSec - field.settledBorn[slot]!) / GATE_SETTLED_LIFE_SEC);
}
