/**
 * Fixed-fractional risk-based position sizing: a standard, well-established risk-
 * management technique (order size scales with account equity, not a fixed constant).
 * Addresses the investment-strategy audit's "fixed order quantity is not risk-based
 * sizing; it does not scale with equity" finding.
 *
 * This is a sizing mechanism only, not a trading edge or performance claim: a smaller
 * riskFraction can only ever produce an equal or smaller order than the current fixed-
 * quantity default, never a larger one relative to what an operator explicitly allows
 * elsewhere (PaperRiskPolicy.maxOrderNotional/maxPositionQuantity still apply downstream
 * in PaperBroker regardless of how the requested quantity was derived).
 *
 * Deliberately not wired into ControlPlane/RuntimeCommandService yet: control.orderQuantity
 * is currently a static, operator-settable, IPC-displayed number (apps/desktop/src/
 * controlPlane.ts, main.ts's "control:quantity" channel, the renderer). Making it a
 * function of live equity/price would change that contract for every caller and the
 * renderer surface, which is a larger, separately reviewable change -- not something to
 * fold in silently alongside a sizing utility.
 */

export interface FixedFractionalSizingInput {
  /** Current account equity (cash + market value of any open position), in the account's currency. */
  readonly equity: number;
  /** Current market price for the instrument being sized. */
  readonly price: number;
  /** Fraction of equity to risk on this order, in (0, 1]. Conservative defaults should be small (e.g. 0.01 = 1%). */
  readonly riskFraction: number;
  /** Optional quantity step to floor the result to, matching PaperBroker's own step/dust conventions. Unset returns the raw quotient. */
  readonly quantityStep?: number;
}

export type PositionSizingModel = "FIXED_AMOUNT" | "FIXED_PERCENTAGE" | "RISK_PERCENTAGE" | "VOLATILITY_ADJUSTED" | "ATR_BASED" | "KELLY";

export interface PositionSizingRiskLimits {
  readonly maxOrderNotional?: number;
  readonly maxQuantity?: number;
  readonly maxLoss?: number;
}

export interface PositionSizingInput {
  readonly model: PositionSizingModel;
  readonly equity: number;
  readonly availableBuyingPower: number;
  readonly price: number;
  readonly fixedAmount?: number;
  readonly fixedPercentage?: number;
  readonly riskPercentage?: number;
  readonly stopDistance?: number;
  readonly volatility?: number;
  readonly volatilityTarget?: number;
  readonly atr?: number;
  readonly atrMultiplier?: number;
  readonly winProbability?: number;
  readonly rewardRiskRatio?: number;
  readonly kellyFraction?: number;
  readonly quantityStep?: number;
  readonly riskLimits?: PositionSizingRiskLimits;
}

export interface PositionSizingResult {
  readonly model: PositionSizingModel;
  readonly requestedQuantity: number;
  readonly approvedQuantity: number;
  readonly requestedNotional: number;
  readonly approvedNotional: number;
  readonly capped: boolean;
  readonly reasons: readonly string[];
}

export interface CapitalSnapshotInput {
  readonly cash: number;
  readonly reservedCapital: number;
  readonly marketValue: number;
  readonly peakEquity: number;
  readonly dailyStartEquity: number;
  readonly weeklyStartEquity: number;
  readonly monthlyStartEquity: number;
  readonly realizedPnl: number;
  readonly unrealizedPnl: number;
}

export interface CapitalSnapshot {
  readonly currentEquity: number;
  readonly peakEquity: number;
  readonly dailyEquity: number;
  readonly weeklyEquity: number;
  readonly monthlyEquity: number;
  readonly availableBuyingPower: number;
  readonly reservedCapital: number;
  readonly realizedPnl: number;
  readonly unrealizedPnl: number;
}

export interface CapitalProtectionLimits {
  readonly maximumDailyLoss: number;
  readonly maximumWeeklyLoss: number;
  readonly maximumDrawdown: number;
  readonly maximumConsecutiveLosses: number;
  readonly maximumRiskBudgetUsage: number;
}

export interface CapitalProtectionInput {
  readonly snapshot: CapitalSnapshot;
  readonly consecutiveLosses: number;
  readonly riskBudgetUsage: number;
}

export interface CapitalProtectionResult {
  readonly status: "NORMAL" | "REDUCE" | "BLOCK";
  readonly positionSizeMultiplier: number;
  readonly blockNewEntries: boolean;
  readonly pauseStrategy: boolean;
  readonly requiresAcknowledgement: boolean;
  readonly reasons: readonly string[];
}

function assertPositiveFinite(value: number, name: string): void {
  if (!Number.isFinite(value) || value <= 0) throw new Error(`${name} must be positive and finite`);
}

