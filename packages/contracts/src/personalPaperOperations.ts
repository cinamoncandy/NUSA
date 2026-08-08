import type { DashboardHealth, DashboardMode, MobileDashboardResponse } from "./mobileDashboard";
import type { ResearchStatusProjection } from "./researchAutomation";

export type PersonalPaperOperationsHealth = "HEALTHY" | "DEGRADED" | "FAIL_CLOSED";
export type PersonalPaperRuntimeState = "HALTED" | "READY_OFFLINE" | "READY" | "STOPPING" | "STOPPED";
export type PersonalPaperSchedulerMode = "OFF" | "OBSERVE" | "ACTIVE";

export interface PersonalPaperRuntimeProjection {
  readonly runtimeState: PersonalPaperRuntimeState;
  readonly schedulerRunning: boolean;
  readonly schedulerMode: PersonalPaperSchedulerMode;
  readonly pipelineStage: string;
  readonly transport: "ONLINE" | "OFFLINE";
  readonly killSwitchActive: boolean;
  readonly accountHalted: boolean;
  readonly pendingWrites: number;
  readonly lastEventAt?: number;
  readonly updatedAt: number;
}

export interface PersonalPaperOperationsSnapshot {
  readonly schemaVersion: 1;
  readonly generatedAt: number;
  readonly mode: DashboardMode;
  readonly health: PersonalPaperOperationsHealth;
  readonly readyForPaperOperations: boolean;
  readonly dashboard: MobileDashboardResponse;
  readonly research: ResearchStatusProjection | null;
  readonly operations: PersonalPaperRuntimeProjection;
  readonly liveAuthority: "NONE";
  readonly productionMutationAllowed: false;
}

export interface PersonalPaperOperationsInput {
  readonly dashboard: MobileDashboardResponse;
  readonly research: ResearchStatusProjection | null;
  readonly operations: PersonalPaperRuntimeProjection;
}

const finite = (value: number, name: string): number => {
  if (!Number.isFinite(value)) throw new Error(`${name} must be finite`);
  return value;
};

