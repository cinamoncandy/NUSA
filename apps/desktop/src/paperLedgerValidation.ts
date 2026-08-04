import type { PaperBrokerState, PaperLedgerEntry, PaperOrder } from "./paperBroker";
import { replayPaperLedger } from "./paperSafetyGates";

export const PAPER_LEDGER_VALIDATION_REASON_CODES = [
  "INVALID_SEQUENCE",
  "DUPLICATE_SEQUENCE",
  "INVALID_ORDER_REFERENCE",
  "NEGATIVE_CASH",
  "NEGATIVE_POSITION",
  "INVALID_AVERAGE_PRICE",
  "TIMESTAMP_REGRESSION",
  "PROJECTION_MISMATCH",
  "LEDGER_TRANSITION_MISMATCH",
  "SELL_EXCEEDS_POSITION"
] as const;

export type PaperLedgerValidationReasonCode = typeof PAPER_LEDGER_VALIDATION_REASON_CODES[number];
export type PaperLedgerValidationResult =
  | Readonly<{ status: "VALID"; reasonCodes: readonly [] }>
  | Readonly<{ status: "INVALID"; reasonCodes: readonly PaperLedgerValidationReasonCode[] }>;
export type PaperLedgerRecoverySource = "SQLITE" | "LEGACY";

const EPSILON = 1e-8;
const VALID_RESULT: PaperLedgerValidationResult = Object.freeze({ status: "VALID" as const, reasonCodes: Object.freeze([] as []) });

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function equal(left: number, right: number): boolean {
  return Math.abs(left - right) <= EPSILON;
}

function matchingOrder(entry: PaperLedgerEntry, order: PaperOrder | undefined): boolean {
  return order !== undefined &&
    order.market === entry.market &&
    order.side === entry.side &&
    equal(order.quantity, entry.quantity) &&
    equal(order.price, entry.price) &&
    equal(order.fee, entry.fee) &&
    order.filledAt === entry.occurredAt;
}

function addReplayFailure(reasonCodes: Set<PaperLedgerValidationReasonCode>, error: unknown): void {
  const message = error instanceof Error ? error.message : "";
  if (message.includes("sell exceeds position")) reasonCodes.add("SELL_EXCEEDS_POSITION");
  else if (message.includes("sequence mismatch")) {
    if (!reasonCodes.has("DUPLICATE_SEQUENCE")) reasonCodes.add("INVALID_SEQUENCE");
  } else {
    reasonCodes.add("LEDGER_TRANSITION_MISMATCH");
  }
}

/**
 * Validates a persisted Ledger before it is imported or projected into a PaperBroker.
 * States from before Ledger persistence remain compatible when `ledger` is absent.
 */
