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
    readonly schedulerMode?: unknown;
    readonly transport?: unknown;
    readonly pendingWrites?: unknown;
    readonly heartbeat?: { readonly decisionCount: number; readonly paperOrderCount: number; readonly buySignalCount?: number; readonly buyBlockedCount?: number; readonly buyCountsSince?: number; readonly windowDecisionCount?: number; readonly windowOrderCount?: number; readonly feedDisconnectCount?: number; readonly feedStaleGapCount?: number; readonly feedMaxGapMs?: number; readonly feedCountsSince?: number; readonly lastDecisionDetail?: unknown; readonly researchCollection?: unknown; readonly tradedMarkets?: unknown; readonly lastError?: unknown };
  };
}

/**
 * True when the server is healthy but has no order path: the COLLECT_ONLY run mode. The server then reports the runtime as STOPPED
 * (no execution loop, scheduler OFF) and the whole snapshot as DEGRADED, which the phone used to word as "확인 필요". Every fact
 * below is a server field; if any one differs (a halt, a kill switch, a lost transport, pending writes, a running loop) this is false
 * and the existing warning wording applies unchanged. It only ever REPLACES a warning wording with "no orders, collecting"; it adds no authority.
 */
export function isCollectOnlyObservation(snapshot: HomeFieldSnapshot | null | undefined): boolean {
  if (snapshot == null) return false;
  const ops = snapshot.operations;
  return snapshot.health === "DEGRADED"
    && snapshot.dashboard?.killSwitchActive !== true
    && ops.runtimeState === "STOPPED"
    && ops.pipelineStage === "READ_ONLY_DASHBOARD"
    && ops.schedulerMode === "OFF"
    && ops.transport === "ONLINE"
    && ops.pendingWrites === 0;
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
    collectOnly: readOnlyError == null && isCollectOnlyObservation(snapshot),
    degraded: readOnlyError != null || (snapshot != null && !isCollectOnlyObservation(snapshot) && (snapshot.health !== "HEALTHY" || !["READY", "RUNNING"].includes(snapshot.operations.runtimeState))),
    feedStale: source.publicMarketStale,
    readyForPaperOperations: snapshot?.readyForPaperOperations ?? false,
    decisionCount: snapshot?.operations.heartbeat?.decisionCount ?? null,
    paperOrderCount: snapshot?.operations.heartbeat?.paperOrderCount ?? null,
    pipelineStage: typeof snapshot?.operations.pipelineStage === "string" ? snapshot.operations.pipelineStage : null,
    lastError: typeof snapshot?.operations.heartbeat?.lastError === "string" ? snapshot.operations.heartbeat.lastError : null,
  });
}
