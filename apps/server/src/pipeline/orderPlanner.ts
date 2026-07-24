import { calculateFixedFractionalQuantity } from "../../../desktop/src/positionSizing";
import type { PaperSide } from "../../../desktop/src/paperBroker";
import type { TradingIntent } from "./tradingIntent";

export interface OrderPlanningContext {
  readonly equity: number;
  readonly price: number;
  readonly positionQuantity: number;
  /** Operator-configured order size (ControlPlane.getOrderQuantity()). Used as-is in "FIXED" mode. */
  readonly fixedOrderQuantity: number;
  readonly quantityStep?: number;
}

export interface OrderPlan {
  readonly side: PaperSide;
  readonly quantity: number;
}

export type SizingMode = "FIXED" | "FIXED_FRACTIONAL";

/**
 * The "OrderPlanner" pipeline stage's shape: turns an already risk-approved TradingIntent
 * into a concrete OrderPlan (side + quantity) or null. A plain interface (not the
 * FixedOrderPlanner class below) so AutomaticTradingPipeline can be constructed with any
 * implementation -- e.g. apps/server/src/pipeline/positionSizerAdapter.ts's
 * PositionSizerOrderPlanner, which wraps packages/core/src/position/positionSizer.ts's
 * PositionSizer (E02-T004) instead of this file's own sizing math.
 */
export interface OrderPlanner {
  plan(intent: TradingIntent, context: OrderPlanningContext): OrderPlan | null;
}

/**
 * PaperBroker and PaperBroker's own risk-policy checks
 * (maxOrderNotional/maxPositionQuantity/maxRealizedLoss/minOrderNotional/priceTick)
 * remain the final say on whether a plan is actually admissible once fill price/cost are
 * known -- this stage only decides the requested quantity.
 *
 * Default mode ("FIXED") reproduces the exact quantity behavior this app already had
 * (ControlPlane's static, operator-set order quantity), so introducing this class does
 * not, by itself, change what automatic trades request. "FIXED_FRACTIONAL" is an explicit
 * opt-in wiring apps/desktop/src/positionSizing.ts's calculateFixedFractionalQuantity --
 * previously left unwired everywhere because doing so silently would have been a real
 * change to automatic-trading behavior deserving its own explicit, reviewable place; this
 * pipeline stage is exactly that place, and it remains off unless explicitly selected.
 */
export class FixedOrderPlanner implements OrderPlanner {
  constructor(
    private readonly sizingMode: SizingMode = "FIXED",
    private readonly riskFraction?: number
  ) {
    if (sizingMode === "FIXED_FRACTIONAL" && (riskFraction === undefined || !Number.isFinite(riskFraction) || riskFraction <= 0 || riskFraction > 1)) {
      throw new Error("riskFraction must be in (0, 1] when sizingMode is FIXED_FRACTIONAL");
    }
  }

  plan(intent: TradingIntent, context: OrderPlanningContext): OrderPlan | null {
    if (intent.type === "HOLD") return null;
    const requested = this.sizingMode === "FIXED_FRACTIONAL"
      ? calculateFixedFractionalQuantity({
        equity: context.equity,
        price: context.price,
        riskFraction: this.riskFraction!,
        ...(context.quantityStep === undefined ? {} : { quantityStep: context.quantityStep })
      })
      : context.fixedOrderQuantity;
    if (requested <= 0) return null;
    const quantity = intent.type === "SELL" ? Math.min(context.positionQuantity, requested) : requested;
    if (quantity <= 0) return null;
    return { side: intent.type, quantity };
  }
}
