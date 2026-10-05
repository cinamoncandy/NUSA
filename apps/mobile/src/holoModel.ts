/**
 * Pure state for the NUSA holo sphere. No imports, so tests can transpile it alone.
 *
 * Driven by runtime facts:
 * - each new decision sends a pulse ring and a bright streak out from the core;
 * - each new PAPER order draws a line from the core to a marker and flares it (burst / flash), then lets it settle back;
 * - a held / halted runtime tints the figure amber / red (halted also slows the spin).
 * The dust disc orbits slowly; it stops entirely under reduce-motion.
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
export const HOLO_COLORS: Readonly<Record<"cyan" | "violet" | "pink" | "mint" | "lime" | "fill" | "hold" | "halt", Rgb>> = Object.freeze({
  // Core burst, after the owner's reference: emerald and teal for the figure (white core), lime only for the active line and marker.
  // Names are kept for the ramp order. Status tints (fill / hold / halt) stay unmistakable: bright lime flash / amber / red.
  cyan: [104, 232, 166] as const,
  violet: [78, 208, 176] as const,
  pink: [150, 238, 170] as const,
  mint: [120, 232, 200] as const,
  lime: [198, 245, 74] as const,
  fill: [222, 255, 150] as const,
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
  if (toneColor) { const m = 0.95 * Math.min(1, Math.max(0, tintMix)); c = [c[0] + (toneColor[0] - c[0]) * m, c[1] + (toneColor[1] - c[1]) * m, c[2] + (toneColor[2] - c[2]) * m]; }
  if (flash > 0.05 && flashColor !== HOLO_COLORS.cyan) { const m = Math.min(1, flash); c = [c[0] + (flashColor[0] - c[0]) * m, c[1] + (flashColor[1] - c[1]) * m, c[2] + (flashColor[2] - c[2]) * m]; }
  return c;
}

/** Overshooting ease (back out): the sphere springs slightly past full size, then settles. */
export const easeOutBack = (t: number): number => { const x = Math.min(1, Math.max(0, t)) - 1; return 1 + 2.70158 * x * x * x + 1.70158 * x * x; };

/** The figure radius as a fraction of the canvas size. */
export const HOLO_RADIUS_FRACTION = 0.44;

/** Where the PAPER fill line ends (the marker), in canvas pixels, for a square canvas of `size`. */
export function holoFillMarker(size: number): { x: number; y: number } {
  const r = size * HOLO_RADIUS_FRACTION * BURST_FILL_REACH;
  return { x: size / 2 + Math.cos(BURST_FILL_ANGLE) * r, y: size / 2 + Math.sin(BURST_FILL_ANGLE) * r };
}

/** Placement of the market chip beside the fill marker inside a square canvas: right of the marker, clamped so it never leaves the canvas. */
export function holoChipPlacement(size: number, label: string): { left: number; top: number; width: number } {
  const marker = holoFillMarker(size);
  const width = Math.round(label.length * 6.7 + 16);
  return { left: Math.max(0, Math.min(Math.round(marker.x + 6), size - width)), top: Math.round(marker.y - 11), width };
}

/** Render budgets. State advances by elapsed time, so changing a budget never changes how fast things move. */
export const HOLO_ACTIVE_FRAME_MS = 42;
export const HOLO_QUIET_FRAME_MS = 56;
export const holoFrameBudgetMs = (quiet: boolean): number => (quiet ? HOLO_QUIET_FRAME_MS : HOLO_ACTIVE_FRAME_MS);
/** Tilt (squash) and rotation of the dust disc and its rings, as seen from the viewer. */
export const BURST_TILT = 0.38;
export const BURST_ROTATION = -0.18;
export const BURST_STREAK_COUNT = 70;
export const BURST_DUST_COUNT = 2600;

function lcg(seed: number): () => number {
  let state = seed % 2147483647;
  if (state <= 0) state += 2147483646;
  return () => (state = (state * 16807) % 2147483647) / 2147483647;
}

