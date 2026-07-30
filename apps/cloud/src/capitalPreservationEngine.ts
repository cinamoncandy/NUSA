export type PreservationDecision = "PRESERVE" | "REDUCE" | "HALT";

export interface CapitalPreservationInput {
  readonly totalEquity: number;
  readonly drawdown: number;
  readonly dailyLoss: number;
  readonly monthlyLoss: number;
  readonly maximumDrawdown: number;
  readonly dailyLossLimit: number;
  readonly monthlyLossLimit: number;
  readonly recoveryUncertain: boolean;
  readonly killSwitchActive: boolean;
}

export interface CapitalPreservationResult {
  readonly decision: PreservationDecision;
  readonly permittedCapital: number;
  readonly multiplier: number;
  readonly reasons: readonly string[];
}

const ratio = (value: number, field: string): void => {
  if (!Number.isFinite(value) || value < 0 || value > 1) throw new Error(`${field} must be between 0 and 1`);
};

export const preserveCapital = (input: CapitalPreservationInput): CapitalPreservationResult => {
  if (!Number.isFinite(input.totalEquity) || input.totalEquity < 0) throw new Error("totalEquity must be non-negative");
  for (const [value, field] of [[input.drawdown, "drawdown"], [input.dailyLoss, "dailyLoss"], [input.monthlyLoss, "monthlyLoss"], [input.maximumDrawdown, "maximumDrawdown"], [input.dailyLossLimit, "dailyLossLimit"], [input.monthlyLossLimit, "monthlyLossLimit"]] as const) ratio(value, field);
  const reasons: string[] = [];
  if (input.killSwitchActive) reasons.push("KILL_SWITCH_ACTIVE");
  if (input.recoveryUncertain) reasons.push("RECOVERY_UNCERTAIN");
  if (input.drawdown >= input.maximumDrawdown) reasons.push("MAX_DRAWDOWN_REACHED");
  if (input.dailyLoss >= input.dailyLossLimit) reasons.push("DAILY_LOSS_LIMIT_REACHED");
  if (input.monthlyLoss >= input.monthlyLossLimit) reasons.push("MONTHLY_LOSS_LIMIT_REACHED");
  const halt = input.killSwitchActive || input.recoveryUncertain || reasons.includes("MAX_DRAWDOWN_REACHED") || reasons.includes("DAILY_LOSS_LIMIT_REACHED") || reasons.includes("MONTHLY_LOSS_LIMIT_REACHED");
  const multiplier = halt ? 0 : input.drawdown >= input.maximumDrawdown * 0.75 ? 0.25 : input.drawdown >= input.maximumDrawdown * 0.5 ? 0.5 : 1;
  const result = { decision: halt ? "HALT" : multiplier < 1 ? "REDUCE" : "PRESERVE", permittedCapital: input.totalEquity * multiplier, multiplier, reasons: Object.freeze(reasons) } as const;
  return Object.freeze(result);
};
