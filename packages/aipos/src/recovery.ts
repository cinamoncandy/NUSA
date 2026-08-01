import { AiposStore } from "./store";
import { RecoverySnapshot, WorkOrder } from "./types";
import { AiposValidator } from "./validator";

const statusRank: Readonly<Record<WorkOrder["status"], number>> = {
  in_progress: 0,
  pending: 1,
  blocked: 2,
  completed: 3,
  cancelled: 4,
};

export class RecoveryEngine {
  constructor(
    private readonly store: AiposStore,
    private readonly validator = new AiposValidator(),
  ) {}

  async recover(now = new Date()): Promise<RecoverySnapshot> {
    const [state, workOrders, decisions] = await Promise.all([
      this.store.loadState(),
      this.store.listWorkOrders(),
      this.store.listDecisions(),
    ]);

    const report = this.validator.combine(
      this.validator.validateState(state),
      this.validator.validateWorkOrders(workOrders),
      this.validator.validateDecisions(decisions),
    );

    if (!report.valid) {
      const details = report.issues
        .filter((issue) => issue.severity === "error")
        .map((issue) => `${issue.code}: ${issue.message}`)
        .join("; ");
      throw new Error(`AIPOS recovery rejected invalid repository state: ${details}`);
    }

    return {
      state,
      selectedWorkOrder: this.selectWorkOrder(state.activeWorkOrderId, workOrders),
      decisions: decisions.filter((decision) => decision.status === "accepted"),
      generatedAt: now.toISOString(),
    };
  }

  private selectWorkOrder(
    activeWorkOrderId: string | undefined,
    workOrders: readonly WorkOrder[],
  ): WorkOrder | undefined {
    if (activeWorkOrderId) {
      const active = workOrders.find((workOrder) => workOrder.id === activeWorkOrderId);
      if (!active) throw new Error(`Active work order not found: ${activeWorkOrderId}`);
      if (active.status === "completed" || active.status === "cancelled") {
        throw new Error(`Active work order is not actionable: ${activeWorkOrderId}`);
      }
      return active;
    }

    const completed = new Set(
      workOrders
        .filter((workOrder) => workOrder.status === "completed")
        .map((workOrder) => workOrder.id),
    );

    return [...workOrders]
      .filter((workOrder) => workOrder.status === "pending" || workOrder.status === "in_progress")
      .filter((workOrder) => (workOrder.dependencies ?? []).every((dependency) => completed.has(dependency)))
      .sort((left, right) => {
        const rank = statusRank[left.status] - statusRank[right.status];
        return rank !== 0 ? rank : left.id.localeCompare(right.id);
      })[0];
  }
}
