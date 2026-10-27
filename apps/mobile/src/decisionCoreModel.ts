/**
 * Geometry and timing for the decision core, the main motion graphic of "지금" (owner-chosen 2026-10-21 from the
 * "판단 코어" prototype): a slowly turning sphere of points joined like a neural mesh. A real new decision sends a wave of
 * light across its surface; a real new PAPER order throws lime sparks out of it. Pure functions, no rendering.
 */
export type CoreTone = "live" | "limit" | "idle";
export type Vec3 = readonly [number, number, number];

export interface CoreWave { readonly origin: Vec3; readonly born: number }
export interface CoreBurst { readonly origin: Vec3; readonly born: number; readonly dirs: readonly Vec3[]; readonly speeds: readonly number[] }

export const CORE_POINTS = 220;
export const WAVE_MS = 2200;
export const BURST_MS = 1900;
export const MAX_WAVES = 6;
const WAVE_SPEED = 1.5; // radians of arc per second
const WAVE_WIDTH = 6;

/** Evenly spread points on the unit sphere (Fibonacci lattice). */
export function fibonacciSphere(n: number): Vec3[] {
  const out: Vec3[] = [];
  for (let i = 0; i < n; i += 1) {
    const y = 1 - (2 * (i + 0.5)) / n, r = Math.sqrt(Math.max(0, 1 - y * y)), th = i * 2.399963229728653;
    out.push([Math.cos(th) * r, y, Math.sin(th) * r]);
  }
  return out;
}

/** Up to `perPoint` short links from every other point to its near neighbours: the neural mesh. */
export function buildCoreLinks(points: readonly Vec3[], perPoint = 2): [number, number][] {
  const maxD2 = 16 / points.length; // neighbour spacing grows as the lattice gets sparser
  const links: [number, number][] = [];
  for (let i = 0; i < points.length; i += 2) {
    const a = points[i]!, near: { j: number; d: number }[] = [];
    for (let j = 0; j < points.length; j += 1) {
      if (j === i) continue;
      const b = points[j]!, d = (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;
      if (d < maxD2) near.push({ j, d });
    }
    near.sort((p, q) => p.d - q.d).slice(0, perPoint).forEach(({ j }) => links.push([i, j]));
  }
  return links;
}

/** How brightly a surface point is lit by the travelling wave fronts, 0..1. */
export function waveLight(p: Vec3, waves: readonly CoreWave[], nowMs: number): number {
  let e = 0;
  for (const w of waves) {
    const age = (nowMs - w.born) / 1000;
    if (age < 0 || age > WAVE_MS / 1000) continue;
    const dot = Math.max(-1, Math.min(1, p[0] * w.origin[0] + p[1] * w.origin[1] + p[2] * w.origin[2]));
    const d = Math.acos(dot) - age * WAVE_SPEED;
    e += Math.exp(-((d * WAVE_WIDTH) ** 2)) * (1 - age / (WAVE_MS / 1000));
  }
  return Math.min(1, e);
}

/** Rotate (yaw then a fixed pitch) and project to screen; `f` is the perspective scale, `z` < 0 faces the viewer. */
export function projectCore(p: Vec3, yaw: number, pitch: number, cx: number, cy: number, radius: number, scale: number): { x: number; y: number; z: number; f: number } {
  const cyw = Math.cos(yaw), syw = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch);
  const X = p[0] * cyw + p[2] * syw, Z0 = -p[0] * syw + p[2] * cyw;
  const Y = p[1] * cp - Z0 * sp, Z = p[1] * sp + Z0 * cp;
  const f = 2.6 / (2.6 + Z * 0.9);
  return { x: cx + X * radius * scale * f, y: cy + Y * radius * scale * f, z: Z, f };
}

/** Speeds of the sphere for each tone: turning (rad/s), breathing (rad/s) and breathing depth. The limit tone cools and slows. */
export function coreMotion(tone: CoreTone): { readonly spin: number; readonly breath: number; readonly depth: number; readonly shrink: number } {
  if (tone === "limit") return { spin: 0.035, breath: 0.45, depth: 0.012, shrink: 0.06 };
  if (tone === "idle") return { spin: 0.08, breath: 0.6, depth: 0.015, shrink: 0.03 };
  return { spin: 0.2, breath: 0.95, depth: 0.025, shrink: 0 };
}

/**
 * Waves for a rise in today's decision count: one per new decision, at most `cap`, spread over `spreadMs` so a refresh that brings
 * many at once still reads as separate thoughts. Nothing for a first reading, a fall (new day) or an unchanged count.
 */
export function wavesForDecisions(prev: number | null, next: number | null, nowMs: number, pick: (i: number) => Vec3, cap = 4, spreadMs = 3000): CoreWave[] {
  if (prev == null || next == null || next <= prev) return [];
  const n = Math.min(cap, next - prev);
  return Array.from({ length: n }, (_, i) => ({ origin: pick(i), born: nowMs + (n === 1 ? 0 : Math.round((spreadMs * i) / n)) }));
}

/** A burst of sparks for a rise in today's PAPER order count (at most `cap` bursts, half a second apart). */
export function burstsForOrders(prev: number | null, next: number | null, nowMs: number, pick: (i: number) => Vec3, rand: () => number, cap = 2): CoreBurst[] {
  if (prev == null || next == null || next <= prev) return [];
  const n = Math.min(cap, next - prev);
  return Array.from({ length: n }, (_, i) => {
    const origin = pick(i), dirs: Vec3[] = [], speeds: number[] = [];
    for (let s = 0; s < 14; s += 1) {
      const v: Vec3 = [origin[0] + (rand() - 0.5) * 0.5, origin[1] + (rand() - 0.5) * 0.5, origin[2] + (rand() - 0.5) * 0.5];
      const m = Math.hypot(v[0], v[1], v[2]) || 1;
      dirs.push([v[0] / m, v[1] / m, v[2] / m]); speeds.push(0.35 + rand() * 0.6);
    }
    return { origin, born: nowMs + i * 500, dirs, speeds };
  });
}
