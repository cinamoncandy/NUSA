import type { DashboardHealth, DashboardMode, MobileDashboardResponse } from "./mobileDashboard";
import type { ResearchStatusProjection } from "./researchAutomation";
import type { AiReadOnlyProjection } from "./aiInference";
import { validatePaperLearningReadOnlySnapshot, type PaperLearningReadOnlySnapshot } from "./paperLearningReadOnly";

export type PersonalPaperOperationsHealth = "HEALTHY" | "DEGRADED" | "FAIL_CLOSED";
export type PersonalPaperRuntimeState = "HALTED" | "READY_OFFLINE" | "READY" | "RUNNING" | "DEGRADED" | "ERROR" | "STOPPING" | "STOPPED";
export type PersonalPaperSchedulerMode = "OFF" | "OBSERVE" | "ACTIVE";

export interface PersonalPaperRuntimeHeartbeat {
  readonly startedAt: number;
  readonly lastHeartbeatAt: number;
  readonly lastMarketEventAt: number | null;
  readonly lastPaperDecisionAt: number | null;
  readonly lastPaperOrderAt: number | null;
  readonly lastPaperFillAt: number | null;
  readonly eventCount: number;
  readonly decisionCount: number;
  readonly paperOrderCount: number;
  readonly paperFillCount: number;
  readonly lastError: string | null;
}

export interface PersonalPaperSupervisorProjection {
  readonly managed: true;
  readonly status: "RUNNING";
  readonly restartAttempt: number;
  readonly restartCount: number;
  readonly startedAt: number;
  readonly lastExit: Readonly<{
    readonly code: number | null;
    readonly signal: string | null;
    readonly exitedAt: number;
    readonly uptimeMs: number;
  }> | null;
  readonly liveAuthority: "NONE";
  readonly productionMutationAllowed: false;
  readonly aiAuthority: "ZERO_AUTHORITY";
}

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
  readonly heartbeat?: PersonalPaperRuntimeHeartbeat;
  readonly supervisor?: PersonalPaperSupervisorProjection;
}

export interface PersonalPaperPortfolioProjection {
  readonly observedAt: string;
  readonly mode: "PAPER";
  readonly account: Readonly<{
    readonly available: true;
    readonly cash: number;
    readonly equity: number;
    readonly unrealizedPnl: number;
    readonly assetValue?: number;
    readonly realizedPnl?: number;
    readonly markPrice: number;
    readonly position: Readonly<{
      readonly market: string;
      readonly quantity: number;
      readonly averagePrice: number;
      readonly realizedPnl: number;
      readonly unrealizedPnl?: number;
    }>;
  }>;
  readonly openOrderCount: 0;
}

export interface PersonalPaperOrderProjection {
  readonly id: string;
  readonly market: string;
  readonly side: "BUY" | "SELL";
  readonly quantity: number;
  readonly price: number;
  readonly fee: number;
  readonly filledAt: string;
  readonly status: "FILLED";
  readonly fills: readonly Readonly<{
    readonly id: string;
    readonly quantity: number;
    readonly price: number;
    readonly filledAt: string;
  }>[];
}

export interface PersonalPaperMarketProjection {
  readonly market: string;
  readonly price: number;
  readonly changeRate: number | null;
  readonly volume: number | null;
  readonly observedAt: string;
  readonly source: "UPBIT_PUBLIC_TICKER";
}

export interface PersonalPaperOperationsSnapshot {
  readonly schemaVersion: 1;
  readonly generatedAt: number;
  readonly mode: DashboardMode;
  readonly health: PersonalPaperOperationsHealth;
  readonly readyForPaperOperations: boolean;
  readonly dashboard: MobileDashboardResponse;
  readonly research: ResearchStatusProjection | null;
  readonly ai: AiReadOnlyProjection | null;
  readonly operations: PersonalPaperRuntimeProjection;
  readonly portfolio: PersonalPaperPortfolioProjection | null;
  readonly orders: readonly PersonalPaperOrderProjection[];
  readonly markets: readonly PersonalPaperMarketProjection[];
  /** Bounded, canonical PAPER learning evidence; observation only. */
  readonly paperLearning?: PaperLearningReadOnlySnapshot | null;
  readonly liveAuthority: "NONE";
  readonly productionMutationAllowed: false;
}

