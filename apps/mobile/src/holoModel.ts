/**
 * Pure state for the NUSA flow-field hero. No imports, so tests can transpile it alone.
 *
 * The figure ("흐름", owner-chosen 2026-10-07 from reference videos): hairline data streams flowing into glowing particle clusters,
 * one cluster per stage of the chain market -> research -> risk -> paper -> ledger. Driven by runtime facts:
 * - each new decision sends a bright pulse down the chain, lighting each stream and cluster in turn;
 * - each new PAPER order ignites the paper cluster with a lime ring and light beam, and its hand-off stream to the ledger glows lime;
 * - a held / halted runtime tints risk onward amber / red; a halt also dims the streams out of risk and nearly stops the flow.
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
  /** When the latest PAPER order was observed; the ring, sparks and beam are pure functions of its age. Null before any order. */
  readonly orderBornMs: number | null;
}

export const HOLO_WAVE_MS = 2600;
/** How long a PAPER order's ring, sparks and beam last. */
export const HOLO_ORDER_MS = 3600;
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
  return Object.freeze({ spin: 0, burst: 0, burstTarget: 0, flash: 0, flashColor: HOLO_COLORS.ink, waves: Object.freeze([]), birth: 0, tintMix: 0, markRow: null, decisionCount: null, fillCount: null, orderBornMs: null });
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

