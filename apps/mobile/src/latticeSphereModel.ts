/**
 * The lattice sphere (UI/UX v6 phase 4d, design E; the owner chose "섬 대신 구" on 2026-11-25): a sphere of 162 nodes and 480 edges
 * that replaces the island on the live 지금 screen. Pure geometry and rules, no randomness: it shows only what the caller passes
 * (real count rises) and invents nothing. Presentation only.
 */
export type Vec3 = readonly [number, number, number];

export interface Lattice { readonly vertices: readonly Vec3[]; readonly edges: readonly (readonly [number, number])[] }

/** One light wave from a real decision (or order): where it started (a unit vector in model space) and when. */
export interface LatticePulse { readonly born: number; readonly order: boolean; readonly origin: Vec3 }

export const LATTICE_PULSE_MS = 2600;
export const LATTICE_FILL_MS = 1400;
export const LATTICE_MAX_PULSES = 8;
export const LATTICE_NODE_COUNT = 162;
export const LATTICE_EDGE_COUNT = 480;
/** Radians per second while live and allowed to move. */
export const LATTICE_YAW_RATE = 0.11;
export const LATTICE_TILT = 0.38;
export const LATTICE_REST_YAW = -0.5;

const normalize = (v: Vec3): Vec3 => { const n = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / n, v[1] / n, v[2] / n]; };

let cached: Lattice | null = null;

/** The same icosphere (frequency 4) every time. */
export function buildLattice(): Lattice {
  if (cached != null) return cached;
  const phi = (1 + Math.sqrt(5)) / 2;
  let vertices: Vec3[] = ([[-1, phi, 0], [1, phi, 0], [-1, -phi, 0], [1, -phi, 0], [0, -1, phi], [0, 1, phi], [0, -1, -phi], [0, 1, -phi], [phi, 0, -1], [phi, 0, 1], [-phi, 0, -1], [-phi, 0, 1]] as Vec3[]).map(normalize);
  let faces: (readonly [number, number, number])[] = [[0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11], [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8], [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9], [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1]];
  for (let round = 0; round < 2; round += 1) {
    const midpoint = new Map<number, number>();
    const mid = (a: number, b: number): number => {
      const key = Math.min(a, b) * 100_000 + Math.max(a, b);
      const found = midpoint.get(key);
      if (found != null) return found;
      const v = normalize([(vertices[a]![0] + vertices[b]![0]) / 2, (vertices[a]![1] + vertices[b]![1]) / 2, (vertices[a]![2] + vertices[b]![2]) / 2]);
      vertices = [...vertices, v];
      midpoint.set(key, vertices.length - 1);
      return vertices.length - 1;
    };
    const next: (readonly [number, number, number])[] = [];
    for (const [a, b, c] of faces) {
      const ab = mid(a, b), bc = mid(b, c), ca = mid(c, a);
      next.push([a, ab, ca], [b, bc, ab], [c, ca, bc], [ab, bc, ca]);
    }
    faces = next;
  }
  const seen = new Set<number>();
  const edges: (readonly [number, number])[] = [];
  for (const [a, b, c] of faces) for (const [p, q] of [[a, b], [b, c], [c, a]] as const) {
    const lo = Math.min(p, q), hi = Math.max(p, q), key = lo * 100_000 + hi;
    if (!seen.has(key)) { seen.add(key); edges.push([lo, hi]); }
  }
  cached = Object.freeze({ vertices: Object.freeze(vertices), edges: Object.freeze(edges) });
  return cached;
}

/** Rotate a model-space point by yaw (around the vertical axis) then tilt (around the horizontal axis). */
export function rotate(p: Vec3, yaw: number, tilt: number): Vec3 {
  const x1 = p[0] * Math.cos(yaw) + p[2] * Math.sin(yaw);
  const z1 = -p[0] * Math.sin(yaw) + p[2] * Math.cos(yaw);
  const y2 = p[1] * Math.cos(tilt) - z1 * Math.sin(tilt);
  const z2 = p[1] * Math.sin(tilt) + z1 * Math.cos(tilt);
  return [x1, y2, z2];
}

