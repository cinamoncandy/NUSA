import type { DecisionTerrainModel } from "./decisionTerrainModel";

/** One hour on the sphere's day ring: where it sits (clock face, 00 at the top) and how bright it is. Presentation model only. */
export interface HourDialNode {
  readonly row: number;
  readonly hour: number;
  readonly x: number;
  readonly y: number;
  /** 0..1: this hour's decisions relative to the busiest hour of the day so far; null when the hour has no usable count. */
  readonly level: number | null;
  readonly order: boolean;
  readonly limit: boolean;
  readonly selected: boolean;
  readonly current: boolean;
}

/**
 * The day as a ring of hours around the lattice sphere (UI v8, replaces the ridgeline: owner 2026-11-27 "능선이 아니라 구체").
 * Each terrain row becomes one node at its clock position; brightness follows that hour's real decision count, a pink mark means a
 * PAPER order in that hour, amber marks hours at or after the loss-limit stop. Nothing is invented: an hour without a usable count
 * has level null and is drawn as an empty socket.
 */
export function buildHourDial(model: DecisionTerrainModel, size: number, selectedRow: number | null): readonly HourDialNode[] {
  const c = size / 2, R = size * 0.40;
  const max = Math.max(1, ...model.rows.map((r) => r.decisionCount ?? 0));
  const last = model.rows.length - 1;
  return Object.freeze(model.rows.map((r, i) => {
    const a = (r.hour / 24) * 2 * Math.PI;
    return Object.freeze({
      row: i,
      hour: r.hour,
      x: c + R * Math.sin(a),
      y: c - R * Math.cos(a),
      level: r.decisionCount == null ? null : r.decisionCount / max,
      order: (r.orderCount ?? 0) > 0,
      limit: model.stop != null && i >= model.stop.row,
      selected: selectedRow === i,
      current: i === last,
    });
  }));
}

/** The row nearest to a touch at (x, y) inside a dial of `size`, or null when the touch is near the centre. */
export function hourDialRowAt(nodes: readonly HourDialNode[], size: number, x: number, y: number): number | null {
  const c = size / 2;
  if (Math.hypot(x - c, y - c) < size * 0.2 || nodes.length === 0) return null;
  let best = nodes[0]!, bestD = Infinity;
  for (const n of nodes) { const d = Math.hypot(n.x - x, n.y - y); if (d < bestD) { best = n; bestD = d; } }
  return best.row;
}
