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

const TERMINAL = new Set<PaperOrderStatus>(["FILLED", "CANCELLED", "REJECTED"]);

const ALLOWED: Readonly<Record<PaperOrderStatus, readonly PaperOrderStatus[]>> = Object.freeze({
  CREATED: Object.freeze(["ACCEPTED", "REJECTED"]),
  ACCEPTED: Object.freeze(["OPEN", "FILLED", "REJECTED", "CANCELLED"]),
  OPEN: Object.freeze(["PARTIALLY_FILLED", "FILLED", "CANCELLED"]),
  PARTIALLY_FILLED: Object.freeze(["PARTIALLY_FILLED", "FILLED", "CANCELLED"]),
  FILLED: Object.freeze([]),
  CANCELLED: Object.freeze([]),
  REJECTED: Object.freeze([]),
});

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
  if (fillQuantity > current.remainingQuantity) throw new Error("fill quantity exceeds remaining quantity");

  const filledQuantity = current.filledQuantity + fillQuantity;
  const remainingQuantity = current.requestedQuantity - filledQuantity;
  if (nextStatus === "PARTIALLY_FILLED" && remainingQuantity <= 0) throw new Error("partial fill must leave remaining quantity");
  if (nextStatus === "FILLED" && remainingQuantity !== 0) throw new Error("filled transition must consume remaining quantity");

  return Object.freeze({
    ...current,
    status: nextStatus,
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