export interface PersonalPaperOperationsInput {
  readonly dashboard: MobileDashboardResponse;
  readonly research: ResearchStatusProjection | null;
  readonly ai?: AiReadOnlyProjection | null;
  readonly operations: PersonalPaperRuntimeProjection;
  readonly portfolio?: PersonalPaperPortfolioProjection | null;
  readonly orders?: readonly PersonalPaperOrderProjection[];
  readonly markets?: readonly PersonalPaperMarketProjection[];
  readonly paperLearning?: PaperLearningReadOnlySnapshot | null;
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
  if (dashboard.mode !== "PAPER" && dashboard.mode !== "STOPPED" && dashboard.mode !== "FAULTED") throw new Error("invalid dashboard mode");
  if (dashboard.overallHealth !== "HEALTHY" && dashboard.overallHealth !== "DEGRADED" && dashboard.overallHealth !== "DOWN") throw new Error("invalid dashboard health");
}

function validateResearch(research: ResearchStatusProjection | null): void {
  if (research == null) return;
  if (research.liveAuthority !== "NONE" || research.productionMutationAllowed !== false) throw new Error("research authority invariant violated");
  if (research.champion.authority !== "PAPER_ONLY" || research.challenger.authority !== "ZERO_AUTHORITY") throw new Error("research strategy authority invariant violated");
}

function validateAi(ai: AiReadOnlyProjection | null): void {
  if (ai == null) return;
  if (ai.liveAuthority !== "NONE" || ai.productionMutationAllowed !== false) throw new Error("AI authority invariant violated");
  if (ai.confidence < 0 || ai.confidence > 1 || !Number.isFinite(ai.confidence)) throw new Error("AI confidence must be between zero and one");
}

function validateOperations(operations: PersonalPaperRuntimeProjection): void {
  if (!["HALTED", "READY_OFFLINE", "READY", "RUNNING", "DEGRADED", "ERROR", "STOPPING", "STOPPED"].includes(operations.runtimeState)) throw new Error("invalid PAPER runtime state");
  if (!["OFF", "OBSERVE", "ACTIVE"].includes(operations.schedulerMode)) throw new Error("invalid PAPER scheduler mode");
  if (operations.transport !== "ONLINE" && operations.transport !== "OFFLINE") throw new Error("invalid PAPER transport state");
  nonNegativeInteger(operations.pendingWrites, "operations.pendingWrites");
  finite(operations.updatedAt, "operations.updatedAt");
  if (operations.lastEventAt != null) finite(operations.lastEventAt, "operations.lastEventAt");
  if (operations.heartbeat != null) {
    const heartbeat = operations.heartbeat;
    for (const [name, value] of [["startedAt", heartbeat.startedAt], ["lastHeartbeatAt", heartbeat.lastHeartbeatAt]] as const) finite(value, `operations.heartbeat.${name}`);
    for (const [name, value] of [["lastMarketEventAt", heartbeat.lastMarketEventAt], ["lastPaperDecisionAt", heartbeat.lastPaperDecisionAt], ["lastPaperOrderAt", heartbeat.lastPaperOrderAt], ["lastPaperFillAt", heartbeat.lastPaperFillAt]] as const) if (value != null) finite(value, `operations.heartbeat.${name}`);
    for (const [name, value] of [["eventCount", heartbeat.eventCount], ["decisionCount", heartbeat.decisionCount], ["paperOrderCount", heartbeat.paperOrderCount], ["paperFillCount", heartbeat.paperFillCount]] as const) nonNegativeInteger(value, `operations.heartbeat.${name}`);
    if (heartbeat.lastError != null && !heartbeat.lastError.trim()) throw new Error("operations.heartbeat.lastError must be non-empty when present");
    if (heartbeat.lastHeartbeatAt < heartbeat.startedAt) throw new Error("operations.heartbeat clock regressed");
  }
  if (operations.supervisor != null) {
    const supervisor = operations.supervisor;
    if (supervisor.managed !== true || supervisor.status !== "RUNNING") throw new Error("invalid PAPER supervisor state");
    if (supervisor.liveAuthority !== "NONE" || supervisor.productionMutationAllowed !== false || supervisor.aiAuthority !== "ZERO_AUTHORITY") throw new Error("PAPER supervisor authority invariant violated");
    nonNegativeInteger(supervisor.restartAttempt, "operations.supervisor.restartAttempt");
    nonNegativeInteger(supervisor.restartCount, "operations.supervisor.restartCount");
    finite(supervisor.startedAt, "operations.supervisor.startedAt");
    if (supervisor.lastExit != null) {
      if (supervisor.lastExit.code != null && !Number.isSafeInteger(supervisor.lastExit.code)) throw new Error("invalid PAPER supervisor exit code");
      if (supervisor.lastExit.signal != null && !supervisor.lastExit.signal.trim()) throw new Error("invalid PAPER supervisor exit signal");
      finite(supervisor.lastExit.exitedAt, "operations.supervisor.lastExit.exitedAt");
      nonNegativeInteger(supervisor.lastExit.uptimeMs, "operations.supervisor.lastExit.uptimeMs");
    }
  }
}