/** The inverse of rotate: a viewer-space point back into model space (so a pulse origin stays fixed on the sphere as it turns). */
export function unrotate(p: Vec3, yaw: number, tilt: number): Vec3 {
  const y1 = p[1] * Math.cos(tilt) + p[2] * Math.sin(tilt);
  const z1 = -p[1] * Math.sin(tilt) + p[2] * Math.cos(tilt);
  return [p[0] * Math.cos(yaw) - z1 * Math.sin(yaw), y1, p[0] * Math.sin(yaw) + z1 * Math.cos(yaw)];
}

/** The yaw: turning only while live and allowed to move; otherwise a fixed, calm pose. */
export function latticeYaw(seconds: number, live: boolean, moving: boolean): number {
  if (!live || !moving || !Number.isFinite(seconds)) return LATTICE_REST_YAW;
  return LATTICE_REST_YAW + seconds * LATTICE_YAW_RATE;
}

/** Light (0..1) a pulse puts on a point at angular distance `angle` from its origin, `ms` after it was born: a ring that travels over the sphere and fades. */
export function pulseLight(angle: number, ms: number): number {
  if (!(ms >= 0) || ms > LATTICE_PULSE_MS || !Number.isFinite(angle)) return 0;
  const k = ms / LATTICE_PULSE_MS;
  const front = k * Math.PI * 1.05;
  const d = (angle - front) / 0.32;
  return Math.exp(-d * d) * Math.pow(1 - k, 1.2);
}

export function angleBetween(a: Vec3, b: Vec3): number {
  return Math.acos(Math.max(-1, Math.min(1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2])));
}

export interface NodeLight { readonly light: number; readonly order: number }

/** The strongest wave on a node, and how much of it is an order wave (0..1). Without pulses both are 0: the sphere never lights by itself. */
export function nodeLight(vertex: Vec3, pulses: readonly LatticePulse[], now: number): NodeLight {
  let light = 0, order = 0;
  for (const p of pulses) {
    const l = pulseLight(angleBetween(vertex, p.origin), now - p.born);
    if (l > light) light = l;
    if (p.order && l > order) order = l;
  }
  return { light, order };
}

/** Whole-sphere white wash (0..1) `ms` after a real fill. */
export function fillWash(ms: number): number {
  if (!(ms >= 0) || ms > LATTICE_FILL_MS) return 0;
  const k = ms / LATTICE_FILL_MS;
  return Math.pow(1 - k, 2) * Math.min(1, ms / 100);
}

/** Opacity of a node by depth z (-1 back .. 1 front) and state. No data: grey and dimmer. */
export function nodeOpacity(z: number, live: boolean): number {
  const base = z > 0 ? 0.5 + 0.5 * z : 0.22;
  return live ? base : base * 0.55;
}

/** Radius of a node by depth. */
export function nodeRadius(z: number, scale: number): number {
  return (z > 0 ? 1.2 + 1.3 * z : 0.9) * scale;
}

/** Real count rises to pulses (capped); the last `orders` of them are order pulses. Origin = the point facing the viewer, given in model space. */
export function pulsesForCounts(prevDecisions: number | null, nextDecisions: number | null, prevOrders: number | null, nextOrders: number | null, now: number, origin: Vec3): readonly LatticePulse[] {
  const rise = (a: number | null, b: number | null): number => (a != null && b != null && Number.isSafeInteger(a) && Number.isSafeInteger(b) && b > a ? b - a : 0);
  const decisions = Math.min(LATTICE_MAX_PULSES, rise(prevDecisions, nextDecisions));
  const orders = Math.min(LATTICE_MAX_PULSES, rise(prevOrders, nextOrders));
  const total = Math.min(LATTICE_MAX_PULSES, Math.max(decisions, orders));
  const out: LatticePulse[] = [];
  for (let i = 0; i < total; i += 1) out.push({ born: now + i * 320, order: i >= total - orders, origin });
  return Object.freeze(out);
}
