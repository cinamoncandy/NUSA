/**
 * Pure state for the NUSA flow-field hero. No imports, so tests can transpile it alone.
 *
 * The figure ("능선", owner-chosen 2026-10-06): a receding landscape of hairline ridges flowing toward the viewer. Driven by runtime facts:
 * - each new decision sends a bright wave from the horizon rolling forward through the ridges;
 * - each new PAPER order raises a peak in the landscape with a lime light beam, and its ridge glows lime, then it settles;
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

/** The ridge row (0..RIDGE_ROWS-1) a decision is associated with, so successive decisions land on different rows. */
export function waveRow(wave: HoloWave): number {
  const turn = ((Math.atan2(wave.az, wave.ax) / (Math.PI * 2) + 0.5) % 1 + 1) % 1;
  return Math.min(RIDGE_ROWS - 1, Math.floor(turn * RIDGE_ROWS));
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

// ---- Ridge landscape (owner-chosen 2026-10-06, "능선") -------------------------------------------------------------------
// A receding landscape of hairline ridges flowing toward the viewer. All coordinates are 0..1 of a square canvas.
export const RIDGE_ROWS = 48;
export const RIDGE_COLS = 72;
export const RIDGE_HORIZON = 0.2;
export const RIDGE_NEAR = 0.97;
/** Where a PAPER order rises: a depth on the landscape and a column just right of centre. */
export const RIDGE_ORDER_DEPTH = 0.42;
export const RIDGE_ORDER_U = 0.56;
/** How fast the landscape slides toward the viewer, in rows per second of the flow clock. */
export const RIDGE_SLIDE = 1.7;

const hash1 = (k: number): number => { const s = Math.sin(k * 127.1) * 43758.5453; return s - Math.floor(s); };
function valueNoise(x: number): number { const i = Math.floor(x), f = x - i, u = f * f * (3 - 2 * f); return hash1(i) * (1 - u) + hash1(i + 1) * u; }
/** Smooth deterministic terrain noise in 0..~1. */
export function ridgeNoise(x: number, y: number): number {
  let v = 0, a = 0.5, f = 1;
  for (let o = 0; o < 3; o += 1) { v += a * valueNoise(x * f + y * f * 1.7 + o * 31.3); a *= 0.5; f *= 2.1; }
  return v;
}

/** Depth (0 near .. 1 far) of ridge row r at flow time tSec; rows slide toward the viewer and wrap. */
export function ridgeDepth(row: number, rows: number, tSec: number): number {
  // Each row advances by a fraction of one row spacing; depths stay strictly ordered in (0, 1].
  const frac = ((tSec * RIDGE_SLIDE) % 1 + 1) % 1;
  return (row + 1 - frac) / rows;
}

/** Screen baseline y (0..1) for a depth: far rows bunch near the horizon. */
export const ridgeBaseY = (depth: number): number => RIDGE_HORIZON + (RIDGE_NEAR - RIDGE_HORIZON) * Math.pow(1 - depth, 2.2);
/** Screen x (0..1) for column u at a depth: the landscape narrows toward the horizon. */
export const ridgeX = (u: number, depth: number): number => 0.5 + (u - 0.5) * (0.35 + 0.65 * (1 - depth)) * 1.25;

/** Height (0..1 of the canvas, upward) of the terrain at column u, depth, flow time, plus an order's rise (0..1). */
export function ridgeHeight(u: number, depth: number, tSec: number, orderRise: number): number {
  const xw = (u - 0.5) * (0.35 + 0.65 * (1 - depth));
  const centre = Math.exp(-Math.pow(xw / 0.22, 2));
  const amp = 0.17 * (1 - depth * 0.75);
  let h = ridgeNoise(u * 6 + 3, depth * 9 + tSec * 0.32) * centre * amp;
  if (orderRise > 0) h += Math.exp(-Math.pow((u - RIDGE_ORDER_U) / 0.025, 2)) * Math.exp(-Math.pow((depth - RIDGE_ORDER_DEPTH) / 0.03, 2)) * 0.13 * orderRise;
  return h;
}

/** How brightly a decision's wave lights a row at this depth: the wave is born on the horizon and rolls toward the viewer. */
export function ridgeWaveGlow(wave: HoloWave, depth: number, nowMs: number): number {
  const age = (nowMs - wave.bornMs) / HOLO_WAVE_MS;
  if (age < 0 || age >= 1) return 0;
  const front = 1 - age;
  const d = Math.abs(depth - front);
  return d < 0.06 ? (1 - d / 0.06) * (1 - age) : 0;
}

/** How much a row is lime because a PAPER order is rising beside it (0..1). */
export const ridgeOrderMix = (depth: number, burst: number): number => {
  const d = Math.abs(depth - RIDGE_ORDER_DEPTH);
  return burst > 0.02 && d < 0.03 ? (1 - d / 0.03) * burst : 0;
};

/** Base brightness of a row: near rows are brighter. */
export const ridgeRowAlpha = (depth: number): number => 0.1 + 0.55 * Math.pow(1 - depth, 1.3);

/** Where the order's light beam stands (its foot), in canvas pixels for a square canvas of `size`. */
export function holoFillMarker(size: number): { x: number; y: number } {
  return { x: size * ridgeX(RIDGE_ORDER_U, RIDGE_ORDER_DEPTH), y: size * (ridgeBaseY(RIDGE_ORDER_DEPTH) - 0.15) };
}

/** Placement of the market chip beside the beam inside a square canvas: clamped so it never leaves the canvas. */
export function holoChipPlacement(size: number, label: string): { left: number; top: number; width: number } {
  const marker = holoFillMarker(size);
  const width = Math.round(label.length * 6.7 + 16);
  return { left: Math.max(0, Math.min(Math.round(marker.x + 8), size - width)), top: Math.max(0, Math.round(marker.y - 34)), width };
}

/** True when nothing but the ambient flow is moving. */
export function isHoloQuiet(state: HoloState): boolean {
  return state.waves.length === 0 && state.burst === 0 && state.burstTarget === 0 && state.flash < 0.02 && state.birth >= 1;
}
