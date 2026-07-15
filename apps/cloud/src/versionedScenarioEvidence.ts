export type EvidenceProvenance = "LIVE_PAPER_RUNTIME" | "OPERATOR_FAULT_DRILL" | "OFFLINE_RESEARCH_RUN" | "TEST_FIXTURE" | "UNVERIFIED_LEGACY";
export type VersionedScenarioEventType = "SESSION_OBSERVED" | "ORDER_COMPLETED" | "REGIME_OBSERVED" | "RECOVERY_COMPLETED" | "DUPLICATE_ORDER_CHECKED" | "FAULT_SCENARIO_PASSED";

export interface VersionedScenarioEvent {
  readonly schemaVersion: 1;
  readonly eventId: string;
  readonly type: VersionedScenarioEventType;
  readonly occurredAt: number;
  readonly sessionId: string;
  readonly provenance: EvidenceProvenance;
  readonly scenario?: string;
  readonly drillId?: string;
}

const allowed: Record<VersionedScenarioEventType, readonly EvidenceProvenance[]> = {
  SESSION_OBSERVED: ["LIVE_PAPER_RUNTIME", "TEST_FIXTURE", "UNVERIFIED_LEGACY"],
  ORDER_COMPLETED: ["LIVE_PAPER_RUNTIME", "TEST_FIXTURE", "UNVERIFIED_LEGACY"],
  REGIME_OBSERVED: ["LIVE_PAPER_RUNTIME", "TEST_FIXTURE", "UNVERIFIED_LEGACY"],
  RECOVERY_COMPLETED: ["LIVE_PAPER_RUNTIME", "TEST_FIXTURE", "UNVERIFIED_LEGACY"],
  DUPLICATE_ORDER_CHECKED: ["LIVE_PAPER_RUNTIME", "TEST_FIXTURE", "UNVERIFIED_LEGACY"],
  FAULT_SCENARIO_PASSED: ["OPERATOR_FAULT_DRILL", "TEST_FIXTURE", "UNVERIFIED_LEGACY"]
};

export function validateVersionedScenarioEvent(event: VersionedScenarioEvent): void {
  if (event.schemaVersion !== 1) throw new Error("unsupported scenario event schema version");
  if (!event.eventId.trim() || !event.sessionId.trim()) throw new Error("scenario event identity is required");
  if (!Number.isSafeInteger(event.occurredAt) || event.occurredAt < 0) throw new Error("scenario event timestamp is invalid");
  if (!allowed[event.type]?.includes(event.provenance)) throw new Error("scenario event provenance is invalid for event type");
  if (event.type === "FAULT_SCENARIO_PASSED" && event.provenance === "OPERATOR_FAULT_DRILL" && !event.drillId?.trim()) throw new Error("operator fault evidence requires drillId");
}
