import { WAVE_PULSE_MS, type WavePulse } from "./waveCoreModel";

/**
 * Pure model for the Now tab's contour lines (owner request 2026-10-28, replacing the wave): nested closed lines like a topographic
 * map. The same real signals drive them as before: a rise in decisions sends a ring of light outward across the lines (pink for
 * an order), a fill draws the lines together and sends a shock ring, and without data they rest evenly spaced and grey.
 * Presentation only; it draws counts the screen already has and invents nothing.
 */
export const CONTOUR_COUNT = 9;
/** Largest radial warp of a line, as a share of the outer radius. Less than half the spacing so lines never cross. */
export const CONTOUR_MAX_WARP = 0.04;
/** Outer line radius as a share of half the box width, and of the box height. The strip below and the title above stay clear of it. */
export const CONTOUR_RX = 0.46;
export const CONTOUR_RY = 0.36;

/** Radius share (0..1) of line `k` (0 = innermost) at angle `theta`, warped by `warp` (0..1 of the maximum). */
export function contourScale(k: number, theta: number, phase: number, warp: number, lock: number): number {
  const base = (k + 1) / CONTOUR_COUNT;
  const w = Math.max(0, Math.min(1, warp)) * (1 - Math.max(0, Math.min(1, lock)));
  const bend = Math.sin(theta * 2 + phase * 0.7 + k * 0.18) * 0.65 + Math.sin(theta * 3 - phase * 0.5 + k * 0.12) * 0.35;
  return base + bend * w * CONTOUR_MAX_WARP;
}

/** Where a pulse's ring is, as a line position 0..CONTOUR_COUNT (outward); null before it is born or after it ends. */
export function ringPosition(p: WavePulse, now: number): number | null {
  const k = (now - p.born) / WAVE_PULSE_MS;
  if (k < 0 || k > 1) return null;
  return k * (CONTOUR_COUNT + 1) - 0.5;
}

/** How strongly line `k` is lit by a ring at `position` (gaussian across about one line); 0 when the ring is far away. */
export function ringLight(k: number, position: number | null): number {
  if (position == null) return 0;
  const d = k - position;
  return Math.exp(-d * d / 0.9);
}

/** Line opacity: the outer lines fade so the middle reads first; a lit line is brighter. */
export function contourOpacity(k: number, light: number, flat: number): number {
  const fade = 0.28 + 0.5 * ((k + 1) / CONTOUR_COUNT);
  return Math.min(1, (fade + 0.5 * light) * (1 - 0.35 * flat));
}
