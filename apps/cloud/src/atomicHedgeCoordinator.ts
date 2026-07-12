export type HedgeState = "PLANNED" | "SUBMITTING" | "PARTIALLY_HEDGED" | "HEDGED" | "REBALANCING" | "EXITING" | "CLOSED" | "FAULTED";
export type HedgeLeg = "SPOT" | "PERPETUAL";

export interface HedgeOrderRequest {
  readonly clientOrderId: string;
  readonly symbol: string;
  readonly side: "BUY" | "SELL";
  readonly quantity: number;
}

export interface HedgeOrderReceipt {
  readonly clientOrderId: string;
  readonly accepted: boolean;
  readonly exchangeOrderId?: string;
}

export interface HedgeFill {
  readonly filledQuantity: number;
  readonly averagePrice: number;
  readonly remainingQuantity: number;
  readonly updatedAt: number;
}

export interface HedgeAuditEvent {
  readonly type: "HEDGE_PLANNED" | "ORDERS_SUBMITTED" | "FILL_UPDATED" | "CANCEL_REMAINING" | "COMPENSATE" | "ROLLBACK" | "KILL_SWITCH_RECOMMENDED" | "FAULTED";
  readonly at: number;
  readonly reason: string;
}

export interface HedgePlan {
  readonly id: string;
  readonly mode: "PAPER" | "DRY_RUN";
  readonly spotOrder: HedgeOrderRequest;
  readonly perpetualOrder: HedgeOrderRequest;
  readonly contractMultiplier: number;
  readonly deltaTolerance: number;
  readonly createdAt: number;
}

export interface HedgeCoordinatorState {
  readonly plan: HedgePlan;
  readonly status: HedgeState;
  readonly spotFill: HedgeFill;
  readonly perpetualFill: HedgeFill;
  readonly actualDelta: number;
  readonly audit: readonly HedgeAuditEvent[];
}

export interface HedgeExchangeAdapter {
  submit(order: HedgeOrderRequest): Promise<HedgeOrderReceipt>;
  cancel(clientOrderId: string): Promise<boolean>;
}

export interface PartialHedgeRecovery {
  readonly now: number;
  readonly cancellationSucceeded: boolean;
  readonly compensationSucceeded: boolean;
  readonly rollbackSucceeded: boolean;
}

