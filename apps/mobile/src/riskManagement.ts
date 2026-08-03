export type RiskDecision = "APPROVED" | "BLOCKED";
export interface RiskPolicy { readonly dailyLossLimit: number; readonly maxPositionQuantity: number; readonly maxSymbolExposure: number; readonly maxOrderQuantity: number; readonly maxConsecutiveLosses: number; }
export interface RiskInput { readonly orderQuantity: number; readonly orderNotional: number; readonly currentPositionQuantity: number; readonly symbolExposure: number; readonly dailyRealizedLoss: number; readonly consecutiveLosses: number; readonly circuitBreakerActive: boolean; readonly stateKnown: boolean; }
export interface RiskResult { readonly decision: RiskDecision; readonly reasons: readonly string[]; readonly riskScore: number; readonly productionMutationAllowed: false; }
export type PortfolioRiskLevel = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

const valid = (value: number): boolean => Number.isFinite(value) && value >= 0;

export function evaluateRisk(input: RiskInput, policy: RiskPolicy): RiskResult {
  const reasons: string[] = [];
  if (!input.stateKnown || Object.values(input).some((value) => typeof value === "number" && !valid(value))) reasons.push("UNKNOWN_RISK_STATE");
  if (!Number.isFinite(policy.dailyLossLimit) || policy.dailyLossLimit <= 0 || !Number.isFinite(policy.maxPositionQuantity) || policy.maxPositionQuantity <= 0 || !Number.isFinite(policy.maxSymbolExposure) || policy.maxSymbolExposure <= 0 || !Number.isFinite(policy.maxOrderQuantity) || policy.maxOrderQuantity <= 0 || !Number.isFinite(policy.maxConsecutiveLosses) || policy.maxConsecutiveLosses <= 0) reasons.push("INVALID_RISK_POLICY");
  if (input.circuitBreakerActive) reasons.push("CIRCUIT_BREAKER_ACTIVE");
  if (input.dailyRealizedLoss >= policy.dailyLossLimit) reasons.push("DAILY_LOSS_LIMIT");
  if (input.consecutiveLosses >= policy.maxConsecutiveLosses) reasons.push("CONSECUTIVE_LOSS_LIMIT");
  if (!Number.isFinite(input.orderQuantity) || input.orderQuantity <= 0 || input.orderQuantity > policy.maxOrderQuantity) reasons.push("ORDER_QUANTITY_LIMIT");
  if (input.currentPositionQuantity + input.orderQuantity > policy.maxPositionQuantity) reasons.push("POSITION_LIMIT");
  if (input.symbolExposure + input.orderNotional > policy.maxSymbolExposure) reasons.push("SYMBOL_EXPOSURE_LIMIT");
  const score = Math.min(100, Math.round((input.dailyRealizedLoss / policy.dailyLossLimit) * 40 + (input.consecutiveLosses / policy.maxConsecutiveLosses) * 30 + ((input.symbolExposure + input.orderNotional) / policy.maxSymbolExposure) * 30));
  return Object.freeze({ decision: reasons.length === 0 ? "APPROVED" : "BLOCKED", reasons: Object.freeze(reasons), riskScore: Number.isFinite(score) ? score : 100, productionMutationAllowed: false as const });
}

export const evaluatePaperRisk = evaluateRisk;

export function canResumeCircuitBreaker(input: Pick<RiskInput, "dailyRealizedLoss" | "consecutiveLosses" | "stateKnown" | "circuitBreakerActive">, policy: RiskPolicy, manuallyAcknowledged: boolean): boolean {
  return manuallyAcknowledged && input.stateKnown && !input.circuitBreakerActive && input.dailyRealizedLoss < policy.dailyLossLimit && input.consecutiveLosses < policy.maxConsecutiveLosses;
}

export function portfolioRiskLevel(riskScore: number): PortfolioRiskLevel {
  if (!Number.isFinite(riskScore) || riskScore >= 80) return "CRITICAL";
  if (riskScore >= 60) return "HIGH";
  if (riskScore >= 30) return "MEDIUM";
  return "LOW";
}
