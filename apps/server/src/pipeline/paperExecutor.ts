import { PaperBroker, type PaperOrder } from "../../../desktop/src/paperBroker";
import type { OrderPlan } from "./orderPlanner";

/**
 * The "PaperExecutor" pipeline stage: executes an OrderPlan against the PaperBroker,
 * producing a fill (Position/Portfolio update). A thin, explicitly named wrapper -- all
 * fill-model/risk-policy logic remains in PaperBroker itself (apps/desktop/src), not
 * duplicated here.
 */
export class PaperExecutor {
  constructor(private readonly broker: PaperBroker) {}

  execute(plan: OrderPlan, price: number): PaperOrder {
    return this.broker.execute(plan.side, plan.quantity, price);
  }
}
