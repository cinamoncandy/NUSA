/**
 * Pure state for the NUSA holo sphere. No imports, so tests can transpile it alone.
 *
 * Driven by runtime facts:
 * - each new decision sends one wave across the sphere surface;
 * - each new PAPER order pushes the crystal outward (HOLO_FILL_EXPANSION), tints it green, then lets it settle back;
 * - a held / halted runtime tints the sphere amber / red (halted also slows the spin).
 * The slow spin is ambient; it stops entirely under reduce-motion.
 */
export type HoloTone = "normal" | "hold" | "halt";
export type Rgb = readonly [number, number, number];

export interface HoloWave { readonly bornMs: number; readonly ax: number; readonly ay: number; readonly az: number; readonly amp: number }
export interface HoloState {
  readonly spin: number;
  readonly burst: number;
  readonly burstTarget: number;
  readonly flash: number;
  readonly flashColor: Rgb;
  readonly waves: readonly HoloWave[];
  /** 0..1 progress of the bloom entrance; 1 once open. */
  readonly birth: number;
  /** 0..1 how far the tone tint (hold / halt) has faded in; eased so a status change never snaps. */
  readonly tintMix: number;
  readonly decisionCount: number | null;
  readonly fillCount: number | null;
}

export const HOLO_WAVE_MS = 2600;
export const HOLO_COLORS: Readonly<Record<"cyan" | "violet" | "pink" | "mint" | "fill" | "hold" | "halt", Rgb>> = Object.freeze({
  // Cold future: ice cyan, violet, magenta, mint. Status tints (fill / hold / halt) stay the unmistakable green / amber / red.
  cyan: [124, 214, 255] as const,
  violet: [170, 130, 255] as const,
  pink: [255, 130, 200] as const,
  mint: [110, 240, 220] as const,
  fill: [110, 240, 176] as const,
  hold: [255, 194, 102] as const,
  halt: [255, 122, 122] as const,
});

/** Ink-bloom entrance: how long the sphere takes to open from the core on first appearance. */
export const HOLO_BIRTH_MS = 1700;
/** Eases 0..1 (cubic out), so the bloom starts fast like ink meeting paper and settles softly. */
export const easeOutCubic = (t: number): number => 1 - Math.pow(1 - Math.min(1, Math.max(0, t)), 3);

export function initialHoloState(): HoloState {
  return Object.freeze({ spin: 0, burst: 0, burstTarget: 0, flash: 0, flashColor: HOLO_COLORS.cyan, waves: Object.freeze([]), birth: 0, tintMix: 0, decisionCount: null, fillCount: null });
}

/** Fibonacci sphere: evenly spread unit vectors. */
export function spherePoints(count: number): Float32Array {
  const out = new Float32Array(count * 3);
  const golden = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < count; i += 1) {
    const y = 1 - (2 * (i + 0.5)) / count, r = Math.sqrt(1 - y * y), th = i * golden;
    out[i * 3] = Math.cos(th) * r; out[i * 3 + 1] = y; out[i * 3 + 2] = Math.sin(th) * r;
  }
  return out;
}

/** Deterministic wave origin for decision n, so the figure is reproducible. */
export function waveFor(decision: number, nowMs: number): HoloWave {
  const th = decision * 2.399, ph = Math.acos(Math.cos(decision * 0.73));
  return Object.freeze({ bornMs: nowMs, ax: Math.sin(ph) * Math.cos(th), ay: Math.cos(ph), az: Math.sin(ph) * Math.sin(th), amp: 0.09 });
}

/**
 * Folds the latest runtime counts in. The first observation and counters that go backwards
 * (runtime restart) only set a baseline. Several decisions between polls add at most three waves.
 */
