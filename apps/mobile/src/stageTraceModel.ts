import type { BrokenStageId } from "./firstBrokenStageModel";

/** The four stages a PAPER trade passes, in order. */
export const TRACE_STAGES: readonly { readonly id: BrokenStageId; readonly label: string }[] = Object.freeze([
  { id: "MARKET", label: "시세" },
  { id: "DECISION", label: "판단" },
  { id: "ORDER", label: "주문" },
  { id: "FILL", label: "체결" },
]);

export type TraceState = "PASSED" | "BROKEN" | "AHEAD";
export interface TraceStep { readonly id: BrokenStageId; readonly label: string; readonly state: TraceState }

/**
 * The stage trace on "지금": stages before the first broken one are drawn as passed, the broken one is lit, the rest wait.
 * Only a real first-broken stage draws a trace; without one (no data, or nothing contradicts the heartbeat) it returns null
 * and the screen shows nothing, so it never claims a stage passed.
 */
export function buildStageTrace(broken: BrokenStageId | null | undefined): readonly TraceStep[] | null {
  const at = TRACE_STAGES.findIndex((s) => s.id === broken);
  if (at < 0) return null;
  return TRACE_STAGES.map((s, i) => ({ id: s.id, label: s.label, state: i < at ? "PASSED" : i === at ? "BROKEN" : "AHEAD" }));
}

/** "02 / 04": which of the four stages is broken, for the mono corner of the card. */
export function stageTraceIndex(broken: BrokenStageId | null | undefined): string | null {
  const at = TRACE_STAGES.findIndex((s) => s.id === broken);
  return at < 0 ? null : `0${at + 1} / 0${TRACE_STAGES.length}`;
}

/** The status chip on "지금". It says PAPER in every state and is lit only while a fresh, unblocked snapshot arrived. */
export function nowStatusChip(input: { readonly stale: boolean; readonly blocked: boolean; readonly hasHeartbeat: boolean }): { readonly text: string; readonly live: boolean } {
  if (input.stale) return { text: "PAPER · 지난 값", live: false };
  if (input.blocked || !input.hasHeartbeat) return { text: "PAPER · 연결 대기", live: false };
  return { text: "PAPER · 모의 운영", live: true };
}