function validateReadOnlyProjections(input: Pick<PersonalPaperOperationsSnapshot, "portfolio" | "orders" | "markets">): void {
  if (input.portfolio != null) {
    const account = input.portfolio.account;
    if (input.portfolio.mode !== "PAPER" || account.available !== true || input.portfolio.openOrderCount !== 0 || !Number.isFinite(Date.parse(input.portfolio.observedAt))) throw new Error("invalid PAPER portfolio projection");
    for (const [name, value] of [["cash", account.cash], ["equity", account.equity], ["unrealizedPnl", account.unrealizedPnl], ["markPrice", account.markPrice], ["quantity", account.position.quantity], ["averagePrice", account.position.averagePrice], ["realizedPnl", account.position.realizedPnl]] as const) finite(value, `portfolio.${name}`);
    if (account.assetValue != null) finite(account.assetValue, "portfolio.assetValue");
    if (account.realizedPnl != null) finite(account.realizedPnl, "portfolio.realizedPnl");
    if (account.position.unrealizedPnl != null) finite(account.position.unrealizedPnl, "portfolio.position.unrealizedPnl");
    if (account.cash < 0 || account.equity < 0 || account.markPrice < 0 || account.position.quantity < 0 || account.position.averagePrice < 0 || (account.assetValue != null && account.assetValue < 0)) throw new Error("invalid PAPER portfolio balance");
    if (account.position.quantity > 0 && (!account.position.market.trim() || account.markPrice <= 0)) throw new Error("open PAPER position requires market and mark price");
    if (account.assetValue != null) {
      const tolerance = Math.max(1e-6, account.equity * 1e-9);
      if (Math.abs(account.cash + account.assetValue - account.equity) > tolerance) throw new Error("invalid PAPER portfolio totals");
    }
  }
  for (const order of input.orders) {
    if (!order.id.trim() || !order.market.trim() || !["BUY", "SELL"].includes(order.side) || order.status !== "FILLED" || !Number.isFinite(Date.parse(order.filledAt))) throw new Error("invalid PAPER order projection");
    if (!Number.isFinite(order.quantity) || order.quantity <= 0 || !Number.isFinite(order.price) || order.price <= 0 || !Number.isFinite(order.fee) || order.fee < 0) throw new Error("invalid PAPER order value");
    for (const fill of order.fills) if (!fill.id.trim() || !Number.isFinite(fill.quantity) || fill.quantity <= 0 || !Number.isFinite(fill.price) || fill.price <= 0 || !Number.isFinite(Date.parse(fill.filledAt))) throw new Error("invalid PAPER fill projection");
  }
  for (const market of input.markets) {
    if (!market.market.trim() || !Number.isFinite(market.price) || market.price <= 0 || !Number.isFinite(Date.parse(market.observedAt)) || market.source !== "UPBIT_PUBLIC_TICKER") throw new Error("invalid PAPER market projection");
    if (market.changeRate != null) finite(market.changeRate, "market.changeRate");
    if (market.volume != null && (!Number.isFinite(market.volume) || market.volume < 0)) throw new Error("invalid PAPER market volume");
  }
}