function decimalPlaces(value: number): number {
  const text = value.toString().toLowerCase();
  const exponentMarker = text.indexOf("e-");
  if (exponentMarker >= 0) return Number(text.slice(exponentMarker + 2));
  const decimalMarker = text.indexOf(".");
  return decimalMarker < 0 ? 0 : text.length - decimalMarker - 1;
}

function floorToStep(value: number, step: number): number {
  const precision = Math.min(15, Math.max(decimalPlaces(step), 0));
  const units = Math.floor((value + Number.EPSILON) / step);
  return Number((units * step).toFixed(precision));
}

/**
 * Computes quantity = (equity * riskFraction) / price, optionally floored to quantityStep.
 * Never returns a negative quantity; returns 0 if the floored result is below one step
 * (the caller/PaperBroker's own dust-threshold rejection already handles that case safely).
 */
export function calculateFixedFractionalQuantity(input: FixedFractionalSizingInput): number {
  assertPositiveFinite(input.equity, "equity");
  assertPositiveFinite(input.price, "price");
  if (!Number.isFinite(input.riskFraction) || input.riskFraction <= 0 || input.riskFraction > 1) {
    throw new Error("riskFraction must be in (0, 1]");
  }
  if (input.quantityStep !== undefined) assertPositiveFinite(input.quantityStep, "quantityStep");

  const rawQuantity = (input.equity * input.riskFraction) / input.price;
  return input.quantityStep === undefined ? rawQuantity : floorToStep(rawQuantity, input.quantityStep);
}

const finiteNonNegative = (value: number, name: string): void => {
  if (!Number.isFinite(value) || value < 0) throw new Error(`${name} must be finite and non-negative`);
};
const ratio = (value: number, name: string): void => {
  if (!Number.isFinite(value) || value < 0 || value > 1) throw new Error(`${name} must be between 0 and 1`);
};

export function calculatePositionQuantity(input: PositionSizingInput): PositionSizingResult {
  assertPositiveFinite(input.equity, "equity");
  finiteNonNegative(input.availableBuyingPower, "availableBuyingPower");
  assertPositiveFinite(input.price, "price");
  if (input.availableBuyingPower > input.equity) throw new Error("availableBuyingPower cannot exceed equity");
  const amount = (value: number | undefined, name: string): number => { if (value === undefined) throw new Error(`${name} is required`); finiteNonNegative(value, name); return value; };
  const percentage = (value: number | undefined, name: string): number => { if (value === undefined) throw new Error(`${name} is required`); ratio(value, name); return value; };
  let notional: number;
  switch (input.model) {
    case "FIXED_AMOUNT": notional = amount(input.fixedAmount, "fixedAmount"); break;
    case "FIXED_PERCENTAGE": notional = input.equity * percentage(input.fixedPercentage, "fixedPercentage"); break;
    case "RISK_PERCENTAGE": notional = input.equity * percentage(input.riskPercentage, "riskPercentage") / amount(input.stopDistance, "stopDistance") * input.price; break;
    case "VOLATILITY_ADJUSTED": {
      const base = input.equity * percentage(input.fixedPercentage, "fixedPercentage");
      const target = amount(input.volatilityTarget, "volatilityTarget");
      const actual = amount(input.volatility, "volatility");
      notional = actual === 0 ? base : base * Math.min(1, target / actual);
      break;
    }
    case "ATR_BASED": {
      const multiplier = input.atrMultiplier ?? 1;
      assertPositiveFinite(multiplier, "atrMultiplier");
      notional = input.equity * percentage(input.riskPercentage, "riskPercentage") / (amount(input.atr, "atr") * multiplier) * input.price;
      break;
    }
    case "KELLY": {
      const win = percentage(input.winProbability, "winProbability");
      const payoff = amount(input.rewardRiskRatio, "rewardRiskRatio");
      if (payoff <= 0) throw new Error("rewardRiskRatio must be positive");
      const fullKelly = Math.max(0, win - (1 - win) / payoff);
      notional = input.equity * fullKelly * (input.kellyFraction ?? 0.25);
      break;
    }
    default: throw new Error(`unsupported sizing model: ${String(input.model)}`);
  }
  if (!Number.isFinite(notional) || notional < 0) throw new Error("sizing result is invalid");
  const limits = input.riskLimits ?? {};
  if (limits.maxOrderNotional !== undefined) finiteNonNegative(limits.maxOrderNotional, "maxOrderNotional");
  if (limits.maxQuantity !== undefined) finiteNonNegative(limits.maxQuantity, "maxQuantity");
  if (limits.maxLoss !== undefined) finiteNonNegative(limits.maxLoss, "maxLoss");
  if (limits.maxLoss !== undefined && input.stopDistance !== undefined && input.stopDistance > 0) notional = Math.min(notional, limits.maxLoss / input.stopDistance * input.price);
  const cap = Math.min(input.availableBuyingPower, limits.maxOrderNotional ?? Number.POSITIVE_INFINITY);
  const requestedQuantity = notional / input.price;
  const uncappedQuantity = Math.min(requestedQuantity, cap / input.price, limits.maxQuantity ?? Number.POSITIVE_INFINITY);
  const approvedQuantity = input.quantityStep === undefined ? uncappedQuantity : floorToStep(uncappedQuantity, input.quantityStep);
  const approvedNotional = approvedQuantity * input.price;
  const reasons = approvedQuantity < requestedQuantity ? ["RISK_OR_BUYING_POWER_CAP_APPLIED"] : [];
  return Object.freeze({ model: input.model, requestedQuantity, approvedQuantity, requestedNotional: requestedQuantity * input.price, approvedNotional, capped: reasons.length > 0, reasons: Object.freeze(reasons) });
}

