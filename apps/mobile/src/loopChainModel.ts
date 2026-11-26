import type { LoopStep } from "./learningScreenModel";

/**
 * The learning loop drawn as one chain of nodes (UI v7 phase 5d, the sphere's language): the nodes the server has confirmed are lit, the line
 * between them is lit up to the last confirmed one, and the next unconfirmed step wears an ice ring. Pure display model: it only reads the
 * steps it is given and invents nothing. A BLOCKED step never gets the "next" ring (it keeps its attention colour).
 */
export interface LoopChainModel {
  /** Index of the last step of the unbroken run of DONE steps that starts at the first step, or -1 when the first step is not confirmed. The line is lit only that far, so it never implies a confirmed chain across a gap. */
  readonly lastDone: number;
  /** The step right after that run when it is still unconfirmed (NONE) and something is confirmed, else null: nothing is ringed when nothing is confirmed, and a BLOCKED step is never ringed. */
  readonly nextIndex: number | null;
}

export function loopChain(steps: readonly LoopStep[]): LoopChainModel {
  let lastDone = -1;
  while (lastDone + 1 < steps.length && steps[lastDone + 1]!.state === "DONE") lastDone += 1;
  const next = steps[lastDone + 1];
  return Object.freeze({ lastDone, nextIndex: lastDone >= 0 && next != null && next.state === "NONE" ? lastDone + 1 : null });
}

/** The lit part of the line, as percentages of the strip width: node centres sit at (i + 0.5) / n. Both ends are clamped to the strip. */
export function chainLinePercents(count: number, lastDone: number): { readonly start: number; readonly end: number; readonly litEnd: number } {
  if (!Number.isFinite(count) || count < 2) return { start: 0, end: 0, litEnd: 0 };
  const centre = (i: number) => ((i + 0.5) / count) * 100;
  const litEnd = lastDone < 0 ? centre(0) : centre(Math.min(lastDone, count - 1));
  return { start: centre(0), end: centre(count - 1), litEnd };
}
