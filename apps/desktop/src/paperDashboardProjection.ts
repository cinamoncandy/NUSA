import type {
  AiCioSectionSet,
} from "./aiCioSnapshotPublisher";
import type { ResearchDashboardSection } from "../../cloud/src/dashboardAggregator";
import type { ControlSnapshot } from "./controlPlane";
import type { PaperAccountSnapshot } from "./paperBroker";

export interface PaperDashboardProjectionInput {
  readonly account: PaperAccountSnapshot;
  readonly control: ControlSnapshot;
  readonly markPrice: number;
  readonly referenceEquity: number;
  readonly runtimeAvailable: boolean;
  readonly generatedAt: number;
  readonly research?: ResearchDashboardSection;
  /**
   * Real warm-up progress for the single running technical strategy (SMA crossover).
   * This is the only committee-style input this desktop app has real data for; the
   * other ten CommitteeMember roles (MACRO, NEWS, ONCHAIN, ...) have no connected
   * source and must stay reported as unavailable rather than invented. Omitting this
   * field reproduces the prior "not connected" placeholder behavior exactly.
   */
  readonly strategyWarmup?: { readonly current: number; readonly required: number };
  /**
   * The deterministic adverse-price rate (slippageBps + spreadBps / 2) the PaperBroker's
   * fill model currently applies to every order. This is not an observed market-quality
   * metric -- it's the exact configured synthetic-execution cost, reported under the
   * existing PAPER_SYNTHETIC_EXECUTION reason so it is never confused with real fill
   * quality. Omitting this field reproduces the prior hardcoded-0 placeholder exactly.
   */
  readonly executionCostBps?: number;
}

const unavailable = (generatedAt: number, reasons: readonly string[]) => ({
  status: "BLOCKED" as const,
  availability: "UNAVAILABLE" as const,
  generatedAt,
  reasons
});

