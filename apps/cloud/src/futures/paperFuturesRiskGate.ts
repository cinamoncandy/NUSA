import { PAPER_FUTURES_OWNER_LIMITS, type PaperFuturesAccount, type PaperFuturesCostProfile, type PaperFuturesOrderIntent, type PaperFuturesRiskLimits } from "../../../../packages/contracts/src/paperFutures";
import { paperTradingDayKey } from "../paperTradingDay";
import { PAPER_FUTURES_QUANTITY_EPS, adverseFillPrice, liquidationPriceFromMargin } from "./paperFuturesSimulator";

/**
 * Futures-only PAPER risk gate (design v1 §3, B3). Independent from the Upbit spot gateway: it reads only the futures
 * account. Reduce-only orders that shrink exposure are always allowed (they lower risk); every order that adds exposure
 * must pass every check. Limits may only be tightened relative to the owner-accepted values.
 *
 * Notes: at the owner's 2x cap a fresh position's liquidation sits about 50% away, so the 25% distance floor is a
 * backstop that bites only after funding has eaten margin (it is checked on the RESULTING position). The daily-loss
 * check counts realized P&L (closes, liquidations, open fees, funding), not open drawdown. The losing streak counts
 * each losing close, so one trade closed in several losing slices counts more than once (errs on the safe side).
 */
export type PaperFuturesRiskDecision = Readonly<{ status: "ALLOW" | "REJECT"; reasonCodes: readonly string[] }>;

export function assertLimitsNotLoosened(limits: PaperFuturesRiskLimits, owner: PaperFuturesRiskLimits = PAPER_FUTURES_OWNER_LIMITS): void {
  if (limits.maxLeverage > owner.maxLeverage
    || limits.minLiquidationDistanceRatio < owner.minLiquidationDistanceRatio
    || limits.maxConsecutiveLosses > owner.maxConsecutiveLosses
    || limits.maxDailyLossRatio > owner.maxDailyLossRatio
    || limits.maxPositionMarginRatio > owner.maxPositionMarginRatio) {
    throw new Error("PAPER_FUTURES_RISK_LIMITS_LOOSENED");
  }
}

/** Today's (Asia/Seoul) losing streak and realized P&L from closes and liquidations; funding counts toward P&L only. */
export function futuresDailyLossState(account: PaperFuturesAccount, now: number): Readonly<{ consecutiveLosses: number; realizedPnl: number }> {
  const today = paperTradingDayKey(now);
  const todays = account.ledger.filter((e) => paperTradingDayKey(e.at) === today).sort((a, b) => a.at - b.at);
  const realizedPnl = todays.reduce((sum, e) => sum + (e.kind === "OPEN" ? -e.fee : e.realizedPnl), 0);
  const closes = todays.filter((e) => e.kind === "CLOSE" || e.kind === "LIQUIDATION");
  let consecutiveLosses = 0;
  for (let i = closes.length - 1; i >= 0 && closes[i]!.realizedPnl < 0; i -= 1) consecutiveLosses += 1;
  return Object.freeze({ consecutiveLosses, realizedPnl });
}

export function evaluatePaperFuturesOrder(input: Readonly<{
  account: PaperFuturesAccount;
  intent: PaperFuturesOrderIntent;
  markPrice: number;
  markObservedAt: number;
  now: number;
  maxMarkAgeMs: number;
  startOfDayEquity: number;
  costs: PaperFuturesCostProfile;
  limits?: PaperFuturesRiskLimits;
}>): PaperFuturesRiskDecision {
  const limits = input.limits ?? PAPER_FUTURES_OWNER_LIMITS;
  assertLimitsNotLoosened(limits);
  const reasons: string[] = [];
  const { account, intent } = input;
  if (!(input.markPrice > 0) || !Number.isFinite(input.markPrice) || input.markObservedAt > input.now || input.now - input.markObservedAt > input.maxMarkAgeMs) {
    return Object.freeze({ status: "REJECT", reasonCodes: Object.freeze(["PAPER_FUTURES_MARK_PRICE_STALE"]) });
  }
  if (!(typeof intent.quantity === "number" && Number.isFinite(intent.quantity) && intent.quantity > 0)) {
    return Object.freeze({ status: "REJECT", reasonCodes: Object.freeze(["PAPER_FUTURES_QUANTITY_INVALID"]) });
  }
  const current = account.positions.find((p) => p.symbol === intent.symbol);
  if (current != null && current.side !== intent.side && intent.quantity > current.quantity + PAPER_FUTURES_QUANTITY_EPS) {
    return Object.freeze({ status: "REJECT", reasonCodes: Object.freeze(["PAPER_FUTURES_FLIP_NOT_ALLOWED"]) });
  }
  const reducesExposure = current != null && current.side !== intent.side;
  if (reducesExposure) return Object.freeze({ status: "ALLOW", reasonCodes: Object.freeze([]) });
  if (intent.reduceOnly) return Object.freeze({ status: "REJECT", reasonCodes: Object.freeze(["PAPER_FUTURES_REDUCE_ONLY_WOULD_INCREASE"]) });

  if (intent.marginMode !== "ISOLATED") reasons.push("PAPER_FUTURES_MARGIN_MODE_NOT_ALLOWED");
  if (!(intent.leverage >= 1 && intent.leverage <= limits.maxLeverage)) reasons.push("PAPER_FUTURES_LEVERAGE_ABOVE_LIMIT");
  const leverage = Math.max(1, intent.leverage);
  const fill = adverseFillPrice(input.markPrice, intent.side, true, input.costs.slippageBps);
  const newMargin = (intent.quantity * fill) / leverage + (current?.isolatedMargin ?? 0);
  const newQuantity = intent.quantity + (current?.quantity ?? 0);
  const newEntry = current == null ? fill : (current.entryPrice * current.quantity + fill * intent.quantity) / newQuantity;
  const liq = liquidationPriceFromMargin(intent.side, newEntry, newQuantity, newMargin, input.costs.maintenanceMarginRate);
  if (Math.abs(input.markPrice - liq) / input.markPrice < limits.minLiquidationDistanceRatio) reasons.push("PAPER_FUTURES_LIQUIDATION_TOO_CLOSE");
  if (!(input.startOfDayEquity > 0) || newMargin > input.startOfDayEquity * limits.maxPositionMarginRatio) reasons.push("PAPER_FUTURES_POSITION_MARGIN_ABOVE_LIMIT");
  const loss = futuresDailyLossState(account, input.now);
  if (loss.consecutiveLosses >= limits.maxConsecutiveLosses) reasons.push("PAPER_FUTURES_CONSECUTIVE_LOSS_LIMIT");
  if (loss.realizedPnl <= -input.startOfDayEquity * limits.maxDailyLossRatio) reasons.push("PAPER_FUTURES_DAILY_LOSS_LIMIT");
  return Object.freeze({ status: reasons.length === 0 ? "ALLOW" : "REJECT", reasonCodes: Object.freeze(reasons) });
}
