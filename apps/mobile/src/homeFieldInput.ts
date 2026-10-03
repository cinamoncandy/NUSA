import type { IntelligenceFieldInput } from "./intelligenceFieldModel";

/**
 * Screen-model boundary for the HOME Intelligence Field. This maps canonical app state to the
 * field's semantic input in one pure, tested function, so any future HOME presentation can reuse
 * it unchanged instead of re-deriving (and re-testing) the mapping inside a view.
 */
export interface HomeFieldSnapshot {
  readonly health: string;
  readonly readyForPaperOperations: boolean;
  readonly dashboard: { readonly killSwitchActive: boolean };
  readonly operations: {
    readonly runtimeState: string;
    readonly pipelineStage?: unknown;
    readonly heartbeat?: { readonly decisionCount: number; readonly paperOrderCount: number; readonly buySignalCount?: number; readonly buyBlockedCount?: number; readonly buyCountsSince?: number; readonly windowDecisionCount?: number; readonly windowOrderCount?: number; readonly feedDisconnectCount?: number; readonly feedStaleGapCount?: number; readonly feedMaxGapMs?: number; readonly feedCountsSince?: number; readonly lastDecisionDetail?: unknown; readonly lastError?: unknown };
  };
}

export interface HomeFieldSource {
  readonly snapshot: HomeFieldSnapshot | null;
  readonly readOnlyError: string | null;
  readonly notConfigured: string | null;
  readonly sessionRecovering: boolean;
  readonly publicMarketStale: boolean;
}

export function buildHomeFieldInput(source: HomeFieldSource): IntelligenceFieldInput {
  const { snapshot, readOnlyError } = source;
  const disconnected = source.notConfigured != null;
  return Object.freeze({
    checking: snapshot == null && !disconnected && readOnlyError == null,
    disconnected,
    recovering: disconnected && source.sessionRecovering,
    haltActive: snapshot?.dashboard.killSwitchActive === true || snapshot?.operations.runtimeState === "HALTED",
    degraded: readOnlyError != null || (snapshot != null && (snapshot.health !== "HEALTHY" || !["READY", "RUNNING"].includes(snapshot.operations.runtimeState))),
    feedStale: source.publicMarketStale,
    readyForPaperOperations: snapshot?.readyForPaperOperations ?? false,
    decisionCount: snapshot?.operations.heartbeat?.decisionCount ?? null,
    paperOrderCount: snapshot?.operations.heartbeat?.paperOrderCount ?? null,
    pipelineStage: typeof snapshot?.operations.pipelineStage === "string" ? snapshot.operations.pipelineStage : null,
    lastError: typeof snapshot?.operations.heartbeat?.lastError === "string" ? snapshot.operations.heartbeat.lastError : null,
  });
}