const nonNegativeInteger = (value: number, name: string): number => {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${name} must be a non-negative safe integer`);
  return value;
};

function validateDashboard(dashboard: MobileDashboardResponse): void {
  if (dashboard.apiVersion !== "1") throw new Error("unsupported dashboard apiVersion");
  finite(dashboard.generatedAt, "dashboard.generatedAt");
  if (dashboard.mode !== "PAPER" && dashboard.mode !== "STOPPED" && dashboard.mode !== "FAULTED") {
    throw new Error("invalid dashboard mode");
  }
  if (dashboard.overallHealth !== "HEALTHY" && dashboard.overallHealth !== "DEGRADED" && dashboard.overallHealth !== "DOWN") {
    throw new Error("invalid dashboard health");
  }
}

function validateResearch(research: ResearchStatusProjection | null): void {
  if (research == null) return;
  if (research.liveAuthority !== "NONE" || research.productionMutationAllowed !== false) {
    throw new Error("research authority invariant violated");
  }
  if (research.champion.authority !== "PAPER_ONLY" || research.challenger.authority !== "ZERO_AUTHORITY") {
    throw new Error("research strategy authority invariant violated");
  }
}

function validateOperations(operations: PersonalPaperRuntimeProjection): void {
  if (!["HALTED", "READY_OFFLINE", "READY", "STOPPING", "STOPPED"].includes(operations.runtimeState)) {
    throw new Error("invalid PAPER runtime state");
  }
  if (!["OFF", "OBSERVE", "ACTIVE"].includes(operations.schedulerMode)) throw new Error("invalid PAPER scheduler mode");
  if (operations.transport !== "ONLINE" && operations.transport !== "OFFLINE") throw new Error("invalid PAPER transport state");
  nonNegativeInteger(operations.pendingWrites, "operations.pendingWrites");
  finite(operations.updatedAt, "operations.updatedAt");
  if (operations.lastEventAt != null) finite(operations.lastEventAt, "operations.lastEventAt");
}

function deriveHealth(input: PersonalPaperOperationsInput): PersonalPaperOperationsHealth {
  if (
    input.dashboard.mode === "FAULTED" ||
    input.dashboard.overallHealth === "DOWN" ||
    input.dashboard.killSwitchActive ||
    input.operations.killSwitchActive ||
    input.operations.accountHalted ||
    input.operations.runtimeState === "HALTED" ||
    input.research?.health === "FAIL_CLOSED" ||
    input.research?.recoveryStatus === "FAIL_CLOSED"
  ) return "FAIL_CLOSED";

  if (
    input.dashboard.overallHealth === "DEGRADED" ||
    input.operations.runtimeState !== "READY" ||
    input.operations.transport !== "ONLINE" ||
    input.operations.pendingWrites > 0 ||
    input.research == null ||
    input.research.health !== "HEALTHY" ||
    input.research.recoveryStatus !== "READY"
  ) return "DEGRADED";

  return "HEALTHY";
}

const deepFreeze = <T>(value: T): T => {
  if (value != null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
};

export function buildPersonalPaperOperationsSnapshot(
  input: PersonalPaperOperationsInput,
  generatedAt = Date.now()
): PersonalPaperOperationsSnapshot {
  validateDashboard(input.dashboard);
  validateResearch(input.research);
  validateOperations(input.operations);
  finite(generatedAt, "generatedAt");

  const health = deriveHealth(input);
  const readyForPaperOperations =
    health !== "FAIL_CLOSED" &&
    input.dashboard.mode === "PAPER" &&
    input.dashboard.tradingAllowed &&
    !input.dashboard.killSwitchActive &&
    !input.operations.killSwitchActive &&
    !input.operations.accountHalted &&
    (input.operations.runtimeState === "READY" || input.operations.runtimeState === "READY_OFFLINE");

  return deepFreeze(structuredClone({
    schemaVersion: 1 as const,
    generatedAt,
    mode: input.dashboard.mode,
    health,
    readyForPaperOperations,
    dashboard: input.dashboard,
    research: input.research,
    operations: input.operations,
    liveAuthority: "NONE" as const,
    productionMutationAllowed: false as const
  }));
}

export function validatePersonalPaperOperationsSnapshot(
  snapshot: PersonalPaperOperationsSnapshot,
  now = Date.now(),
  maximumAgeMs = 15_000
): PersonalPaperOperationsSnapshot {
  if (snapshot.schemaVersion !== 1) throw new Error("unsupported personal PAPER operations schemaVersion");
  if (snapshot.liveAuthority !== "NONE" || snapshot.productionMutationAllowed !== false) {
    throw new Error("personal PAPER operations authority invariant violated");
  }
  finite(snapshot.generatedAt, "generatedAt");
  finite(now, "now");
  if (!Number.isFinite(maximumAgeMs) || maximumAgeMs < 0) throw new Error("maximumAgeMs must be non-negative");
  if (snapshot.generatedAt > now) throw new Error("personal PAPER operations snapshot is from the future");
  if (now - snapshot.generatedAt > maximumAgeMs) throw new Error("personal PAPER operations snapshot is stale");
  validateDashboard(snapshot.dashboard);
  validateResearch(snapshot.research);
  validateOperations(snapshot.operations);
  const expectedHealth = deriveHealth(snapshot);
  if (snapshot.health !== expectedHealth) throw new Error("personal PAPER operations health mismatch");
  if (snapshot.mode !== snapshot.dashboard.mode) throw new Error("personal PAPER operations mode mismatch");
  return deepFreeze(structuredClone(snapshot));
}

export function dashboardHealthToOperationsHealth(health: DashboardHealth): PersonalPaperOperationsHealth {
  return health === "HEALTHY" ? "HEALTHY" : health === "DEGRADED" ? "DEGRADED" : "FAIL_CLOSED";
}
