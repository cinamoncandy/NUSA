import type { ExecutionRecord, ExecutionService } from "./durable-execution";
import type { GlobalRiskGateway, RiskContext, RiskDecision } from "./global-risk-gateway";

export interface RiskGatedSubmitResult {
  readonly decision: RiskDecision;
  readonly execution: ExecutionRecord | null;
}

/**
 * The only orchestration boundary allowed to call live-capable ExecutionService.submit().
 * A rejected or indeterminate risk decision returns without touching the exchange port.
 * The production descriptor still makes the default path fail closed.
 */
export async function submitAfterGlobalRisk(
  service: ExecutionService,
  gateway: GlobalRiskGateway,
  executionId: string,
  context: RiskContext
): Promise<RiskGatedSubmitResult> {
  if (context.productionMutationAllowed !== false) throw new Error("PRODUCTION_MUTATION_POLICY_INVALID");
  const decision = gateway.evaluate(executionId, context);
  if (decision.executionId !== executionId) throw new Error("RISK_DECISION_EXECUTION_MISMATCH");
  if (decision.result !== "APPROVED") return Object.freeze({ decision, execution: null });
  const execution = await service.submit(executionId);
  return Object.freeze({ decision, execution });
}