const number = (value: number, field: string, minimum = 0): void => {
  if (!Number.isFinite(value) || value < minimum) throw new Error(`${field} is invalid`);
};
const time = (value: number, field: string): void => {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${field} is invalid`);
};
const text = (value: string, field: string): string => {
  const result = value.trim();
  if (!result) throw new Error(`${field} is required`);
  return result;
};
const round8 = (value: number): number => Math.round(value * 100_000_000) / 100_000_000;
const emptyFill = (at: number): HedgeFill => Object.freeze({ filledQuantity: 0, averagePrice: 0, remainingQuantity: 0, updatedAt: at });
const event = (type: HedgeAuditEvent["type"], at: number, reason: string): HedgeAuditEvent => Object.freeze({ type, at, reason });

const freezePlan = (plan: HedgePlan): HedgePlan => Object.freeze({
  ...plan,
  spotOrder: Object.freeze({ ...plan.spotOrder }),
  perpetualOrder: Object.freeze({ ...plan.perpetualOrder })
});

const freezeState = (state: HedgeCoordinatorState): HedgeCoordinatorState => Object.freeze({
  ...state,
  plan: freezePlan(state.plan),
  spotFill: Object.freeze({ ...state.spotFill }),
  perpetualFill: Object.freeze({ ...state.perpetualFill }),
  audit: Object.freeze([...state.audit])
});

export function planAtomicHedge(plan: HedgePlan): HedgeCoordinatorState {
  const id = text(plan.id, "plan.id");
  if (plan.mode !== "PAPER" && plan.mode !== "DRY_RUN") throw new Error("only PAPER or DRY_RUN hedge plans are allowed");
  time(plan.createdAt, "plan.createdAt");
  number(plan.contractMultiplier, "plan.contractMultiplier", Number.EPSILON);
  number(plan.deltaTolerance, "plan.deltaTolerance");
  for (const order of [plan.spotOrder, plan.perpetualOrder]) {
    text(order.clientOrderId, "order.clientOrderId");
    text(order.symbol, "order.symbol");
    number(order.quantity, "order.quantity", Number.EPSILON);
  }
  if (plan.spotOrder.clientOrderId === plan.perpetualOrder.clientOrderId) throw new Error("hedge legs require different clientOrderIds");
  const normalized = freezePlan({ ...plan, id });
  return freezeState({
    plan: normalized,
    status: "PLANNED",
    spotFill: emptyFill(plan.createdAt),
    perpetualFill: emptyFill(plan.createdAt),
    actualDelta: 0,
    audit: [event("HEDGE_PLANNED", plan.createdAt, "PAPER_OR_DRY_RUN_ONLY")]
  });
}

export async function submitAtomicHedge(
  state: HedgeCoordinatorState,
  adapter: HedgeExchangeAdapter,
  now: number
): Promise<Readonly<{ state: HedgeCoordinatorState; receipts: readonly HedgeOrderReceipt[] }>> {
  time(now, "now");
  if (state.status !== "PLANNED") throw new Error("only planned hedges can be submitted");
  const [spot, perpetual] = await Promise.all([adapter.submit(state.plan.spotOrder), adapter.submit(state.plan.perpetualOrder)]);
  const receipts = Object.freeze([Object.freeze({ ...spot }), Object.freeze({ ...perpetual })]);
  const accepted = spot.accepted && perpetual.accepted;
  const next = freezeState({
    ...state,
    status: accepted ? "SUBMITTING" : "FAULTED",
    audit: [...state.audit, event("ORDERS_SUBMITTED", now, accepted ? "ORDER_ACCEPTANCE_CONFIRMED_AWAITING_FILLS" : "ORDER_ACCEPTANCE_FAILED"), ...(accepted ? [] : [event("FAULTED", now, "ORDER_ACCEPTANCE_FAILED")])]
  });
  return Object.freeze({ state: next, receipts });
}

const validateFill = (fill: HedgeFill, now: number): HedgeFill => {
  number(fill.filledQuantity, "filledQuantity");
  number(fill.averagePrice, "averagePrice");
  number(fill.remainingQuantity, "remainingQuantity");
  time(fill.updatedAt, "updatedAt");
  if (fill.updatedAt > now || (fill.filledQuantity > 0 && fill.averagePrice <= 0)) throw new Error("fill is invalid");
  return Object.freeze({ ...fill });
};

export function applyHedgeFills(state: HedgeCoordinatorState, spotFill: HedgeFill, perpetualFill: HedgeFill, now: number): HedgeCoordinatorState {
  time(now, "now");
  if (state.status !== "SUBMITTING" && state.status !== "PARTIALLY_HEDGED" && state.status !== "REBALANCING") throw new Error("fills are not accepted in the current hedge state");
  const spot = validateFill(spotFill, now);
  const perpetual = validateFill(perpetualFill, now);
  const actualDelta = round8(spot.filledQuantity - perpetual.filledQuantity * state.plan.contractMultiplier);
  const fullyFilled = spot.remainingQuantity === 0 && perpetual.remainingQuantity === 0 && spot.filledQuantity >= state.plan.spotOrder.quantity && perpetual.filledQuantity >= state.plan.perpetualOrder.quantity;
  const status: HedgeState = fullyFilled && Math.abs(actualDelta) <= state.plan.deltaTolerance ? "HEDGED" : "PARTIALLY_HEDGED";
  return freezeState({
    ...state,
    status,
    spotFill: spot,
    perpetualFill: perpetual,
    actualDelta,
    audit: [...state.audit, event("FILL_UPDATED", now, status === "HEDGED" ? "ACTUAL_FILLS_DELTA_NEUTRAL" : "ACTUAL_FILLS_REQUIRE_RECOVERY")]
  });
}

export function recoverPartialHedge(state: HedgeCoordinatorState, recovery: PartialHedgeRecovery): HedgeCoordinatorState {
  time(recovery.now, "recovery.now");
  if (state.status !== "PARTIALLY_HEDGED") throw new Error("only partially hedged state can recover");
  const audit: HedgeAuditEvent[] = [...state.audit, event("CANCEL_REMAINING", recovery.now, recovery.cancellationSucceeded ? "REMAINING_ORDERS_CANCELLED" : "CANCELLATION_FAILED")];
  if (recovery.cancellationSucceeded && recovery.compensationSucceeded) {
    audit.push(event("COMPENSATE", recovery.now, "COMPENSATION_ORDER_FILLED"));
    return freezeState({ ...state, status: "REBALANCING", audit });
  }
  audit.push(event("ROLLBACK", recovery.now, recovery.rollbackSucceeded ? "FILLED_LEG_REDUCED" : "ROLLBACK_FAILED"));
  if (recovery.rollbackSucceeded) return freezeState({ ...state, status: "EXITING", audit });
  audit.push(event("KILL_SWITCH_RECOMMENDED", recovery.now, "UNHEDGED_EXPOSURE_UNRESOLVED"), event("FAULTED", recovery.now, "RECOVERY_FAILED"));
  return freezeState({ ...state, status: "FAULTED", audit });
}
