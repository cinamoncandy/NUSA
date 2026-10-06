/**
 * Pure state for the NUSA flow-field hero. No imports, so tests can transpile it alone.
 *
 * The figure, after the owner's reference: fine hairlines stream in from the left toward a curved ruler, a white marker rides the ruler,
 * and on the right a wall of thin bars stands against it. Driven by runtime facts:
 * - each new decision lights one row of the wall (and the hairlines beside it) and moves the marker to that row;
 * - each new PAPER order sends a lime band across the whole field to a marker on the right edge, then lets it settle back;
 * - a held / halted runtime tints the white figure amber / red (halted also slows the flow to a near stop).
 * Everything moves with elapsed time; it stops entirely under reduce-motion.
 */
export type HoloTone = "normal" | "hold" | "halt";
export type Rgb = readonly [number, number, number];

export interface HoloWave { readonly bornMs: number; readonly ax: number; readonly ay: number; readonly az: number; readonly amp: number }
export interface HoloState {
  /** The flow clock in radians-equivalent units; it advances with elapsed time and nearly stops while halted. */
  readonly spin: number;
  readonly burst: number;
  readonly burstTarget: number;
  readonly flash: number;
  readonly flashColor: Rgb;
  readonly waves: readonly HoloWave[];
  /** 0..1 progress of the entrance; 1 once open. */
  readonly birth: number;
  /** 0..1 how far the tone tint (hold / halt) has faded in; eased so a status change never snaps. */
  readonly tintMix: number;
  /** The wall row the latest decision lit (the ruler marker rides to it); null before any decision. */
  readonly markRow: number | null;
  readonly decisionCount: number | null;
  readonly fillCount: number | null;
}

export const HOLO_WAVE_MS = 2600;
export const HOLO_COLORS: Readonly<Record<"cyan" | "violet" | "pink" | "mint" | "lime" | "fill" | "hold" | "halt" | "ink", Rgb>> = Object.freeze({
  // The figure itself is cool white ink (after the owner's reference); lime is the one accent, for the order band and its marker.
  // The emerald ramp names are kept for the tint maths and the tests that pin it. Status tints (fill / hold / halt) stay unmistakable.
  cyan: [104, 232, 166] as const,
  violet: [78, 208, 176] as const,
  pink: [150, 238, 170] as const,
  mint: [120, 232, 200] as const,
  lime: [198, 245, 74] as const,
  fill: [222, 255, 150] as const,
  hold: [255, 194, 102] as const,
  halt: [255, 122, 122] as const,
  ink: [232, 240, 242] as const,
});

/** Entrance: how long the field takes to open on first appearance. */
export const HOLO_BIRTH_MS = 1700;
/** Eases 0..1 (cubic out), so the entrance starts fast and settles softly. */
export const easeOutCubic = (t: number): number => 1 - Math.pow(1 - Math.min(1, Math.max(0, t)), 3);

export function initialHoloState(): HoloState {
  return Object.freeze({ spin: 0, burst: 0, burstTarget: 0, flash: 0, flashColor: HOLO_COLORS.ink, waves: Object.freeze([]), birth: 0, tintMix: 0, markRow: null, decisionCount: null, fillCount: null });
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

/** The wall row (0..FLOW_ROWS-1) a decision's wave lights: the wave's direction mapped onto the rows, so successive decisions land on different rows. */
export function waveRow(wave: HoloWave): number {
  const turn = ((Math.atan2(wave.az, wave.ax) / (Math.PI * 2) + 0.5) % 1 + 1) % 1;
  return Math.min(FLOW_ROWS - 1, Math.floor(turn * FLOW_ROWS));
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
    next = Object.freeze({ ...next, waves: Object.freeze(waves.slice(-6)), flash: Math.max(next.flash, 0.25), markRow: waveRow(waves[waves.length - newDecisions]!) });
  }
  if (fillCount > state.fillCount) next = Object.freeze({ ...next, burstTarget: 1, flash: 1, flashColor: HOLO_COLORS.fill });
  return Object.freeze({ ...next, decisionCount, fillCount });
}

/** The flow clock, in seconds of ambient motion: it follows the state's own clock, so a halted runtime nearly stops it. */
export const FLOW_CLOCK_RATE = 0.0000714;
export const flowClockSec = (state: HoloState): number => state.spin / FLOW_CLOCK_RATE / 1000;