export function observeHolo(state: HoloState, decisionCount: number | null, fillCount: number | null, nowMs: number): HoloState {
  if (state.decisionCount == null || state.fillCount == null || decisionCount == null || fillCount == null
    || decisionCount < state.decisionCount || fillCount < state.fillCount) {
    return Object.freeze({ ...state, decisionCount, fillCount });
  }
  let next: HoloState = state;
  const newDecisions = Math.min(3, decisionCount - state.decisionCount);
  if (newDecisions > 0) {
    const waves = [...state.waves];
    for (let i = 0; i < newDecisions; i += 1) waves.push(waveFor(decisionCount - i, nowMs - i * 400));
    next = Object.freeze({ ...next, waves: Object.freeze(waves.slice(-6)), flash: Math.max(next.flash, 0.25) });
  }
  if (fillCount > state.fillCount) next = Object.freeze({ ...next, burstTarget: 1, flash: 1, flashColor: HOLO_COLORS.fill });
  return Object.freeze({ ...next, decisionCount, fillCount });
}

/** One animation tick (dtMs since the last). */
export function tickHolo(state: HoloState, tone: HoloTone, dtMs: number, nowMs: number): HoloState {
  const k = Math.min(1, dtMs / 16.7);
  const spin = state.spin + 0.0000714 * dtMs * (tone === "halt" ? 0.1 : 1);
  let burst = state.burst + (state.burstTarget - state.burst) * 0.06 * k;
  let burstTarget = state.burstTarget;
  if (burstTarget > 0 && burst > 0.95) burstTarget = 0;
  if (burstTarget === 0 && burst < 0.001) burst = 0;
  const flash = state.flash * Math.pow(0.975, k);
  const birth = Math.min(1, state.birth + dtMs / HOLO_BIRTH_MS);
  const tintTarget = tone === "normal" ? 0 : 1;
  const tintStep = 1 - Math.pow(0.92, dtMs / 84);
  const tintMix = Math.abs(tintTarget - state.tintMix) < 0.002 ? tintTarget : state.tintMix + (tintTarget - state.tintMix) * tintStep;
  const waves = state.waves.filter((wave) => nowMs - wave.bornMs < HOLO_WAVE_MS);
  return Object.freeze({ ...state, spin, burst, burstTarget, flash, birth, tintMix, waves: waves.length === state.waves.length ? state.waves : Object.freeze(waves) });
}

/** Wave displacement at a unit point. */
export function waveDisplacement(waves: readonly HoloWave[], px: number, py: number, pz: number, nowMs: number): number {
  let disp = 0;
  for (const wave of waves) {
    const age = (nowMs - wave.bornMs) / HOLO_WAVE_MS;
    if (age < 0 || age > 1) continue;
    const dot = Math.max(-1, Math.min(1, px * wave.ax + py * wave.ay + pz * wave.az));
    const d = Math.acos(dot) - age * Math.PI;
    disp += wave.amp * Math.exp(-d * d * 30) * (1 - age);
  }
  return disp;
}

/** Iridescent colour by surface direction, then tinted by tone and flash. */
export function holoColor(px: number, py: number, pz: number, tone: HoloTone, flash: number, flashColor: Rgb, tintMix = 1): Rgb {
  const ramp = [HOLO_COLORS.cyan, HOLO_COLORS.violet, HOLO_COLORS.pink, HOLO_COLORS.mint, HOLO_COLORS.cyan];
  const h = ((Math.atan2(pz, px) / (Math.PI * 2) + 0.5 + py * 0.25) % 1 + 1) % 1 * 4;
  const i = Math.floor(h), f = h - i, a = ramp[i], b = ramp[i + 1];
  let c: [number, number, number] = [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f];
  const toneColor = tone === "halt" ? HOLO_COLORS.halt : tone === "hold" ? HOLO_COLORS.hold : null;
  if (toneColor) { const m = 0.8 * Math.min(1, Math.max(0, tintMix)); c = [c[0] + (toneColor[0] - c[0]) * m, c[1] + (toneColor[1] - c[1]) * m, c[2] + (toneColor[2] - c[2]) * m]; }
  if (flash > 0.05 && flashColor !== HOLO_COLORS.cyan) { const m = Math.min(1, flash); c = [c[0] + (flashColor[0] - c[0]) * m, c[1] + (flashColor[1] - c[1]) * m, c[2] + (flashColor[2] - c[2]) * m]; }
  return c;
}

export interface CrystalGeometry { readonly vertices: readonly (readonly [number, number, number])[]; readonly edges: readonly (readonly [number, number])[]; }
let crystalCache: CrystalGeometry | null = null;

