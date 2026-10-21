import { PAPER_FUTURES_OWNER_LIMITS } from "../../../packages/contracts/src/paperFutures";
import type { FuturesLimits } from "./futuresScreenModel";

/** Mobile-local adapter: the futures tab's limits come from the futures gate's single source of limits. */
export const FUTURES_SCREEN_LIMITS: FuturesLimits = Object.freeze({
  maxDailyLossRatio: PAPER_FUTURES_OWNER_LIMITS.maxDailyLossRatio,
  minLiquidationDistanceRatio: PAPER_FUTURES_OWNER_LIMITS.minLiquidationDistanceRatio,
  maxConsecutiveLosses: PAPER_FUTURES_OWNER_LIMITS.maxConsecutiveLosses,
});