/** One animation tick (dtMs since the last). */
export function tickHolo(state: HoloState, tone: HoloTone, dtMs: number, nowMs: number): HoloState {
  const k = Math.min(1, dtMs / 16.7);
  const spin = state.spin + FLOW_CLOCK_RATE * dtMs * (tone === "halt" ? 0.1 : 1);
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

/** Mixes a base colour toward the hold / halt tint (tintMix 0..1), then toward a fill flash. */
function tinted(base: Rgb, tone: HoloTone, flash: number, flashColor: Rgb, tintMix: number): Rgb {
  let c: [number, number, number] = [base[0], base[1], base[2]];
  const toneColor = tone === "halt" ? HOLO_COLORS.halt : tone === "hold" ? HOLO_COLORS.hold : null;
  if (toneColor) { const m = 0.95 * Math.min(1, Math.max(0, tintMix)); c = [c[0] + (toneColor[0] - c[0]) * m, c[1] + (toneColor[1] - c[1]) * m, c[2] + (toneColor[2] - c[2]) * m]; }
  if (flash > 0.05 && flashColor !== HOLO_COLORS.cyan && flashColor !== HOLO_COLORS.ink) { const m = Math.min(1, flash); c = [c[0] + (flashColor[0] - c[0]) * m, c[1] + (flashColor[1] - c[1]) * m, c[2] + (flashColor[2] - c[2]) * m]; }
  return c;
}

/** Iridescent colour by surface direction, then tinted by tone and flash. */
export function holoColor(px: number, py: number, pz: number, tone: HoloTone, flash: number, flashColor: Rgb, tintMix = 1): Rgb {
  const ramp = [HOLO_COLORS.cyan, HOLO_COLORS.violet, HOLO_COLORS.pink, HOLO_COLORS.mint, HOLO_COLORS.cyan];
  const h = ((Math.atan2(pz, px) / (Math.PI * 2) + 0.5 + py * 0.25) % 1 + 1) % 1 * 4;
  const i = Math.floor(h), f = h - i, a = ramp[i]!, b = ramp[i + 1]!;
  return tinted([a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f], tone, flash, flashColor, tintMix);
}

/** The figure's white ink, tinted amber / red by tone (a fill flash does not recolour the ink: the lime band carries it). */
export function holoInk(tone: HoloTone, tintMix: number): Rgb {
  return tinted(HOLO_COLORS.ink, tone, 0, HOLO_COLORS.ink, tintMix);
}

/** Overshooting ease (back out): a mark springs slightly past full size, then settles. */
export const easeOutBack = (t: number): number => { const x = Math.min(1, Math.max(0, t)) - 1; return 1 + 2.70158 * x * x * x + 1.70158 * x * x; };

/** Render budgets. State advances by elapsed time, so changing a budget never changes how fast things move. */
export const HOLO_ACTIVE_FRAME_MS = 42;
export const HOLO_QUIET_FRAME_MS = 56;
export const holoFrameBudgetMs = (quiet: boolean): number => (quiet ? HOLO_QUIET_FRAME_MS : HOLO_ACTIVE_FRAME_MS);

// ---------------------------------------------------------------------------------------------------------------------------------
// The flow field. All geometry is in fractions of the (square) canvas: x to the right, y downward, both 0..1.
// ---------------------------------------------------------------------------------------------------------------------------------

/** Rows in the wall of bars, and hairlines in the stream. */
export const FLOW_ROWS = 110;
export const FLOW_LINE_COUNT = 380;
/** Where the ruler sits at the vertical centre, and the radius of its curve (in canvas sizes): it bows right at the middle and bends away at the ends. */
export const FLOW_ARC_X = 0.5;
export const FLOW_ARC_RADIUS = 1.1;
/** Vertical position of the order band and how many rows it covers. */
export const FLOW_BAND_Y = 0.62;
export const FLOW_BAND_ROWS = 8;
/** Right end of the wall and of the order band, as a fraction of the canvas width. */
export const FLOW_WALL_END = 0.965;

function lcg(seed: number): () => number {
  let state = seed % 2147483647;
  if (state <= 0) state += 2147483646;
  return () => (state = (state * 16807) % 2147483647) / 2147483647;
}

/** x of the ruler at height y (both fractions). It is the arc of a circle whose centre lies to the left of the canvas. */
export function flowArcX(y: number): number {
  const dy = y - 0.5, cx = FLOW_ARC_X - FLOW_ARC_RADIUS;
  return cx + Math.sqrt(Math.max(0, FLOW_ARC_RADIUS * FLOW_ARC_RADIUS - dy * dy));
}

export interface FlowLine { readonly y: number; readonly slope: number; readonly length: number; readonly alpha: number; readonly width: number; readonly speed: number; readonly phase: number }
let lineCache: readonly FlowLine[] | null = null;
/** The hairlines of the stream: thin, faint, slightly slanted, each with its own speed. Deterministic. */
export function flowLines(): readonly FlowLine[] {
  if (lineCache) return lineCache;
  const r = lcg(23), out: FlowLine[] = [];
  for (let i = 0; i < FLOW_LINE_COUNT; i += 1) {
    out.push(Object.freeze({ y: r(), slope: (r() - 0.5) * 0.8, length: 0.1 + Math.pow(r(), 1.3) * 0.55, alpha: 0.14 + r() * 0.4, width: 0.35 + r() * 0.5, speed: 0.025 + r() * 0.06, phase: r() }));
  }
  lineCache = Object.freeze(out);
  return lineCache;
}

export interface FlowSegment { readonly x0: number; readonly y0: number; readonly x1: number; readonly y1: number; readonly alpha: number }
/** One hairline at time tSec: its head travels from the left edge to the ruler, and it brightens as it nears it. Never leaves 0..ruler. */
export function flowSegment(line: FlowLine, tSec: number): FlowSegment {
  const head = ((line.phase + tSec * line.speed) % 1 + 1) % 1;
  const reach = flowArcX(line.y);
  const hx = head * reach, tx = Math.max(0, hx - line.length * reach);
  const at = (x: number): number => Math.min(1, Math.max(0, line.y + line.slope * (x - reach * 0.5)));
  return Object.freeze({ x0: tx, y0: at(tx), x1: hx, y1: at(hx), alpha: line.alpha * (0.3 + 0.7 * head) });
}

export interface WallRow { readonly y: number; readonly base: number; readonly phase: number; readonly bright: boolean }
let wallCache: readonly WallRow[] | null = null;
/** The wall of bars: each row's resting length is a fraction of the room between the ruler and the right edge. Long toward the top and bottom, ragged, deterministic. */
export function wallRows(): readonly WallRow[] {
  if (wallCache) return wallCache;
  const r = lcg(41), out: WallRow[] = [];
  for (let i = 0; i < FLOW_ROWS; i += 1) {
    const y = (i + 0.5) / FLOW_ROWS, edge = Math.abs(y - 0.55) * 2; // 0 at the middle band, 1 at the ends
    out.push(Object.freeze({ y, base: Math.min(1, 0.16 + 0.5 * edge + 0.42 * r() * r() + 0.2 * r()), phase: r() * Math.PI * 2, bright: r() < 0.68 }));
  }
  wallCache = Object.freeze(out);
  return wallCache;
}

export interface WallBar { readonly x0: number; readonly x1: number; readonly y: number; readonly alpha: number }
/** One bar at time tSec; it breathes by up to 8% of its length. `grow` (0..1) is the entrance. */
export function wallBar(row: WallRow, tSec: number, grow: number): WallBar {
  const x0 = flowArcX(row.y) + 0.018, room = FLOW_WALL_END - x0;
  const length = row.base * (0.92 + 0.08 * Math.sin(tSec * 0.9 + row.phase)) * Math.min(1, Math.max(0, grow));
  return Object.freeze({ x0, x1: x0 + room * length, y: row.y, alpha: row.bright ? 0.86 : 0.5 });
}

/** The ruler's ticks: heights along it, every fifth one long. */
export const FLOW_TICKS = 49;
export const flowTick = (i: number): { y: number; long: boolean } => ({ y: 0.02 + (0.96 * i) / (FLOW_TICKS - 1), long: i % 5 === 0 });

export interface FlowPulse { readonly row: number; readonly glow: number; readonly reach: number }
/** One decision wave as a lit wall row: its glow fades over the wave's life; null outside it. */
export function pulseFor(wave: HoloWave, nowMs: number): FlowPulse | null {
  const age = (nowMs - wave.bornMs) / HOLO_WAVE_MS;
  if (age < 0 || age > 1) return null;
  const out = 1 - Math.pow(1 - Math.min(1, age * 3), 3);
  return Object.freeze({ row: waveRow(wave), glow: 1 - age, reach: 0.55 + 0.45 * out });
}

/** The rows the order band covers (centred on FLOW_BAND_Y). */
export function flowBandRows(): { first: number; last: number } {
  const center = Math.round(FLOW_BAND_Y * FLOW_ROWS - 0.5), half = Math.floor(FLOW_BAND_ROWS / 2);
  return { first: center - half, last: center + half };
}

/** Where the order band ends (the marker), in canvas pixels for a square canvas of `size`: the right end of the wall, at the band's height. */
export function holoFillMarker(size: number): { x: number; y: number } {
  return { x: size * FLOW_WALL_END, y: size * FLOW_BAND_Y };
}

/** Placement of the market chip above the band's end inside a square canvas: right-aligned, clamped so it never leaves the canvas. */
export function holoChipPlacement(size: number, label: string): { left: number; top: number; width: number } {
  const marker = holoFillMarker(size);
  const width = Math.round(label.length * 6.7 + 16);
  return { left: Math.max(0, Math.min(Math.round(marker.x - width), size - width)), top: Math.max(0, Math.round(marker.y - 34)), width };
}

/** True when nothing but the ambient flow is moving. */
export function isHoloQuiet(state: HoloState): boolean {
  return state.waves.length === 0 && state.burst === 0 && state.burstTarget === 0 && state.flash < 0.02 && state.birth >= 1;
}
