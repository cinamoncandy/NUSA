import type { DashboardHealth, DashboardMode, MobileDashboardResponse } from "./mobileDashboard";
import type { ResearchStatusProjection } from "./researchAutomation";
import type { AiReadOnlyProjection } from "./aiInference";
import { validatePaperLearningReadOnlySnapshot, type PaperLearningReadOnlySnapshot } from "./paperLearningReadOnly";

export type PersonalPaperOperationsHealth = "HEALTHY" | "DEGRADED" | "FAIL_CLOSED";
export type PersonalPaperRuntimeState = "HALTED" | "READY_OFFLINE" | "READY" | "RUNNING" | "DEGRADED" | "ERROR" | "STOPPING" | "STOPPED";
export type PersonalPaperSchedulerMode = "OFF" | "OBSERVE" | "ACTIVE";

/** Display only: why the latest canonical decision was what it was. Untrusted by the client; malformed values are dropped. */
export interface PersonalPaperResearchCollection {
  readonly market: string;
  /** Stored closed 1-minute candles for the market. */
  readonly candleCount: number;
  /** Candles needed before the first experiment (train + validation + holdout windows). */
  readonly requiredCandles: number;
  readonly firstCloseMs?: number;
  readonly lastCloseMs?: number;
  readonly observedAt: number;
}

export interface PersonalPaperDecisionDetail {
  readonly action: string;
  readonly score: number;
  readonly confidence: number;
  readonly risk: string;
  readonly hasPosition: boolean;
  readonly strategyAction?: string;
  /** Bare code charset only, at most 160 characters. */
  readonly reason?: string;
  readonly observedAt: number;
}

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
  /** Display only, for the current 09:00 KST window: BUY decisions and BUY decisions the PAPER boundary refused (BLOCKED or REJECTED). Absent on older runtimes and when no canonical PAPER boundary measures them. */
  readonly buySignalCount?: number;
  readonly buyBlockedCount?: number;
  /** Display only: decisions and PAPER orders in the same 09:00 KST window. Absent on older runtimes and without a canonical PAPER boundary. */
  readonly windowDecisionCount?: number;
  readonly windowOrderCount?: number;
  /** Display only, same window: public market feed drops, ticker gaps longer than the stale window, and the longest gap in ms. */
  readonly feedDisconnectCount?: number;
  readonly feedStaleGapCount?: number;
  readonly feedMaxGapMs?: number;
  readonly feedCountsSince?: number;
  /** Display only: the numbers and strategy reason behind the latest decision. Absent without a canonical PAPER boundary. */
  readonly lastDecisionDetail?: PersonalPaperDecisionDetail;
  /** Display only: the markets this PAPER runtime watches and trades (the configured list, 1-5). Absent without a canonical PAPER boundary. */
  readonly tradedMarkets?: readonly string[];
  /** Display only: how much 1-minute candle history the research experiments have collected. Absent when research is off. */
  readonly researchCollection?: PersonalPaperResearchCollection;
  /** Display only: why researchCollection is absent. DISABLED: the continuous research experiments are off on this server; INVALID: their settings are rejected; UNAVAILABLE: they are on but the candle store could not be read. Never present together with researchCollection. */
  readonly researchCollectionState?: "DISABLED" | "INVALID" | "UNAVAILABLE";
  /** Epoch ms from which the counters above have been counted (the window start, or the runtime start if later). */
  readonly buyCountsSince?: number;
  /** Coded `STATUS:REASON` of the latest PAPER boundary decision (why an order was or was not placed). */
  readonly lastPaperDecisionOutcome?: string | null;
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

export type PersonalPaperRuntimeHaltReason =
  | "DASHBOARD_FAULTED"
  | "KILL_SWITCH_ACTIVE"
  | "AI_P0_OPEN"
  | "AI_P0_UNVERIFIABLE";

export interface PersonalPaperRuntimeProjection {
  readonly runtimeState: PersonalPaperRuntimeState;
  readonly schedulerRunning: boolean;
  readonly schedulerMode: PersonalPaperSchedulerMode;
  readonly pipelineStage: string;
  readonly transport: "ONLINE" | "OFFLINE";
  readonly killSwitchActive: boolean;
  readonly accountHalted: boolean;
  /**
   * Which fail-closed inputs asserted HALTED, when any did.
   *
   * `runtimeState` alone cannot be traced back to a cause, and `accountHalted` merges two
   * different ones (a FAULTED dashboard and an open/unverifiable AI P0), so a HALTED observation
   * in long-soak evidence could not be attributed. Present only while `runtimeState` is HALTED.
   */
  readonly runtimeHaltReasons?: readonly PersonalPaperRuntimeHaltReason[];
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
    if (heartbeat.lastPaperDecisionOutcome != null && (typeof heartbeat.lastPaperDecisionOutcome !== "string" || !/^[A-Z]{3,12}:[A-Z0-9_.:+-]{1,100}$/.test(heartbeat.lastPaperDecisionOutcome))) throw new Error("operations.heartbeat.lastPaperDecisionOutcome must be a coded STATUS:REASON when present");
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
  // Research is optional learning: while it is still gathering data (DEGRADED with no experiments yet) or its evidence is old (STALE) it
  // must not mark PAPER operations as unhealthy. Only a research FAIL_CLOSED, above, still does. Owner decision in chat 2026-10-06.
  if (
    input.dashboard.overallHealth === "DEGRADED" || !["READY", "RUNNING"].includes(input.operations.runtimeState) || input.operations.transport !== "ONLINE" ||
    input.operations.pendingWrites > 0
  ) return "DEGRADED";
  return "HEALTHY";
}

