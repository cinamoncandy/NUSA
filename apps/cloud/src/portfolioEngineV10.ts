import {
  allocateCapital,
  type CapitalAllocationInput,
  type CapitalAllocationPolicy,
  type CapitalAllocationResult
} from "./capitalAllocationEngine";
import { buildPortfolioPlan, type PortfolioPlan, type PortfolioPlanInput } from "./portfolioOrchestrator";

export interface PortfolioCapitalRequest {
  readonly input: CapitalAllocationInput;
  readonly policy: CapitalAllocationPolicy;
}

export interface PortfolioEngineV10Input {
  readonly plan: PortfolioPlanInput;
  readonly capitalRequests?: readonly PortfolioCapitalRequest[];
}

export interface PortfolioEngineV10Output {
  readonly status: "ALLOCATED" | "CASH_ONLY";
  readonly plan: PortfolioPlan;
  readonly capitalDecisions: readonly CapitalAllocationResult[];
  readonly rejectedAllocationIds: readonly string[];
  readonly generatedAt: number;
}

export function runPortfolioEngineV10(input: PortfolioEngineV10Input): PortfolioEngineV10Output {
  const capitalDecisions = (input.capitalRequests ?? []).map((request) => allocateCapital(request.input, request.policy));
  const allocationIds = new Set<string>();
  for (const decision of capitalDecisions) {
    if (allocationIds.has(decision.allocationId)) throw new Error(`duplicate capital allocation id: ${decision.allocationId}`);
    allocationIds.add(decision.allocationId);
  }

  const plan = buildPortfolioPlan(input.plan);
  if (plan.grossShare > input.plan.maxGrossShare + 0.0001) throw new Error("portfolio gross-share invariant failed");
  if (plan.futuresShare > input.plan.maxFuturesShare + 0.0001) throw new Error("portfolio futures-share invariant failed");
  if (plan.deployedCapital > input.plan.deployableCapital + 0.01) throw new Error("portfolio deployable-capital invariant failed");

  const rejectedAllocationIds = capitalDecisions
    .filter((decision) => decision.decision === "REJECT")
    .map((decision) => decision.allocationId)
    .sort();

  return Object.freeze({
    status: plan.allocations.length === 0 ? "CASH_ONLY" : "ALLOCATED",
    plan,
    capitalDecisions: Object.freeze(capitalDecisions),
    rejectedAllocationIds: Object.freeze(rejectedAllocationIds),
    generatedAt: input.plan.now
  });
}
