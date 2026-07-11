import { MOBILE_DASHBOARD_API_VERSION, type MobileDashboardResponse } from "../../../packages/contracts/src/mobileDashboard";
import type { CioDecision } from "./cioDecisionEngine";
import type { FusedIntelligence } from "./marketIntelligenceFusion";
import type { PortfolioPlan } from "./portfolioOrchestrator";

export interface MobileDashboardApiInput {
  readonly now: number;
  readonly mode: "PAPER" | "STOPPED" | "FAULTED";
  readonly killSwitchActive: boolean;
  readonly overallHealth: "HEALTHY" | "DEGRADED" | "DOWN";
  readonly headline: string;
  readonly issues: readonly string[];
  readonly portfolio: PortfolioPlan;
  readonly decisions: readonly CioDecision[];
  readonly intelligence: FusedIntelligence;
}

export function buildMobileDashboardResponse(input: MobileDashboardApiInput): MobileDashboardResponse {
  if (!Number.isSafeInteger(input.now) || input.now < 0) throw new Error("now must be a non-negative safe integer");
  if (!input.headline.trim()) throw new Error("headline is required");
  if (input.portfolio.decidedAt > input.now) throw new Error("portfolio decision is from the future");
  if (input.intelligence.generatedAt > input.now) throw new Error("intelligence is from the future");

  const spotCapital = input.portfolio.allocations
    .filter((item) => item.instrument === "SPOT")
    .reduce((sum, item) => sum + item.capital, 0);
  const futuresCapital = input.portfolio.allocations
    .filter((item) => item.instrument === "FUTURES")
    .reduce((sum, item) => sum + item.capital, 0);

  const tradingAllowed = input.mode === "PAPER" && !input.killSwitchActive && input.overallHealth === "HEALTHY";
  const issues = [...new Set(input.issues.map((issue) => issue.trim()).filter(Boolean))].sort();
  const decisions = [...input.decisions]
    .sort((a, b) => a.symbol.localeCompare(b.symbol))
    .map((decision) => {
      if (decision.decidedAt > input.now) throw new Error(`decision is from the future: ${decision.symbol}`);
      return Object.freeze({ ...decision, reasons: Object.freeze([...decision.reasons]) });
    });

  return Object.freeze({
    apiVersion: MOBILE_DASHBOARD_API_VERSION,
    generatedAt: input.now,
    mode: input.mode,
    killSwitchActive: input.killSwitchActive,
    overallHealth: input.overallHealth,
    tradingAllowed,
    headline: input.headline.trim(),
    issues: Object.freeze(issues),
    deployableCapital: input.portfolio.deployedCapital + input.portfolio.cashCapital,
    deployedCapital: input.portfolio.deployedCapital,
    cashCapital: input.portfolio.cashCapital,
    reservedCapital: input.portfolio.reservedCapital,
    spotCapital,
    futuresCapital,
    positions: Object.freeze(input.portfolio.allocations.map((item) => Object.freeze({ ...item }))),
    decisions: Object.freeze(decisions),
    staleIntelligenceSources: Object.freeze([...input.intelligence.staleSources].sort())
  });
}