function deriveHealth(input: PersonalPaperOperationsInput): PersonalPaperOperationsHealth {
  if (
    input.dashboard.mode === "FAULTED" || input.dashboard.overallHealth === "DOWN" || input.dashboard.killSwitchActive ||
    input.operations.killSwitchActive || input.operations.accountHalted || input.operations.runtimeState === "HALTED" ||
    input.research?.health === "FAIL_CLOSED" || input.research?.recoveryStatus === "FAIL_CLOSED"
  ) return "FAIL_CLOSED";
  if (
    input.dashboard.overallHealth === "DEGRADED" || !["READY", "RUNNING"].includes(input.operations.runtimeState) || input.operations.transport !== "ONLINE" ||
    input.operations.pendingWrites > 0 || (input.research != null && (input.research.health !== "HEALTHY" || input.research.recoveryStatus !== "READY"))
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

export function buildPersonalPaperOperationsSnapshot(input: PersonalPaperOperationsInput, generatedAt = Date.now()): PersonalPaperOperationsSnapshot {
  validateDashboard(input.dashboard);
  validateResearch(input.research);
  validateAi(input.ai ?? null);
  validateOperations(input.operations);
  if (input.paperLearning != null) {
    validatePaperLearningReadOnlySnapshot(input.paperLearning);
  }
  finite(generatedAt, "generatedAt");
  const health = deriveHealth(input);
  const readyForPaperOperations = health !== "FAIL_CLOSED" && input.dashboard.mode === "PAPER" && input.dashboard.tradingAllowed && !input.dashboard.killSwitchActive && !input.operations.killSwitchActive && !input.operations.accountHalted && (input.operations.runtimeState === "READY" || input.operations.runtimeState === "RUNNING" || input.operations.runtimeState === "READY_OFFLINE");
  const snapshot = {
    schemaVersion: 1 as const,
    generatedAt,
    mode: input.dashboard.mode,
    health,
    readyForPaperOperations,
    dashboard: input.dashboard,
    research: input.research,
    ai: input.ai ?? null,
    operations: input.operations,
    portfolio: input.portfolio ?? null,
    orders: input.orders ?? [],
    markets: input.markets ?? [],
    paperLearning: input.paperLearning ?? null,
    liveAuthority: "NONE" as const,
    productionMutationAllowed: false as const
  };
  validateReadOnlyProjections(snapshot);
  return deepFreeze(structuredClone(snapshot));
}

export function validatePersonalPaperOperationsSnapshot(snapshot: PersonalPaperOperationsSnapshot, now = Date.now(), maximumAgeMs = 15_000): PersonalPaperOperationsSnapshot {
  if (snapshot.schemaVersion !== 1) throw new Error("unsupported personal PAPER operations schemaVersion");
  if (snapshot.liveAuthority !== "NONE" || snapshot.productionMutationAllowed !== false) throw new Error("personal PAPER operations authority invariant violated");
  finite(snapshot.generatedAt, "generatedAt");
  finite(now, "now");
  if (!Number.isFinite(maximumAgeMs) || maximumAgeMs < 0) throw new Error("maximumAgeMs must be non-negative");
  if (snapshot.generatedAt > now) throw new Error("personal PAPER operations snapshot is from the future");
  if (now - snapshot.generatedAt > maximumAgeMs) throw new Error("personal PAPER operations snapshot is stale");
  validateDashboard(snapshot.dashboard);
  validateResearch(snapshot.research);
  validateAi(snapshot.ai);
  validateOperations(snapshot.operations);
  if (snapshot.paperLearning != null) {
    validatePaperLearningReadOnlySnapshot(snapshot.paperLearning);
  }
  validateReadOnlyProjections(snapshot);
  const expectedHealth = deriveHealth(snapshot);
  if (snapshot.health !== expectedHealth) throw new Error("personal PAPER operations health mismatch");
  if (snapshot.mode !== snapshot.dashboard.mode) throw new Error("personal PAPER operations mode mismatch");
  return deepFreeze(structuredClone(snapshot));
}

export function dashboardHealthToOperationsHealth(health: DashboardHealth): PersonalPaperOperationsHealth {
  return health === "HEALTHY" ? "HEALTHY" : health === "DEGRADED" ? "DEGRADED" : "FAIL_CLOSED";
}
