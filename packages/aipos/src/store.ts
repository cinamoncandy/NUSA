import { AiposState, DecisionRecord, WorkOrder } from "./types";

export interface AiposStore {
  loadState(): Promise<AiposState>;
  saveState(state: AiposState): Promise<void>;
  listWorkOrders(): Promise<readonly WorkOrder[]>;
  saveWorkOrder(workOrder: WorkOrder): Promise<void>;
  listDecisions(): Promise<readonly DecisionRecord[]>;
  saveDecision(decision: DecisionRecord): Promise<void>;
}

export class InMemoryAiposStore implements AiposStore {
  private state: AiposState;
  private readonly workOrders = new Map<string, WorkOrder>();
  private readonly decisions = new Map<string, DecisionRecord>();

  constructor(initialState: AiposState) {
    this.state = initialState;
  }

  async loadState(): Promise<AiposState> {
    return this.state;
  }

  async saveState(state: AiposState): Promise<void> {
    this.state = state;
  }

  async listWorkOrders(): Promise<readonly WorkOrder[]> {
    return [...this.workOrders.values()];
  }

  async saveWorkOrder(workOrder: WorkOrder): Promise<void> {
    this.workOrders.set(workOrder.id, workOrder);
  }

  async listDecisions(): Promise<readonly DecisionRecord[]> {
    return [...this.decisions.values()];
  }

  async saveDecision(decision: DecisionRecord): Promise<void> {
    this.decisions.set(decision.id, decision);
  }
}
