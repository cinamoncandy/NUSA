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

  const marketValue = input.account.position.quantity * input.markPrice;
  if (!Number.isFinite(marketValue) || marketValue < 0) throw new Error("paper market value must be finite and non-negative");
  const exposure = input.account.equity === 0 ? 0 : marketValue / input.account.equity;
  if (!Number.isFinite(exposure) || exposure < 0 || exposure > 1) throw new Error("paper exposure must be between zero and one");

  const runtimeReasons = input.runtimeAvailable ? [] : ["PAPER_RUNTIME_UNAVAILABLE"];
  const drawdown = Math.max(0, Math.min(1, (input.referenceEquity - input.account.equity) / input.referenceEquity));
  const unknown = unavailable(input.generatedAt, ["SOURCE_NOT_CONNECTED"]);
  const strategyReasons = input.control.status === "FAULTED" ? ["CONTROL_PLANE_FAULTED"] : [];

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
    opportunities: Object.freeze({ ...unknown, activeCount: 0, totalAllocatedCapital: 0, reservedCash: 0 }),
    strategies: Object.freeze({
      status: input.control.status === "FAULTED" ? "BLOCKED" as const : "CAUTION" as const,
      availability: "UNAVAILABLE" as const,
      generatedAt: input.generatedAt,
      reasons: Object.freeze(strategyReasons.length ? strategyReasons : ["STRATEGY_ANALYTICS_NOT_CONNECTED"]),
      totalTrades: input.account.orders.length,
      totalNetPnl: input.account.position.realizedPnl + input.account.unrealizedPnl,
      portfolioCaptureRatio: 0,
      blockedStrategies: input.control.status === "FAULTED" ? 1 : 0,
      warningStrategies: input.control.status === "FAULTED" ? 0 : 1
    }),
    committee: Object.freeze({ ...unknown, decision: "WAIT", confidence: 0, edge: 0, risk: 0, conflictLevel: "HIGH" }),
    execution: Object.freeze({
      status: input.runtimeAvailable ? "HEALTHY" as const : "BLOCKED" as const,
      availability: input.runtimeAvailable ? "AVAILABLE" as const : "INVALID" as const,
      generatedAt: input.generatedAt,
      reasons: Object.freeze(input.runtimeAvailable ? ["PAPER_SYNTHETIC_EXECUTION"] : ["PAPER_RUNTIME_UNAVAILABLE"]),
      fillQuality: input.runtimeAvailable ? 1 : 0,
      slippageBps: 0,
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
