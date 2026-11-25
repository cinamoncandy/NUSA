import type { LoopStep } from "./learningScreenModel";

/**
 * The learning loop drawn as one chain of nodes (UI v7 phase 5d, the sphere's language): the nodes the server has confirmed are lit, the line
 * between them is lit up to the last confirmed one, and the next unconfirmed step wears an ice ring. Pure display model: it only reads the
 * steps it is given and invents nothing. A BLOCKED step never gets the "next" ring (it keeps its attention colour).
 */
export interface LoopChainModel {
  /** Index of the last DONE step, or -1 when none is confirmed. */
  readonly lastDone: number;
  /** The first step after the last DONE one when it is still unconfirmed (NONE), else null. */
  readonly nextIndex: number | null;
}

export function loopChain(steps: readonly LoopStep[]): LoopChainModel {
  let lastDone = -1;
  steps.forEach((step, i) => { if (step.state === "DONE") lastDone = i; });
  const next = steps[lastDone + 1];
  return Object.freeze({ lastDone, nextIndex: next != null && next.state === "NONE" ? lastDone + 1 : null });
}

/** The lit part of the line, as percentages of the strip width: node centres sit at (i + 0.5) / n. Both ends are clamped to the strip. */
export function chainLinePercents(count: number, lastDone: number): { readonly start: number; readonly end: number; readonly litEnd: number } {
  if (!Number.isFinite(count) || count < 2) return { start: 0, end: 0, litEnd: 0 };
  const centre = (i: number) => ((i + 0.5) / count) * 100;
  const litEnd = lastDone < 0 ? centre(0) : centre(Math.min(lastDone, count - 1));
  return { start: centre(0), end: centre(count - 1), litEnd };
}