export interface BurstStreak { readonly angle: number; readonly inner: number; readonly length: number; readonly alpha: number; readonly width: number; readonly phase: number }
export interface DustSpeck { readonly radius: number; readonly angle: number; readonly size: number; readonly alpha: number; readonly bright: boolean }

let streakCache: readonly BurstStreak[] | null = null;
/** Fine, faint light streaks radiating from the core (lengths are fractions of the figure radius, 0.2..1.0). Deterministic. */
export function burstStreaks(): readonly BurstStreak[] {
  if (streakCache) return streakCache;
  const r = lcg(11), out: BurstStreak[] = [];
  for (let i = 0; i < BURST_STREAK_COUNT; i += 1) {
    out.push(Object.freeze({ angle: r() * Math.PI * 2, inner: 0.02 + r() * 0.05, length: 0.2 + Math.pow(r(), 1.5) * 0.8, alpha: 0.07 + r() * 0.3, width: 0.35 + r() * 0.45, phase: r() * Math.PI * 2 }));
  }
  streakCache = Object.freeze(out);
  return streakCache;
}

/** A streak breathes between 88% and 100% of its length. */
export const streakLength = (streak: BurstStreak, tSec: number): number => streak.length * (0.94 + 0.06 * Math.sin(tSec * 1.1 + streak.phase));

let dustCache: readonly DustSpeck[] | null = null;
/** Fine dust on a disc, denser and brighter toward the core (radius fractions 0.2..1.0). Deterministic. */
export function dustField(): readonly DustSpeck[] {
  if (dustCache) return dustCache;
  const r = lcg(7), out: DustSpeck[] = [];
  for (let i = 0; i < BURST_DUST_COUNT; i += 1) {
    const radius = 0.2 + r() * 0.8, d = 1 - radius;
    out.push(Object.freeze({ radius, angle: r() * Math.PI * 2, size: 0.35 + r() * 0.45, alpha: Math.min(0.9, 0.12 + 0.62 * d * d * (0.4 + r())), bright: r() < 0.35 }));
  }
  dustCache = Object.freeze(out);
  return dustCache;
}

/** Position of a speck on the tilted, rotated disc as offsets in units of the figure radius. Inner specks orbit faster. */
export function dustPosition(speck: DustSpeck, tSec: number, flowSec: number): { x: number; y: number } {
  const a = speck.angle + ((Math.PI * 2) / flowSec) * tSec * (1.5 - speck.radius);
  const px = Math.cos(a) * speck.radius, py = Math.sin(a) * speck.radius * BURST_TILT;
  return { x: px * Math.cos(BURST_ROTATION) - py * Math.sin(BURST_ROTATION), y: px * Math.sin(BURST_ROTATION) + py * Math.cos(BURST_ROTATION) };
}

export interface HoloPulse { readonly angle: number; readonly ringRadius: number; readonly ringAlpha: number; readonly streakLength: number; readonly streakAlpha: number }
/** One decision wave as a ring that grows from the core plus a bright streak that shoots out along the wave's angle; null outside its life. */
export function pulseFor(wave: HoloWave, nowMs: number): HoloPulse | null {
  const age = (nowMs - wave.bornMs) / HOLO_WAVE_MS;
  if (age < 0 || age > 1) return null;
  const angle = Math.atan2(wave.az, wave.ax);
  const out = 1 - Math.pow(1 - age, 3);
  return Object.freeze({ angle, ringRadius: 0.1 + 0.9 * out, ringAlpha: 0.5 * (1 - age), streakLength: 1.15 * out, streakAlpha: 0.9 * (1 - age) });
}

/** Where the PAPER fill line points (radians, lower right like the reference) and how far out its marker sits (fraction of the radius). */
export const BURST_FILL_ANGLE = 1.05;
export const BURST_FILL_REACH = 1.0;

/** True when nothing but the ambient spin is moving. */
export function isHoloQuiet(state: HoloState): boolean {
  return state.waves.length === 0 && state.burst === 0 && state.burstTarget === 0 && state.flash < 0.02 && state.birth >= 1;
}
