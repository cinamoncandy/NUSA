import { createHash } from "node:crypto";
import type { PreTradeRiskDecision, PreTradeRiskRequest } from "../../../packages/contracts/src/riskGateway";
import { deterministicSha256 } from "./moduleLevel10";

export interface DecisionExecutionIntentV10 {
  readonly decisionId: string;
  readonly symbol: string;
  readonly side: "BUY" | "SELL";
  readonly targetAllocation: number;
  readonly referencePrice: number;
}

export interface SizedExecutionIntentV10 {
  readonly decision: DecisionExecutionIntentV10;
  readonly quantity: number;
  readonly notional: number;
  readonly sizingSha256: string;
}

export interface RiskApprovedExecutionIntentV10 {
  readonly sizedIntent: SizedExecutionIntentV10;
  readonly riskRequest: PreTradeRiskRequest;
  readonly riskDecision: PreTradeRiskDecision;
  readonly authority: "PAPER_ONLY";
  readonly productionMutationAllowed: false;
}

const finitePositive = (value: number): boolean => Number.isFinite(value) && value > 0;
const closeEnough = (left: number, right: number): boolean => Math.abs(left - right) <= Math.max(1e-8, Math.abs(right) * 1e-10);
const riskRequestSha256 = (request: PreTradeRiskRequest): string => createHash("sha256").update(JSON.stringify(request), "utf8").digest("hex");

export function buildSizedExecutionIntentV10(
  decision: DecisionExecutionIntentV10,
  quantity: number
): SizedExecutionIntentV10 {
  if (!decision.decisionId.trim() || !decision.symbol.trim()) throw new Error("sized execution intent identity is required");
  if (decision.side !== "BUY" && decision.side !== "SELL") throw new Error("sized execution intent side is invalid");
  if (!Number.isFinite(decision.targetAllocation) || decision.targetAllocation < 0 || decision.targetAllocation > 1) throw new Error("sized execution allocation is invalid");
  if (!finitePositive(decision.referencePrice) || !finitePositive(quantity)) throw new Error("sized execution price and quantity must be positive");
  const notional = quantity * decision.referencePrice;
  const body = Object.freeze({ decision, quantity, notional });
  return Object.freeze({ ...body, sizingSha256: deterministicSha256(body) });
}

export function assertSizedExecutionIntentV10(input: SizedExecutionIntentV10): void {
  if (input == null || typeof input !== "object") throw new Error("sized execution intent is required");
  const rebuilt = buildSizedExecutionIntentV10(input.decision, input.quantity);
  if (!closeEnough(input.notional, rebuilt.notional) || input.sizingSha256 !== rebuilt.sizingSha256) {
    throw new Error("sized execution intent changed after portfolio sizing");
  }
}

export function bindRiskApprovalV10(
  sizedIntent: SizedExecutionIntentV10,
  riskRequest: PreTradeRiskRequest,
  riskDecision: PreTradeRiskDecision
): RiskApprovedExecutionIntentV10 {
  assertSizedExecutionIntentV10(sizedIntent);
  if (riskDecision.status !== "ALLOW") throw new Error(`risk approval is not ALLOW: ${riskDecision.status}`);
  if (riskDecision.productionMutationAllowed !== false) throw new Error("risk decision attempted to grant production authority");
  if (riskRequestSha256(riskRequest) !== riskDecision.requestSha256) throw new Error("risk decision is not bound to the supplied request");
  if (riskRequest.symbol !== sizedIntent.decision.symbol || riskRequest.side !== sizedIntent.decision.side) {
    throw new Error("risk request identity does not match the sized intent");
  }
  if (!closeEnough(riskRequest.quantity, sizedIntent.quantity) || !closeEnough(riskRequest.referencePrice, sizedIntent.decision.referencePrice)) {
    throw new Error("risk did not evaluate the exact sized quantity and price");
  }
  return Object.freeze({
    sizedIntent,
    riskRequest,
    riskDecision,
    authority: "PAPER_ONLY",
    productionMutationAllowed: false
  });
}

export function assertRiskApprovedExecutionIntentV10(input: RiskApprovedExecutionIntentV10): void {
  const rebound = bindRiskApprovalV10(input.sizedIntent, input.riskRequest, input.riskDecision);
  if (input.authority !== rebound.authority || input.productionMutationAllowed !== false) {
    throw new Error("risk-approved execution authority is invalid");
  }
}