export function buildPaperDashboardSections(input: PaperDashboardProjectionInput): Required<AiCioSectionSet> {
  if (!Number.isSafeInteger(input.generatedAt) || input.generatedAt < 0) throw new Error("generatedAt must be a non-negative safe integer");
  if (!Number.isFinite(input.markPrice) || input.markPrice <= 0) throw new Error("markPrice must be positive");
  if (!Number.isFinite(input.referenceEquity) || input.referenceEquity <= 0) throw new Error("referenceEquity must be positive");
  if (!Number.isFinite(input.account.equity) || input.account.equity < 0) throw new Error("paper equity must be finite and non-negative");
  if (!Number.isFinite(input.account.cash) || input.account.cash < 0) throw new Error("paper cash must be finite and non-negative");
  if (input.executionCostBps !== undefined && (!Number.isFinite(input.executionCostBps) || input.executionCostBps < 0)) {
    throw new Error("executionCostBps must be finite and non-negative");
  }

  const marketValue = input.account.position.quantity * input.markPrice;
  if (!Number.isFinite(marketValue) || marketValue < 0) throw new Error("paper market value must be finite and non-negative");
  const exposure = input.account.equity === 0 ? 0 : marketValue / input.account.equity;
  if (!Number.isFinite(exposure) || exposure < 0 || exposure > 1) throw new Error("paper exposure must be between zero and one");

  const runtimeReasons = input.runtimeAvailable ? [] : ["PAPER_RUNTIME_UNAVAILABLE"];
  const drawdown = Math.max(0, Math.min(1, (input.referenceEquity - input.account.equity) / input.referenceEquity));
  const unknown = unavailable(input.generatedAt, ["SOURCE_NOT_CONNECTED"]);

  const warmupComplete = input.strategyWarmup !== undefined && input.strategyWarmup.current >= input.strategyWarmup.required;
  let strategyReasons: string[];
  let strategyStatus: "HEALTHY" | "CAUTION" | "BLOCKED";
  let strategyAvailability: "AVAILABLE" | "UNAVAILABLE";
  let blockedStrategies: number;
  let warningStrategies: number;
  if (input.control.status === "FAULTED") {
    strategyReasons = ["CONTROL_PLANE_FAULTED"];
    strategyStatus = "BLOCKED";
    strategyAvailability = input.strategyWarmup === undefined ? "UNAVAILABLE" : "AVAILABLE";
    blockedStrategies = 1;
    warningStrategies = 0;
  } else if (input.strategyWarmup === undefined) {
    strategyReasons = ["STRATEGY_ANALYTICS_NOT_CONNECTED"];
    strategyStatus = "CAUTION";
    strategyAvailability = "UNAVAILABLE";
    blockedStrategies = 0;
    warningStrategies = 1;
  } else if (input.control.status === "STOPPED" || input.control.status === "PAUSED") {
    strategyReasons = [input.control.status === "STOPPED" ? "STRATEGY_STOPPED" : "STRATEGY_PAUSED"];
    strategyStatus = "CAUTION";
    strategyAvailability = "AVAILABLE";
    blockedStrategies = 0;
    warningStrategies = 1;
  } else if (!warmupComplete) {
    strategyReasons = ["STRATEGY_WARMING_UP"];
    strategyStatus = "CAUTION";
    strategyAvailability = "AVAILABLE";
    blockedStrategies = 0;
    warningStrategies = 1;
  } else {
    strategyReasons = [];
    strategyStatus = "HEALTHY";
    strategyAvailability = "AVAILABLE";
    blockedStrategies = 0;
    warningStrategies = 0;
  }

  return Object.freeze({
    portfolio: Object.freeze({
      status: input.runtimeAvailable ? "HEALTHY" as const : "BLOCKED" as const,
      availability: "AVAILABLE" as const,
      generatedAt: input.generatedAt,
      reasons: Object.freeze([...runtimeReasons]),
      totalEquity: input.account.equity,
      deployableCapital: input.account.equity,
      reservedCapital: 0,
      grossExposureRatio: exposure,
      netExposureRatio: exposure
    }),
    opportunities: Object.freeze({
      status: input.runtimeAvailable ? "HEALTHY" as const : "BLOCKED" as const,
      availability: input.runtimeAvailable ? "AVAILABLE" as const : "INVALID" as const,
      generatedAt: input.generatedAt,
      reasons: Object.freeze([...runtimeReasons]),
      // The only "opportunity" this desktop app can honestly report is the current open
      // Paper position itself: one strategy, one market, no independent opportunity-scoring
      // model. topOpportunityScore is intentionally omitted rather than invented.
      activeCount: input.account.position.quantity > 0 ? 1 : 0,
      totalAllocatedCapital: marketValue,
      reservedCash: 0,
      ...(input.account.position.quantity > 0 ? { topOpportunityId: `paper:${input.account.position.market}` } : {})
    }),
    strategies: Object.freeze({
      status: strategyStatus,
      availability: strategyAvailability,
      generatedAt: input.generatedAt,
      reasons: Object.freeze(strategyReasons),
      totalTrades: input.account.orders.length,
      totalNetPnl: input.account.position.realizedPnl + input.account.unrealizedPnl,
      portfolioCaptureRatio: 0,
      blockedStrategies,
      warningStrategies
    }),
    committee: Object.freeze({ ...unknown, decision: "WAIT", confidence: 0, edge: 0, risk: 0, conflictLevel: "HIGH" }),
    execution: Object.freeze({
      status: input.runtimeAvailable ? "HEALTHY" as const : "BLOCKED" as const,
      availability: input.runtimeAvailable ? "AVAILABLE" as const : "INVALID" as const,
      generatedAt: input.generatedAt,
      reasons: Object.freeze(input.runtimeAvailable ? ["PAPER_SYNTHETIC_EXECUTION"] : ["PAPER_RUNTIME_UNAVAILABLE"]),
      fillQuality: input.runtimeAvailable ? 1 : 0,
      slippageBps: input.executionCostBps ?? 0,
      latencyMs: 0
    }),
    research: input.research ?? Object.freeze({ ...unknown, walkForwardPassed: false, monteCarloPassed: false, costStressPassed: false, paperPromotionEligible: false }),
    risk: Object.freeze({
      status: input.runtimeAvailable ? "HEALTHY" as const : "BLOCKED" as const,
      availability: input.runtimeAvailable ? "AVAILABLE" as const : "INVALID" as const,
      generatedAt: input.generatedAt,
      reasons: Object.freeze([...runtimeReasons]),
      killSwitchActive: !input.runtimeAvailable,
      dailyDrawdownRatio: drawdown,
      liquidationBufferRatio: 1,
      portfolioHeatRatio: exposure
    })
  });
}
