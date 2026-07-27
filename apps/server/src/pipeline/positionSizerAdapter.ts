import {
  DefaultPositionSizer,
  type PositionSizer as ValuePositionSizer,
  type SizingContext,
  type SizingPolicy
} from "../../../../packages/core/src/position/positionSizer";
import type { OrderPlan, OrderPlanner, OrderPlanningContext } from "./orderPlanner";
import type { TradingIntent } from "./tradingIntent";

/**
 * Adapts packages/core/src/position/positionSizer.ts's PositionSizer (E02-T004) to this
 * pipeline's own OrderPlanner shape (apps/server/src/pipeline/orderPlanner.ts), so the
 * "TradingIntent -> PositionSizer -> RiskEngine -> OrderPlanner -> PaperExecutor" diagram's
 * PositionSizer stage is the real domain module, not a re-implementation. automaticTradingPipeline.ts
 * itself needed no changes: PositionSizerOrderPlanner is a drop-in OrderPlanner it can be
 * constructed with instead of apps/server/src/pipeline/orderPlanner.ts's own OrderPlanner.
 *
 * Still applies the one adjustment PositionSizer deliberately leaves out: capping a SELL's
 * quantity to the currently-held position (PaperBroker would reject the excess anyway, but
 * capping here avoids relying on that as the only guard, matching this pipeline's prior
 * OrderPlanner behavior exactly).
 */
export class PositionSizerOrderPlanner implements OrderPlanner {
  constructor(
    private readonly policyFor: (context: OrderPlanningContext) => SizingPolicy,
    private readonly sizer: ValuePositionSizer = new DefaultPositionSizer()
  ) {}

  plan(intent: TradingIntent, context: OrderPlanningContext): OrderPlan | null {
    if (intent.type === "HOLD") return null;
    const sizingContext: SizingContext = { equity: context.equity, marketPrice: context.price };
    const result = this.sizer.size({ side: intent.type }, sizingContext, this.policyFor(context));
    if (result.status !== "SIZED") return null;
    const quantity = intent.type === "SELL" ? Math.min(context.positionQuantity, result.intent.quantity ?? 0) : result.intent.quantity;
    if (quantity === undefined || quantity <= 0) return null;
    return { side: intent.type, quantity };
  }
}
