export type PaperOrderStatus =
  | "CREATED"
  | "ACCEPTED"
  | "OPEN"
  | "PARTIALLY_FILLED"
  | "FILLED"
  | "CANCELLED"
  | "REJECTED";

export interface PaperOrderLifecycleState {
  readonly status: PaperOrderStatus;
  readonly requestedQuantity: number;
  readonly filledQuantity: number;
  readonly remainingQuantity: number;
  readonly transitionSequence: number;
  readonly lastTransitionAt: number;
}

/**
 * The execution loop decides "this fill finishes the order" when the fill is within 1e-8 of the remaining quantity, but float
 * subtraction can leave a last-digit remainder (owner screen 2026-10-05: a SELL refused with "filled transition must consume
 * remaining quantity"). A fill that finishes the order within this tolerance is settled as exactly filled. Anything larger is
 * still refused, and partial fills are unchanged. Owner approved in chat.
 */
export const PAPER_FILL_REMAINDER_TOLERANCE = 1e-8;

const TERMINAL = new Set<PaperOrderStatus>(["FILLED", "CANCELLED", "REJECTED"]);

const ALLOWED: Readonly<Record<PaperOrderStatus, readonly PaperOrderStatus[]>> = {
  CREATED: ["ACCEPTED", "REJECTED"],
  ACCEPTED: ["OPEN", "FILLED", "REJECTED", "CANCELLED"],
  OPEN: ["PARTIALLY_FILLED", "FILLED", "CANCELLED"],
  PARTIALLY_FILLED: ["PARTIALLY_FILLED", "FILLED", "CANCELLED"],
  FILLED: [],
  CANCELLED: [],
  REJECTED: [],
};

function assertQuantity(value: number, name: string): void {
  if (!Number.isFinite(value) || value < 0) throw new Error(`${name} must be finite and non-negative`);
}

export function createPaperOrderLifecycle(requestedQuantity: number, createdAt: number): PaperOrderLifecycleState {
  if (!Number.isFinite(requestedQuantity) || requestedQuantity <= 0) throw new Error("requestedQuantity must be positive");
  if (!Number.isSafeInteger(createdAt) || createdAt < 0) throw new Error("createdAt is invalid");
  return Object.freeze({
    status: "CREATED",
    requestedQuantity,
    filledQuantity: 0,
    remainingQuantity: requestedQuantity,
    transitionSequence: 0,
    lastTransitionAt: createdAt,
  });
}

export function transitionPaperOrderLifecycle(
  current: PaperOrderLifecycleState,
  nextStatus: PaperOrderStatus,
  at: number,
  fillQuantity = 0,
): PaperOrderLifecycleState {
  if (!Number.isSafeInteger(at) || at < current.lastTransitionAt) throw new Error("paper order transition time is invalid");
  if (TERMINAL.has(current.status)) throw new Error(`paper order terminal state cannot transition: ${current.status}`);
  if (!ALLOWED[current.status].includes(nextStatus)) throw new Error(`invalid paper order transition: ${current.status}->${nextStatus}`);
  assertQuantity(fillQuantity, "fillQuantity");

  const isFillTransition = nextStatus === "PARTIALLY_FILLED" || nextStatus === "FILLED";
  if (!isFillTransition && fillQuantity !== 0) throw new Error("non-fill transition cannot carry fill quantity");
  if (isFillTransition && fillQuantity <= 0) throw new Error("fill transition requires positive fill quantity");
  const overshoot = fillQuantity - current.remainingQuantity;
  const settlesOrder = nextStatus === "FILLED" && Math.abs(overshoot) <= PAPER_FILL_REMAINDER_TOLERANCE;
  if (overshoot > 0 && !settlesOrder) throw new Error("fill quantity exceeds remaining quantity");

  // The saved order record carries the real total of its fills, and saving requires the lifecycle to match it exactly, so a
  // settling fill closes the order at what was actually filled (rounded like the record) instead of at the requested size.
  const filledQuantity = settlesOrder ? Math.round((current.filledQuantity + fillQuantity) * 1e8) / 1e8 : current.filledQuantity + fillQuantity;
  const requestedQuantity = settlesOrder ? filledQuantity : current.requestedQuantity;
  const remainingQuantity = settlesOrder ? 0 : requestedQuantity - filledQuantity;
  if (nextStatus === "PARTIALLY_FILLED" && remainingQuantity <= 0) throw new Error("partial fill must leave remaining quantity");
  if (nextStatus === "FILLED" && remainingQuantity !== 0) throw new Error("filled transition must consume remaining quantity");

  return Object.freeze({
    ...current,
    status: nextStatus,
    requestedQuantity,
    filledQuantity,
    remainingQuantity,
    transitionSequence: current.transitionSequence + 1,
    lastTransitionAt: at,
  });
}

export function validatePaperOrderLifecycle(state: PaperOrderLifecycleState): PaperOrderLifecycleState {
  if (!Number.isFinite(state.requestedQuantity) || state.requestedQuantity <= 0) throw new Error("paper order requested quantity is invalid");
  assertQuantity(state.filledQuantity, "filledQuantity");
  assertQuantity(state.remainingQuantity, "remainingQuantity");
  if (Math.abs(state.requestedQuantity - state.filledQuantity - state.remainingQuantity) > Number.EPSILON) throw new Error("paper order quantity reconciliation mismatch");
  if (!Number.isSafeInteger(state.transitionSequence) || state.transitionSequence < 0) throw new Error("paper order transition sequence is invalid");
  if (!Number.isSafeInteger(state.lastTransitionAt) || state.lastTransitionAt < 0) throw new Error("paper order transition time is invalid");
  if (state.status === "FILLED" && state.remainingQuantity !== 0) throw new Error("filled paper order has remaining quantity");
  if ((state.status === "CREATED" || state.status === "ACCEPTED" || state.status === "OPEN") && state.filledQuantity !== 0) throw new Error("unfilled paper order carries fill quantity");
  if (state.status === "PARTIALLY_FILLED" && (state.filledQuantity <= 0 || state.remainingQuantity <= 0)) throw new Error("partial paper order quantity is invalid");
  return state;
}