/** A stable slot (0..47) a decision is associated with, so successive decisions are distinguishable. */
export function waveRow(wave: HoloWave): number {
  const turn = ((Math.atan2(wave.az, wave.ax) / (Math.PI * 2) + 0.5) % 1 + 1) % 1;
  return Math.min(47, Math.floor(turn * 48));
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
  if (fillCount > state.fillCount) next = Object.freeze({ ...next, burstTarget: 1, flash: 1, flashColor: HOLO_COLORS.fill, orderBornMs: nowMs });
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
  const orderBornMs = state.orderBornMs != null && nowMs - state.orderBornMs >= HOLO_ORDER_MS ? null : state.orderBornMs;
  return Object.freeze({ ...state, spin, burst, burstTarget, flash, birth, tintMix, orderBornMs, waves: waves.length === state.waves.length ? state.waves : Object.freeze(waves) });
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
// The flow field ("흐름", owner-chosen 2026-10-07 from reference videos): hairline data streams flowing into glowing particle clusters,
// one cluster per stage of NUSA's canonical chain. All geometry is in fractions of the (square) canvas: x to the right, y downward.
// ---------------------------------------------------------------------------------------------------------------------------------

export type FlowNodeId = "market" | "research" | "risk" | "paper" | "ledger";
export interface FlowNode { readonly id: FlowNodeId; readonly label: string; readonly x: number; readonly y: number; readonly r: number; readonly count: number; readonly color: Rgb }
/** The chain, in order. Colour is the figure's cool white with one muted accent each for research (gold) and risk (teal). */
export const FLOW_NODES: readonly FlowNode[] = Object.freeze([
  Object.freeze({ id: "market", label: "market", x: 0.18, y: 0.3, r: 0.11, count: 520, color: [236, 240, 248] as const }),
  Object.freeze({ id: "research", label: "research", x: 0.68, y: 0.18, r: 0.12, count: 600, color: [232, 200, 132] as const }),
  Object.freeze({ id: "risk", label: "risk", x: 0.82, y: 0.52, r: 0.09, count: 400, color: [156, 232, 222] as const }),
  Object.freeze({ id: "paper", label: "paper", x: 0.56, y: 0.74, r: 0.1, count: 460, color: [236, 240, 248] as const }),
  Object.freeze({ id: "ledger", label: "ledger", x: 0.2, y: 0.84, r: 0.07, count: 280, color: [236, 240, 248] as const }),
] as FlowNode[]);
/** Streams: [from, to] node indexes; -1 is the off-canvas inflow of market ticks. Index 3 (risk -> paper) and 4 (paper -> ledger) are what a halt closes. */
export const FLOW_EDGES: readonly (readonly [number, number])[] = Object.freeze([[-1, 0], [0, 1], [1, 2], [2, 3], [3, 4]] as const);
export const FLOW_PAPER = 3;
/** Hairlines per stream at full detail (the inflow is denser). */
export const FLOW_STRANDS = 90;
export const FLOW_INFLOW_STRANDS = 120;
/** A decision's pulse travels the whole chain (inflow -> ledger) over one wave lifetime. */
export const FLOW_PULSE_SPAN = FLOW_EDGES.length;

export interface FlowStrand { readonly j1: number; readonly j2: number; readonly j3: number; readonly j4: number; readonly phase: number; readonly speed: number; readonly alpha: number }
export interface FlowField { readonly points: readonly Float32Array[]; readonly strands: readonly (readonly FlowStrand[])[] }

function seededRandom(seed: number): () => number {
  let value = seed >>> 0;
  return () => { value = (value * 1664525 + 1013904223) >>> 0; return value / 4294967296; };
}
const gaussian = (random: () => number): number => (random() + random() + random() + random() - 2) / 2;

/**
 * Deterministic geometry. Each cluster point is [x, y, z, brightness] inside the unit ball; density (0..1] scales every count
 * (small marks draw far fewer). Same density, same field.
 */
export function buildFlowField(density = 1): FlowField {
  const d = Math.min(1, Math.max(0.05, density));
  const pointRandom = seededRandom(7);
  const points = FLOW_NODES.map((node) => {
    const n = Math.max(24, Math.round(node.count * d)), out = new Float32Array(n * 4);
    for (let i = 0; i < n; i += 1) {
      const a = pointRandom() * Math.PI * 2, b = Math.acos(2 * pointRandom() - 1), rr = Math.pow(pointRandom(), 0.6);
      out[i * 4] = Math.sin(b) * Math.cos(a) * rr; out[i * 4 + 1] = Math.cos(b) * rr; out[i * 4 + 2] = Math.sin(b) * Math.sin(a) * rr; out[i * 4 + 3] = pointRandom();
    }
    return out;
  });
  const strands = FLOW_EDGES.map(([from], e) => {
    const random = seededRandom(100 + e);
    const n = Math.max(8, Math.round((from < 0 ? FLOW_INFLOW_STRANDS : FLOW_STRANDS) * d));
    return Object.freeze(Array.from({ length: n }, () => Object.freeze({ j1: gaussian(random), j2: gaussian(random), j3: gaussian(random), j4: gaussian(random), phase: random() * Math.PI * 2, speed: 0.6 + random() * 0.8, alpha: 0.25 + random() * 0.75 })));
  });
  return Object.freeze({ points: Object.freeze(points), strands: Object.freeze(strands) });
}

/** One hairline as a quadratic curve (start, control, end), in canvas fractions, swaying gently with the flow clock. */
export function flowStrandCurve(edge: number, strand: FlowStrand, tSec: number): { readonly sx: number; readonly sy: number; readonly cx: number; readonly cy: number; readonly ex: number; readonly ey: number } {
  const [from, to] = FLOW_EDGES[edge]!;
  const b = FLOW_NODES[to]!;
  const a = from < 0 ? { x: -0.08, y: 0.1, r: 0 } : FLOW_NODES[from]!;
  const sx = a.x + strand.j1 * a.r * 0.7, sy = a.y + strand.j2 * a.r * 0.7, ex = b.x + strand.j3 * b.r * 0.6, ey = b.y + strand.j4 * b.r * 0.6;
  const mx = (sx + ex) / 2, my = (sy + ey) / 2, nx = -(ey - sy), ny = ex - sx, nl = Math.hypot(nx, ny) || 1;
  const bend = (strand.j1 - strand.j3) * 0.09 + 0.06, wobble = Math.sin(tSec * 0.4 * strand.speed + strand.phase) * 0.012;
  return { sx, sy, cx: mx + (nx / nl) * bend + wobble, cy: my + (ny / nl) * bend - wobble, ex, ey };
}

/** A point travelling along a strand (0..1 of its curve), for the flowing particles. */
export function flowStrandPoint(curve: ReturnType<typeof flowStrandCurve>, u: number): { readonly x: number; readonly y: number } {
  const v = 1 - u;
  return { x: v * v * curve.sx + 2 * v * u * curve.cx + u * u * curve.ex, y: v * v * curve.sy + 2 * v * u * curve.cy + u * u * curve.ey };
}

/** Where a decision's pulse is along the chain (-0.5 before the inflow .. FLOW_PULSE_SPAN past the ledger), or null outside its life. */
export function flowPulsePosition(wave: HoloWave, nowMs: number): number | null {
  const age = (nowMs - wave.bornMs) / HOLO_WAVE_MS;
  if (age < 0 || age >= 1) return null;
  return age * (FLOW_PULSE_SPAN + 0.5) - 0.5;
}
/** How brightly a pulse at chain position p lights stream e (0..1); a stream's middle is at e + 0.5. */
export const flowEdgeGlow = (p: number, edge: number): number => Math.exp(-Math.pow((p - edge - 0.5) * 2.2, 2));
/** How brightly a pulse at chain position p lights cluster i (0..1); cluster i sits at the end of stream i. */
export const flowNodeGlow = (p: number, node: number): number => Math.exp(-Math.pow((p - node - 1) * 2.4, 2));

/** True for the stages a halt closes (risk onward): their colour takes the hold / halt tint and their streams dim. */
export const flowGated = (node: number): boolean => node >= 2;
/** A stage's colour: its own colour, tinted toward amber / red from risk onward as a hold / halt fades in. */
export function flowNodeColor(node: number, tone: HoloTone, tintMix: number): Rgb {
  const base = FLOW_NODES[node]!.color;
  return flowGated(node) ? tinted(base, tone, 0, HOLO_COLORS.ink, tintMix) : base;
}
/** Brightness multiplier for stream e: a halt closes the streams out of risk (and the ledger hand-off). */
export const flowEdgeOpen = (edge: number, tone: HoloTone, tintMix: number): number => (tone === "halt" && edge >= 3 ? 1 - 0.8 * Math.min(1, Math.max(0, tintMix)) : 1);

/** Projects cluster point i of a node at a rotation (radians), returning canvas fractions and a 0..1 depth brightness. */
export function flowClusterPoint(node: number, pts: Float32Array, i: number, rotation: number, spread: number): { readonly x: number; readonly y: number; readonly light: number } {
  const n = FLOW_NODES[node]!, ca = Math.cos(rotation + node), sa = Math.sin(rotation + node);
  const px = pts[i * 4]!, py = pts[i * 4 + 1]!, pz = pts[i * 4 + 2]!;
  const x = px * ca + pz * sa, z = -px * sa + pz * ca, k = 1 / (1.6 - z * 0.5);
  return { x: n.x + x * n.r * k * spread, y: n.y + py * n.r * k * 0.9 * spread, light: (0.5 + 0.5 * (z + 1) / 2) };
}

/** Where a node's label sits (top-left of a chip beside the cluster), in pixels, clamped inside a square canvas of `size`. */
export function flowLabelPlacement(size: number, node: number, width: number): { readonly left: number; readonly top: number } {
  const n = FLOW_NODES[node]!;
  return { left: Math.max(2, Math.min(Math.round(size * (n.x + n.r * 0.75)), size - width - 2)), top: Math.max(2, Math.min(Math.round(size * (n.y - n.r * 0.95)), size - 18)) };
}

// ---- Dynamics: comets, sparks and rings are pure functions of time, so the picture needs no particle state ----------------------------

/** Comets a decision launches down each stream (the pulse is carried by bright heads with tails). */
export const FLOW_COMETS_PER_EDGE = 6;
/** A comet's tail length (as a fraction of its stream) and its number of tail points. */
export const FLOW_COMET_TAIL = 0.16;
export const FLOW_COMET_TAIL_POINTS = 9;
/** Seconds a stream's comets are held back after the decision, so the pulse visibly travels the chain. */
export const flowCometDelaySec = (edge: number): number => (edge * 0.55 * HOLO_WAVE_MS) / 1000 / (FLOW_PULSE_SPAN + 0.6);

/** Which strand of a stream a decision comet rides (deterministic, spread across the bundle). */
export const flowCometStrand = (edge: number, index: number, strandCount: number): number => ((index * 37 + edge * 11 + 5) % Math.max(1, strandCount) + Math.max(1, strandCount)) % Math.max(1, strandCount);

/** A decision comet's progress along its stream (0 at the source .. 1 at the target), or null before launch and after arrival. */
export function flowCometProgress(wave: HoloWave, edge: number, index: number, nowMs: number): number | null {
  const age = (nowMs - wave.bornMs) / 1000 - flowCometDelaySec(edge) - index * 0.045;
  const speed = 0.85 + ((index * 53 + edge * 7) % 10) / 10 * 0.3; // 0.85..1.15 streams per second
  const u = age * speed;
  return u >= 0 && u < 1 ? u : null;
}

/** An ambient comet's progress along a strand (always moving; a halt nearly stops it through the flow clock). */
export const flowAmbientComet = (strand: FlowStrand, tSec: number): number => ((tSec * 0.22 * strand.speed + strand.phase / (Math.PI * 2)) % 1 + 1) % 1;

/** Tail point j (0 = head) of a comet at progress u: it trails behind the head along the stream and clamps at the source. */
export const flowTailProgress = (u: number, j: number, points = FLOW_COMET_TAIL_POINTS): number => Math.max(0, u - (j / Math.max(1, points - 1)) * FLOW_COMET_TAIL);

/** Brightness (0..1) of tail point j: 1 at the head fading to 0 at the end. */
export const flowTailLight = (j: number, points = FLOW_COMET_TAIL_POINTS): number => 1 - j / Math.max(1, points);

/** Sparks thrown by a PAPER order from the paper cluster; position and life are deterministic in the spark index and the order's age. */
export const FLOW_SPARKS = 70;
export function flowSpark(index: number, ageSec: number): { readonly x: number; readonly y: number; readonly life: number } | null {
  const random = seededRandom(900 + index);
  const angle = random() * Math.PI * 2, speed = 0.13 + random() * 0.55, duration = 0.5 + random() * 1.0;
  if (ageSec < 0 || ageSec >= duration) return null;
  const origin = FLOW_NODES[FLOW_PAPER]!;
  const drag = Math.exp(-ageSec * 1.5);
  return { x: origin.x + Math.cos(angle) * speed * (1 - drag) / 1.5, y: origin.y + (Math.sin(angle) * speed * (1 - drag)) / 1.5 - 0.1 * ageSec + 0.14 * ageSec * ageSec, life: 1 - ageSec / duration };
}

/** The rings an order opens around the paper cluster: three, staggered. Radius is a multiple of the cluster radius; alpha 0..1. */
export function flowOrderRing(ring: number, ageSec: number): { readonly scale: number; readonly alpha: number } | null {
  const age = ageSec - ring * 0.25;
  if (age < 0 || age >= 1.8) return null;
  return { scale: 0.9 + easeOutCubic(age / 1.6) * 2.4, alpha: 0.7 * (1 - age / 1.8) };
}

/** The ring a pulse opens around a cluster it lands on (glow 0..1 as flowNodeGlow reports it): grows as the glow fades. */
export const flowArrivalRing = (glow: number): { readonly scale: number; readonly alpha: number } | null => (glow > 0.15 ? { scale: 1.1 + (1 - glow) * 1.4, alpha: glow * 0.6 } : null);

/** A cluster's breathing scale: slow idle swell, a lift while a pulse lands, and a bigger lift while an order ignites it. */
export const flowBreath = (node: number, tSec: number, pulse: number, order: number): number => 1 + 0.05 * Math.sin(tSec * (0.8 + node * 0.15)) + pulse * 0.12 + order * 0.2;

/** A particle's own swirl rate and twinkle (0..1) from its brightness class, so clusters turn differentially instead of as one body. */
export const flowParticleSwirl = (m: number): number => 0.5 + m * 1.5;
export const flowParticleTwinkle = (m: number, tSec: number): number => 0.6 + 0.4 * Math.sin(tSec * flowParticleSwirl(m) * 2 + m * 6.283);

/** Where the order's light beam stands (its foot): the top of the PAPER cluster, in canvas pixels for a square canvas of `size`. */
export function holoFillMarker(size: number): { x: number; y: number } {
  const paper = FLOW_NODES[FLOW_PAPER]!;
  return { x: size * paper.x, y: size * (paper.y - paper.r) };
}

/** Placement of the market chip beside the beam inside a square canvas: clamped so it never leaves the canvas. */
export function holoChipPlacement(size: number, label: string): { left: number; top: number; width: number } {
  const marker = holoFillMarker(size);
  const width = Math.round(label.length * 6.7 + 16);
  return { left: Math.max(0, Math.min(Math.round(marker.x + 8), size - width)), top: Math.max(0, Math.round(marker.y - 34)), width };
}

/** True when nothing but the ambient flow is moving. */
export function isHoloQuiet(state: HoloState): boolean {
  return state.waves.length === 0 && state.burst === 0 && state.burstTarget === 0 && state.flash < 0.02 && state.birth >= 1 && state.orderBornMs == null;
}