/** Once-subdivided icosahedron on the unit sphere: 42 vertices, 120 edges. Deterministic. */
export function crystalGeometry(): CrystalGeometry {
  if (crystalCache) return crystalCache;
  const t = (1 + Math.sqrt(5)) / 2;
  const base: [number, number, number][] = [[-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0], [0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t], [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1]];
  const faces = [[0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11], [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8], [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9], [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1]];
  const norm = (v: readonly number[]): [number, number, number] => { const l = Math.hypot(v[0], v[1], v[2]); return [v[0] / l, v[1] / l, v[2] / l]; };
  const vertices: [number, number, number][] = base.map(norm);
  const mid = new Map<string, number>();
  const midpoint = (a: number, b: number): number => {
    const key = a < b ? `${a}:${b}` : `${b}:${a}`;
    const hit = mid.get(key);
    if (hit !== undefined) return hit;
    vertices.push(norm([(vertices[a][0] + vertices[b][0]) / 2, (vertices[a][1] + vertices[b][1]) / 2, (vertices[a][2] + vertices[b][2]) / 2]));
    mid.set(key, vertices.length - 1);
    return vertices.length - 1;
  };
  const edgeSet = new Set<string>();
  const edges: [number, number][] = [];
  const addEdge = (a: number, b: number) => { const key = a < b ? `${a}:${b}` : `${b}:${a}`; if (!edgeSet.has(key)) { edgeSet.add(key); edges.push([a, b]); } };
  for (const [a, b, c] of faces) {
    const ab = midpoint(a, b), bc = midpoint(b, c), ca = midpoint(c, a);
    for (const tri of [[a, ab, ca], [b, bc, ab], [c, ca, bc], [ab, bc, ca]]) { addEdge(tri[0], tri[1]); addEdge(tri[1], tri[2]); addEdge(tri[2], tri[0]); }
  }
  crystalCache = Object.freeze({ vertices: Object.freeze(vertices), edges: Object.freeze(edges) });
  return crystalCache;
}

/** Overshooting ease (back out): the sphere springs slightly past full size, then settles. */
export const easeOutBack = (t: number): number => { const x = Math.min(1, Math.max(0, t)) - 1; return 1 + 2.70158 * x * x * x + 1.70158 * x * x; };

/** Render budgets. State advances by elapsed time, so changing a budget never changes how fast things move. */
export const HOLO_ACTIVE_FRAME_MS = 42;
export const HOLO_QUIET_FRAME_MS = 56;
export const holoFrameBudgetMs = (quiet: boolean): number => (quiet ? HOLO_QUIET_FRAME_MS : HOLO_ACTIVE_FRAME_MS);
/** Extra radius at the fill peak; small enough that the crystal and its rings stay inside the canvas. */
export const HOLO_FILL_EXPANSION = 0.1;
export const HOLO_RING_COUNT = 2;
export const HOLO_RING_POINTS = 72;

/** 0..1 brightness boost for a point at height py (-1..1) while a scan band sweeps down the sphere and back. */
export function scanBoost(py: number, nowMs: number, periodMs: number): number {
  const phase = (nowMs % periodMs) / periodMs;
  const centre = Math.sin(phase * Math.PI * 2) * 0.9;
  const d = py - centre;
  return Math.exp(-d * d * 60);
}

/** Position of point k of orbit ring r at angle `spin`: a tilted circle of radius 1.18 + 0.12 r. */
export function ringPoint(r: number, k: number, spin: number): { x: number; y: number; z: number } {
  const a = (k / HOLO_RING_POINTS) * Math.PI * 2 + spin * (r === 0 ? 1 : -1.4);
  const rad = 1.18 + 0.12 * r, tilt = r === 0 ? 0.9 : -0.5, c = Math.cos(a) * rad, s = Math.sin(a) * rad;
  return { x: c, y: s * Math.sin(tilt), z: s * Math.cos(tilt) };
}

/** True when nothing but the ambient spin is moving. */
export function isHoloQuiet(state: HoloState): boolean {
  return state.waves.length === 0 && state.burst === 0 && state.burstTarget === 0 && state.flash < 0.02 && state.birth >= 1;
}
