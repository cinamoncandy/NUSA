import type {
  AiCioSectionSet,
} from "../ai/aiCioSnapshotPublisher";
import type { ResearchDashboardSection } from "../../../cloud/src/dashboardAggregator";
import type { ControlSnapshot } from "../control/controlPlane";
import type { PaperAccountSnapshot } from "./paperBroker";
import type { CommitteeDashboardSection, OpportunityDashboardSection } from "../../../cloud/src/dashboardAggregator";
import { verifyStrategyAnalytics, type StrategyAnalyticsSnapshot } from "../strategy/strategyAnalytics";
import { buildOpportunityDashboardSection } from "../cloud/opportunityDashboardProjection";
import type { OpportunitySchedule } from "../../../cloud/src/opportunityScheduler";
import type { CanonicalRiskDecision } from "../../../../packages/contracts/src/risk-safety-integration";

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
  /** Persisted, strategy-attributed analytics. Warm-up alone is not performance evidence. */
  readonly strategyAnalytics?: StrategyAnalyticsSnapshot;
  /**
   * The deterministic adverse-price rate (slippageBps + spreadBps / 2) the PaperBroker's
   * fill model currently applies to every order. This is not an observed market-quality
   * metric -- it's the exact configured synthetic-execution cost, reported under the
   * existing PAPER_SYNTHETIC_EXECUTION reason so it is never confused with real fill
   * quality. Omitting this field reproduces the prior hardcoded-0 placeholder exactly.
   */
  readonly executionCostBps?: number;
  /** Independent opportunity analytics are not inferred from a Paper position. */
  readonly opportunity?: OpportunityDashboardSection;
  /** A validated scheduler result may be projected read-only; no schedule is inferred here. */
  readonly opportunitySchedule?: OpportunitySchedule;
  readonly committee?: CommitteeDashboardSection;
  /** Last decision produced by the canonical runtime risk gate. */
  readonly canonicalRiskDecision?: CanonicalRiskDecision;
  /**
   * WO-0019. The real, persisted kill switch state. When supplied, this -- and only this --
   * drives risk.killSwitchActive; a risk gate rejection for any other reason (daily loss,
   * missing approval, stale market data, ...) is reported through risk.lastRiskDecision
   * instead, never mislabeled as the kill switch.
   */
  readonly killSwitchActive?: boolean;
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
  if (input.strategyAnalytics !== undefined && verifyStrategyAnalytics(input.strategyAnalytics).length > 0) {
    throw new Error("strategy analytics verification failed");
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
  if (input.strategyAnalytics === undefined) {
    strategyReasons = ["STRATEGY_ANALYTICS_NOT_CONNECTED"];
    strategyStatus = "BLOCKED";
    strategyAvailability = "UNAVAILABLE";
    blockedStrategies = 0;
    warningStrategies = 0;
  } else if (input.control.status === "FAULTED") {
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
    opportunities: input.opportunity ?? (input.opportunitySchedule === undefined ? Object.freeze({
      status: input.runtimeAvailable ? "BLOCKED" as const : "BLOCKED" as const,
      availability: input.runtimeAvailable ? "UNAVAILABLE" as const : "INVALID" as const,
      generatedAt: input.generatedAt,
      reasons: Object.freeze([input.runtimeAvailable ? "OPPORTUNITY_ANALYTICS_NOT_CONNECTED" : "PAPER_RUNTIME_UNAVAILABLE"]),
      activeCount: 0,
      totalAllocatedCapital: 0,
      reservedCash: 0
    }) : buildOpportunityDashboardSection(input.opportunitySchedule, input.generatedAt)),
    strategies: Object.freeze({
      status: strategyStatus,
      availability: strategyAvailability,
      generatedAt: input.generatedAt,
      reasons: Object.freeze(strategyReasons),
      totalTrades: input.strategyAnalytics?.orderCount ?? 0,
      totalNetPnl: input.strategyAnalytics?.netPnl ?? 0,
      portfolioCaptureRatio: input.strategyAnalytics?.portfolioCaptureRatio ?? 0,
      blockedStrategies,
      warningStrategies
    }),
    committee: input.committee ?? Object.freeze({ ...unknown, decision: "WAIT", confidence: 0, edge: 0, risk: 0, conflictLevel: "HIGH" }),
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
      status: input.canonicalRiskDecision === undefined
        ? input.runtimeAvailable ? "HEALTHY" as const : "BLOCKED" as const
        : input.canonicalRiskDecision.status === "APPROVED" ? "HEALTHY" as const : "BLOCKED" as const,
      availability: input.runtimeAvailable ? "AVAILABLE" as const : "INVALID" as const,
      generatedAt: input.generatedAt,
      reasons: Object.freeze(input.canonicalRiskDecision === undefined ? [...runtimeReasons] : [...input.canonicalRiskDecision.reasonCodes]),
      // The real switch only. A DAILY_LOSS_LIMIT or APPROVAL_MISSING rejection must never read
      // as "Kill Switch ACTIVE" -- that distinction is what lastRiskDecision below is for.
      killSwitchActive: input.killSwitchActive ?? (input.canonicalRiskDecision === undefined ? !input.runtimeAvailable : false),
      lastRiskDecision: input.canonicalRiskDecision === undefined ? undefined : Object.freeze({
        status: input.canonicalRiskDecision.status,
        gate: "COMPOSITE",
        reasonCodes: input.canonicalRiskDecision.reasonCodes,
        evaluatedAt: input.canonicalRiskDecision.evaluatedAtMs
      }),
      dailyDrawdownRatio: drawdown,
      liquidationBufferRatio: 1,
      portfolioHeatRatio: exposure
    })
  });
}
