/**
 * Pure state for the NUSA attractor (a Clifford attractor). No imports, so tests can transpile it alone.
 *
 * The figure is driven by runtime facts, never by a clock:
 * - every new decision moves the parameter targets one step, so the form morphs only when NUSA decides;
 * - a new fill locks the parameters onto a symmetric form and blooms green, then relaxes;
 * - a held / halted runtime tints the figure amber / red.
 */
export type AttractorTone = "normal" | "hold" | "halt";
export interface AttractorParams { readonly a: number; readonly b: number; readonly c: number; readonly d: number }
export interface AttractorState {
  readonly params: AttractorParams;
  readonly target: AttractorParams;
  readonly bloom: number;
  readonly color: readonly [number, number, number];
  readonly decisionCount: number | null;
  readonly fillCount: number | null;
  readonly step: number;
}

export const ATTRACTOR_COLORS: Readonly<Record<"decide" | "fill" | "hold" | "halt", readonly [number, number, number]>> = Object.freeze({
  decide: [127, 182, 240] as const,
  fill: [95, 212, 154] as const,
  hold: [242, 184, 75] as const,
  halt: [240, 104, 106] as const,
});

const START: AttractorParams = Object.freeze({ a: -1.4, b: 1.6, c: 1.0, d: 0.7 });
const FILL_FORM: AttractorParams = Object.freeze({ a: -1.7, b: 1.7, c: 0.9, d: 0.9 });

export function initialAttractorState(): AttractorState {
  return Object.freeze({ params: START, target: START, bloom: 0, color: ATTRACTOR_COLORS.decide, decisionCount: null, fillCount: null, step: 0 });
}

/** Deterministic target for decision step n (no randomness, so the figure is reproducible). */
export function decisionTarget(step: number): AttractorParams {
  const s = (k: number) => Math.sin(step * 0.61 + k * 1.7);
  return Object.freeze({ a: -1.4 + 0.4 * s(0), b: 1.6 + 0.35 * s(1), c: 1.0 + 0.4 * s(2), d: 0.85 + 0.35 * s(3) });
}

/**
 * Folds the latest runtime counts into the state. The first observation, and a counter that went
 * backwards (runtime restart), only record a baseline. The target is derived from the reported
 * decision count itself, so a poll that sees 100 -> 105 lands on the same figure as five single
 * steps would: the form never depends on polling timing.
 */
export function observeAttractor(state: AttractorState, decisionCount: number | null, fillCount: number | null): AttractorState {
  if (state.decisionCount == null || state.fillCount == null || decisionCount == null || fillCount == null
    || decisionCount < state.decisionCount || fillCount < state.fillCount) {
    const target = decisionCount == null ? state.target : decisionTarget(decisionCount);
    return Object.freeze({ ...state, decisionCount, fillCount, target, step: decisionCount ?? state.step });
  }
  if (fillCount > state.fillCount) {
    return Object.freeze({ ...state, decisionCount, fillCount, target: FILL_FORM, bloom: 1, color: ATTRACTOR_COLORS.fill, step: decisionCount });
  }
  if (decisionCount > state.decisionCount) {
    return Object.freeze({ ...state, decisionCount, fillCount, target: decisionTarget(decisionCount), bloom: Math.max(state.bloom, 0.3), step: decisionCount });
  }
  return Object.freeze({ ...state, decisionCount, fillCount });
}

/** The non-animated end state: target reached, bloom spent, colour at the tone. Used under reduce-motion. */
export function settleAttractor(state: AttractorState, tone: AttractorTone): AttractorState {
  const color = tone === "halt" ? ATTRACTOR_COLORS.halt : tone === "hold" ? ATTRACTOR_COLORS.hold : ATTRACTOR_COLORS.decide;
  return Object.freeze({ ...state, params: state.target, bloom: 0, color });
}

/** True once a tick no longer changes anything visible, so the frame loop can stop. */
export function isAttractorSettled(before: AttractorState, after: AttractorState): boolean {
  const p = after.params, t = after.target;
  const still = Math.abs(p.a - t.a) + Math.abs(p.b - t.b) + Math.abs(p.c - t.c) + Math.abs(p.d - t.d) < 1e-3;
  const color = Math.abs(before.color[0] - after.color[0]) + Math.abs(before.color[1] - after.color[1]) + Math.abs(before.color[2] - after.color[2]) < 0.5;
  return still && after.bloom < 0.01 && color;
}

/** One animation tick: parameters glide toward the target, bloom decays, colour settles toward the tone. */
export function tickAttractor(state: AttractorState, tone: AttractorTone): AttractorState {
  const ease = (from: number, to: number, k: number) => from + (to - from) * k;
  const p = state.params, t = state.target;
  const params = Object.freeze({ a: ease(p.a, t.a, 0.03), b: ease(p.b, t.b, 0.03), c: ease(p.c, t.c, 0.03), d: ease(p.d, t.d, 0.03) });
  const bloom = state.bloom * 0.96;
  const rest = tone === "halt" ? ATTRACTOR_COLORS.halt : tone === "hold" ? ATTRACTOR_COLORS.hold : ATTRACTOR_COLORS.decide;
  const goal = bloom > 0.35 && state.color === ATTRACTOR_COLORS.fill ? ATTRACTOR_COLORS.fill : rest;
  const c = state.color;
  const color = goal === c ? c : Object.freeze([ease(c[0], goal[0], 0.04), ease(c[1], goal[1], 0.04), ease(c[2], goal[2], 0.04)] as const);
  return Object.freeze({ ...state, params, bloom, color });
}

/** Advances a point cloud one Clifford iteration in place. */
export function iterateAttractor(xs: Float32Array, ys: Float32Array, p: AttractorParams): void {
  for (let i = 0; i < xs.length; i += 1) {
    const x = xs[i], y = ys[i];
    xs[i] = Math.sin(p.a * y) + p.c * Math.cos(p.a * x);
    ys[i] = Math.sin(p.b * x) + p.d * Math.cos(p.b * y);
  }
}
