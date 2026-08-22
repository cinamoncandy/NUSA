import type { RuntimeHealthReport } from "../../../cloud/src/runtimeHealthMonitor";
import type { OperatorTimelineItem } from "../../../cloud/src/operatorTimeline";

export interface RuntimeOperatorViewModel {
  readonly mode: "PAPER" | "DRY_RUN";
  readonly status: RuntimeHealthReport["status"];
  readonly score: number;
  readonly generatedAt: number;
  readonly summary: string;
  readonly timeline: readonly OperatorTimelineItem[];
  readonly actions: readonly [];
}

export const buildRuntimeOperatorView = (
  health: RuntimeHealthReport,
  timeline: readonly OperatorTimelineItem[],
  mode: "PAPER" | "DRY_RUN"
): RuntimeOperatorViewModel => {
  const view: RuntimeOperatorViewModel = {
    mode,
    status: health.status,
    score: health.score,
    generatedAt: health.generatedAt,
    summary: `${health.status} · score ${health.score} · consecutive failures ${health.consecutiveFailures}`,
    timeline: Object.freeze(timeline.map((item) => Object.freeze({ ...item }))),
    actions: Object.freeze([])
  };
  return Object.freeze(view);
};