export function validatePaperLedgerRecovery(state: PaperBrokerState, initialCash: number): PaperLedgerValidationResult {
  if (state.ledger === undefined) return VALID_RESULT;

  const reasonCodes = new Set<PaperLedgerValidationReasonCode>();
  const ledger = state.ledger as unknown;
  const orders = state.orders as unknown;
  if (!Array.isArray(ledger) || !Array.isArray(orders)) {
    return Object.freeze({ status: "INVALID" as const, reasonCodes: Object.freeze(["LEDGER_TRANSITION_MISMATCH"] as const) });
  }

  const ordersById = new Map<string, PaperOrder>();
  for (const order of orders) {
    if (!isRecord(order) || typeof order.id !== "string" || order.id.length === 0 || ordersById.has(order.id)) {
      reasonCodes.add("INVALID_ORDER_REFERENCE");
      continue;
    }
    ordersById.set(order.id, order as unknown as PaperOrder);
  }
  if (ledger.length !== orders.length) reasonCodes.add("INVALID_ORDER_REFERENCE");

  let previousTimestamp = -Infinity;
  const sequences = new Set<number>();
  const fillIds = new Set<string>();
  const orderIds = new Set<string>();
  for (let index = 0; index < ledger.length; index += 1) {
    const entry = ledger[index];
    if (!isRecord(entry)) {
      reasonCodes.add("LEDGER_TRANSITION_MISMATCH");
      continue;
    }
    const sequence = entry.sequence;
    if (typeof sequence !== "number" || !Number.isSafeInteger(sequence)) reasonCodes.add("INVALID_SEQUENCE");
    else if (sequences.has(sequence)) reasonCodes.add("DUPLICATE_SEQUENCE");
    else if (sequence !== index + 1) reasonCodes.add("INVALID_SEQUENCE");
    else sequences.add(sequence);

    const orderId = entry.orderId;
    const fillId = entry.fillId;
    if (typeof orderId !== "string" || orderId.length === 0 || orderIds.has(orderId) || !matchingOrder(entry as unknown as PaperLedgerEntry, ordersById.get(orderId))) {
      reasonCodes.add("INVALID_ORDER_REFERENCE");
    } else orderIds.add(orderId);
    if (typeof fillId !== "string" || fillId.length === 0 || fillIds.has(fillId)) reasonCodes.add("LEDGER_TRANSITION_MISMATCH");
    else fillIds.add(fillId);

    const timestamp = typeof entry.occurredAt === "string" ? Date.parse(entry.occurredAt) : Number.NaN;
    if (!Number.isFinite(timestamp) || timestamp < previousTimestamp) reasonCodes.add("TIMESTAMP_REGRESSION");
    else previousTimestamp = timestamp;

    for (const field of [entry.cashBefore, entry.cashAfter]) {
      if (!finite(field) || field < 0) reasonCodes.add("NEGATIVE_CASH");
    }
    for (const field of [entry.positionQuantityBefore, entry.positionQuantityAfter]) {
      if (!finite(field) || field < 0) reasonCodes.add("NEGATIVE_POSITION");
    }
  }

  if (ledger.length === 0) {
    const position = state.position as unknown;
    if (!isRecord(position) || !finite(state.cash) || !finite(position.quantity) || !finite(position.averagePrice) || !finite(position.realizedPnl)) {
      reasonCodes.add("PROJECTION_MISMATCH");
    } else {
      if (state.cash < 0) reasonCodes.add("NEGATIVE_CASH");
      if (position.quantity < 0) reasonCodes.add("NEGATIVE_POSITION");
      if (position.averagePrice < 0 || (position.quantity === 0 && position.averagePrice !== 0) || (position.quantity > 0 && position.averagePrice <= 0)) {
        reasonCodes.add("INVALID_AVERAGE_PRICE");
      }
    }
    if (reasonCodes.size === 0) return VALID_RESULT;
    return Object.freeze({ status: "INVALID" as const, reasonCodes: Object.freeze([...reasonCodes].sort()) });
  }

  let replay: ReturnType<typeof replayPaperLedger> | undefined;
  try {
    replay = replayPaperLedger(ledger as PaperLedgerEntry[], initialCash, 1);
  } catch (error) {
    addReplayFailure(reasonCodes, error);
  }
  if (replay) {
    if (replay.cash < 0) reasonCodes.add("NEGATIVE_CASH");
    if (replay.quantity < 0) reasonCodes.add("NEGATIVE_POSITION");

    const position = state.position as unknown;
    if (!isRecord(position) || !finite(state.cash) || !finite(position.quantity) || !finite(position.averagePrice) || !finite(position.realizedPnl)) {
      reasonCodes.add("PROJECTION_MISMATCH");
    } else {
      if (state.cash < 0) reasonCodes.add("NEGATIVE_CASH");
      if (position.quantity < 0) reasonCodes.add("NEGATIVE_POSITION");
      if (position.averagePrice < 0 || (position.quantity === 0 && position.averagePrice !== 0) || (position.quantity > 0 && position.averagePrice <= 0)) {
        reasonCodes.add("INVALID_AVERAGE_PRICE");
      }
      if (!equal(state.cash, replay.cash) || !equal(position.quantity, replay.quantity) || !equal(position.averagePrice, replay.averagePrice) || !equal(position.realizedPnl, replay.realizedPnl)) {
        reasonCodes.add("PROJECTION_MISMATCH");
      }
    }
  }

  if (reasonCodes.size === 0) return VALID_RESULT;
  return Object.freeze({ status: "INVALID" as const, reasonCodes: Object.freeze([...reasonCodes].sort()) });
}

export function selectPaperLedgerRecoveryCandidate<T extends Readonly<{ paper: PaperBrokerState }>>(
  sqliteState: T | undefined,
  legacyState: T | undefined,
  initialCash: number
): Readonly<{ source: PaperLedgerRecoverySource; state: T; validation: PaperLedgerValidationResult }> | undefined {
  const state = sqliteState ?? legacyState;
  if (!state) return undefined;
  return Object.freeze({
    source: sqliteState ? "SQLITE" : "LEGACY",
    state,
    validation: validatePaperLedgerRecovery(state.paper, initialCash)
  });
}
