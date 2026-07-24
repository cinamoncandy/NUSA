import type { RuntimeReplay } from "./runtimeReplay";
import type { RuntimeIncidentReport } from "./runtimeIncidentReport";

export interface OperatorTimelineItem {
  readonly key: string;
  readonly occurredAt: number;
  readonly title: string;
  readonly detail: string;
  readonly severity: "INFO" | "WARNING" | "CRITICAL";
}

export const buildOperatorTimeline = (
  replay: RuntimeReplay,
  incidents: readonly RuntimeIncidentReport[]
): readonly OperatorTimelineItem[] => {
  const items: OperatorTimelineItem[] = replay.frames.map((frame) => ({
    key: frame.event.id,
    occurredAt: frame.event.occurredAt,
    title: frame.event.type,
    detail: JSON.stringify(frame.event.payload),
    severity: "INFO" as const
  }));
  for (const incident of incidents) {
    if (incident.runId !== replay.runId) continue;
    items.push({
      key: incident.incidentId,
      occurredAt: incident.createdAt,
      title: `${incident.status} INCIDENT`,
      detail: `${incident.failedStage ?? "RUNTIME"}: ${incident.cause}`,
      severity: incident.severity
    });
  }
  items.sort((a, b) => a.occurredAt - b.occurredAt || a.key.localeCompare(b.key));
  return Object.freeze(items.map((item) => Object.freeze({ ...item })));
};