const cloneJsonProjection = <T>(value: T): T => {
  // Personal PAPER projections are JSON transport values. React Native Hermes versions used by
  // the Android app do not universally expose structuredClone, so keep this contract validator
  // portable instead of depending on a host global that exists in Node but may not exist on-device.
  return JSON.parse(JSON.stringify(value)) as T;
};

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
  return deepFreeze(cloneJsonProjection(snapshot));
}

const DISPLAY_ONLY_COUNTERS = ["buySignalCount", "buyBlockedCount", "buyCountsSince", "windowDecisionCount", "windowOrderCount", "feedDisconnectCount", "feedStaleGapCount", "feedMaxGapMs", "feedCountsSince"] as const;
/**
 * The display-only counters are optional and untrusted: a malformed value is omitted (so the client falls back)
 * instead of rejecting the whole snapshot and hiding valid health, portfolio and operational state.
 */
function dropMalformedDisplayCounters(heartbeat: PersonalPaperRuntimeHeartbeat | undefined): void {
  if (heartbeat == null) return;
  const record = heartbeat as unknown as Record<string, unknown>;
  for (const name of DISPLAY_ONLY_COUNTERS) {
    const value = record[name];
    if (value !== undefined && !(typeof value === "number" && Number.isSafeInteger(value) && value >= 0)) delete record[name];
  }
  if (record.lastDecisionDetail !== undefined && !isValidDecisionDetail(record.lastDecisionDetail)) delete record.lastDecisionDetail;
  if (record.researchCollection !== undefined && !isValidResearchCollection(record.researchCollection)) delete record.researchCollection;
  if (record.researchCollectionState !== undefined && (record.researchCollection !== undefined || !["DISABLED", "INVALID", "UNAVAILABLE"].includes(record.researchCollectionState as string))) delete record.researchCollectionState;
  if (record.tradedMarkets !== undefined && !isValidMarketList(record.tradedMarkets)) delete record.tradedMarkets;
}

function isValidMarketList(value: unknown): boolean {
  return Array.isArray(value) && value.length >= 1 && value.length <= 5 && new Set(value).size === value.length
    && value.every((item) => typeof item === "string" && /^KRW-[A-Z0-9-]{1,16}$/.test(item));
}
const isCount = (value: unknown, min = 0): boolean => typeof value === "number" && Number.isSafeInteger(value) && value >= min && value <= 100_000_000;
function isValidResearchCollection(value: unknown): boolean {
  if (value == null || typeof value !== "object" || Array.isArray(value)) return false;
  const v = value as Record<string, unknown>;
  return typeof v.market === "string" && /^KRW-[A-Z0-9-]{1,16}$/.test(v.market)
    && isCount(v.candleCount) && isCount(v.requiredCandles, 1)
    && (v.firstCloseMs === undefined || isTimeMs(v.firstCloseMs))
    && (v.lastCloseMs === undefined || isTimeMs(v.lastCloseMs))
    && isTimeMs(v.observedAt);
}

// Epoch milliseconds (about 1.8e12 today) are times, not counts: they must not be held to the 100,000,000 count limit, which rejected every real time
// and made the app show "집계 미수신". The upper bound is the largest time a JavaScript Date can hold.
const isTimeMs = (value: unknown): boolean => typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && value <= 8_640_000_000_000_000;

const DECISION_CODE = /^[A-Z_]{2,16}$/;
const DECISION_REASON = /^[A-Za-z0-9_.:/=+-]{1,160}$/;
function isValidDecisionDetail(value: unknown): boolean {
  if (value == null || typeof value !== "object" || Array.isArray(value)) return false;
  const v = value as Record<string, unknown>;
  return typeof v.action === "string" && DECISION_CODE.test(v.action)
    && typeof v.risk === "string" && DECISION_CODE.test(v.risk)
    && typeof v.score === "number" && Number.isFinite(v.score) && Math.abs(v.score) <= 1
    && typeof v.confidence === "number" && Number.isFinite(v.confidence) && v.confidence >= 0 && v.confidence <= 1
    && typeof v.hasPosition === "boolean"
    && (v.strategyAction === undefined || (typeof v.strategyAction === "string" && DECISION_CODE.test(v.strategyAction)))
    && (v.reason === undefined || (typeof v.reason === "string" && DECISION_REASON.test(v.reason)))
    && typeof v.observedAt === "number" && Number.isSafeInteger(v.observedAt) && v.observedAt >= 0;
}

export function validatePersonalPaperOperationsSnapshot(snapshot: PersonalPaperOperationsSnapshot, now = Date.now(), maximumAgeMs = 15_000): PersonalPaperOperationsSnapshot {
  if (snapshot.schemaVersion !== 1) throw new Error("unsupported personal PAPER operations schemaVersion");
  if (snapshot.liveAuthority !== "NONE" || snapshot.productionMutationAllowed !== false) throw new Error("personal PAPER operations authority invariant violated");
  finite(snapshot.generatedAt, "generatedAt");
  finite(now, "now");
  if (!Number.isFinite(maximumAgeMs) || maximumAgeMs < 0) throw new Error("maximumAgeMs must be non-negative");
  if (snapshot.generatedAt - now > maximumAgeMs) throw new Error("personal PAPER operations snapshot is from the future");
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
  const validated = cloneJsonProjection(snapshot);
  dropMalformedDisplayCounters(validated.operations.heartbeat);
  return deepFreeze(validated);
}

export function dashboardHealthToOperationsHealth(health: DashboardHealth): PersonalPaperOperationsHealth {
  return health === "HEALTHY" ? "HEALTHY" : health === "DEGRADED" ? "DEGRADED" : "FAIL_CLOSED";
}