export function buildCapitalSnapshot(input: CapitalSnapshotInput): CapitalSnapshot {
  for (const name of ["cash", "reservedCapital", "marketValue", "peakEquity", "dailyStartEquity", "weeklyStartEquity", "monthlyStartEquity"] as const) finiteNonNegative(input[name], name);
  for (const name of ["realizedPnl", "unrealizedPnl"] as const) if (!Number.isFinite(input[name])) throw new Error(`${name} must be finite`);
  if (input.reservedCapital > input.cash) throw new Error("reservedCapital cannot exceed cash");
  const currentEquity = input.cash + input.marketValue;
  return Object.freeze({ currentEquity, peakEquity: Math.max(input.peakEquity, currentEquity), dailyEquity: currentEquity - input.dailyStartEquity, weeklyEquity: currentEquity - input.weeklyStartEquity, monthlyEquity: currentEquity - input.monthlyStartEquity, availableBuyingPower: input.cash - input.reservedCapital, reservedCapital: input.reservedCapital, realizedPnl: input.realizedPnl, unrealizedPnl: input.unrealizedPnl });
}

export function evaluateCapitalProtection(input: CapitalProtectionInput, limits: CapitalProtectionLimits): CapitalProtectionResult {
  for (const [name, value] of Object.entries(limits)) finiteNonNegative(value as number, name);
  finiteNonNegative(input.consecutiveLosses, "consecutiveLosses");
  ratio(input.riskBudgetUsage, "riskBudgetUsage");
  const reasons: string[] = [];
  const dailyLoss = Math.max(0, -input.snapshot.dailyEquity);
  const weeklyLoss = Math.max(0, -input.snapshot.weeklyEquity);
  const drawdown = input.snapshot.peakEquity === 0 ? 0 : Math.max(0, (input.snapshot.peakEquity - input.snapshot.currentEquity) / input.snapshot.peakEquity);
  if (dailyLoss >= limits.maximumDailyLoss) reasons.push("MAXIMUM_DAILY_LOSS");
  if (weeklyLoss >= limits.maximumWeeklyLoss) reasons.push("MAXIMUM_WEEKLY_LOSS");
  if (drawdown >= limits.maximumDrawdown) reasons.push("MAXIMUM_DRAWDOWN");
  if (input.consecutiveLosses >= limits.maximumConsecutiveLosses) reasons.push("CONSECUTIVE_LOSSES");
  if (input.riskBudgetUsage >= limits.maximumRiskBudgetUsage) reasons.push("RISK_BUDGET_EXHAUSTED");
  if (reasons.length > 0) return Object.freeze({ status: "BLOCK", positionSizeMultiplier: 0, blockNewEntries: true, pauseStrategy: true, requiresAcknowledgement: true, reasons: Object.freeze(reasons) });
  const nearLimit = dailyLoss >= limits.maximumDailyLoss * 0.75 || weeklyLoss >= limits.maximumWeeklyLoss * 0.75 || drawdown >= limits.maximumDrawdown * 0.75 || input.riskBudgetUsage >= limits.maximumRiskBudgetUsage * 0.75;
  return Object.freeze({ status: nearLimit ? "REDUCE" : "NORMAL", positionSizeMultiplier: nearLimit ? 0.5 : 1, blockNewEntries: false, pauseStrategy: false, requiresAcknowledgement: false, reasons: Object.freeze(nearLimit ? ["CAPITAL_PROTECTION_REDUCED_SIZE"] : []) });
}
