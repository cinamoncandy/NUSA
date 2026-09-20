import { createHash } from "node:crypto";
import type { PaperAccountPosition, PaperAccountState, PaperFillRecord } from "./paperTradingExecutionLoop";

const SCALE = 100_000_000n;
const round8 = (value: number): number => Number(value.toFixed(8));
const scaled = (value: number): bigint => {
  if (!Number.isFinite(value)) throw new Error("paper ledger amount must be finite");
  const negative = value < 0;
  const text = Math.abs(value).toFixed(12);
  const [whole, fraction = ""] = text.split(".");
  const raw = BigInt((whole + fraction.padEnd(12, "0")).replace(/^0+(?=\d)/, "") || "0");
  const value8 = (raw + 5000n) / 10000n;
  return negative ? -value8 : value8;
};
const unscaled = (value: bigint): number => Number(value) / Number(SCALE);

export interface PaperAccountingJournalEntry {
  readonly sequence: number;
  readonly fillId: string;
  readonly orderId: string;
  readonly market: string;
  readonly side: "BUY" | "SELL";
  readonly quantity: number;
  readonly price: number;
  readonly fee: number;
  readonly cashAfter: number;
  readonly positionQuantityAfter: number;
  readonly averageEntryPriceAfter: number;
  readonly realizedPnLAfter: number;
  readonly occurredAt: number;
}

export interface PaperAccountingProjection {
  readonly cash: number;
  readonly realizedPnL: number;
  readonly positions: readonly PaperAccountPosition[];
  readonly journal: readonly PaperAccountingJournalEntry[];
  readonly fingerprintSha256: string;
}

interface MutablePosition {
  market: string;
  quantity: bigint;
  costBasis: bigint;
  realizedPnL: bigint;
  markPrice: number;
}

function canonicalFillOrder(fills: readonly PaperFillRecord[]): readonly PaperFillRecord[] {
  const ids = new Set<string>();
  const ordered = [...fills].sort((a, b) => a.filledAt - b.filledAt || a.id.localeCompare(b.id));
  for (const fill of ordered) {
    if (!fill.id.trim() || ids.has(fill.id)) throw new Error("PAPER_LEDGER_DUPLICATE_FILL");
    ids.add(fill.id);
    if (!fill.orderId.trim() || !fill.market.trim() || !Number.isSafeInteger(fill.filledAt) || fill.filledAt < 0) throw new Error("PAPER_LEDGER_INVALID_FILL");
    if (![fill.quantity, fill.price, fill.fee].every(Number.isFinite) || fill.quantity <= 0 || fill.price <= 0 || fill.fee < 0) throw new Error("PAPER_LEDGER_INVALID_FILL");
  }
  return ordered;
}

export function projectPaperAccounting(initialCapital: number, fills: readonly PaperFillRecord[], marks: Readonly<Record<string, number>> = {}): PaperAccountingProjection {
  if (!Number.isFinite(initialCapital) || initialCapital <= 0) throw new Error("PAPER_LEDGER_INVALID_INITIAL_CAPITAL");
  let cash = scaled(initialCapital);
  let realized = 0n;
  const positions = new Map<string, MutablePosition>();
  const journal: PaperAccountingJournalEntry[] = [];

  for (const [index, fill] of canonicalFillOrder(fills).entries()) {
    const quantity = scaled(fill.quantity);
    const price = scaled(fill.price);
    const fee = scaled(fill.fee);
    const notional = (quantity * price) / SCALE;
    const previous = positions.get(fill.market) ?? { market: fill.market, quantity: 0n, costBasis: 0n, realizedPnL: 0n, markPrice: fill.price };

    if (fill.side === "BUY") {
      if (notional + fee > cash) throw new Error("PAPER_LEDGER_INSUFFICIENT_CASH");
      cash -= notional + fee;
      previous.quantity += quantity;
      previous.costBasis += notional + fee;
    } else {
      if (quantity > previous.quantity) throw new Error("PAPER_LEDGER_INSUFFICIENT_POSITION");
      const average = previous.quantity === 0n ? 0n : (previous.costBasis * SCALE) / previous.quantity;
      const pnl = ((price - average) * quantity) / SCALE - fee;
      cash += notional - fee;
      realized += pnl;
      previous.realizedPnL += pnl;
      previous.costBasis -= (average * quantity) / SCALE;
      previous.quantity -= quantity;
      if (previous.quantity === 0n) previous.costBasis = 0n;
    }
    previous.markPrice = marks[fill.market] ?? fill.price;
    positions.set(fill.market, previous);
    const averageAfter = previous.quantity === 0n ? 0 : unscaled((previous.costBasis * SCALE) / previous.quantity);
    journal.push(Object.freeze({
      sequence: index + 1, fillId: fill.id, orderId: fill.orderId, market: fill.market, side: fill.side,
      quantity: fill.quantity, price: fill.price, fee: fill.fee, cashAfter: unscaled(cash),
      positionQuantityAfter: unscaled(previous.quantity), averageEntryPriceAfter: averageAfter,
      realizedPnLAfter: unscaled(realized), occurredAt: fill.filledAt
    }));
  }

  const projectedPositions = [...positions.values()].sort((a, b) => a.market.localeCompare(b.market)).map((position) => {
    const quantity = unscaled(position.quantity);
    const averageEntryPrice = position.quantity === 0n ? 0 : unscaled((position.costBasis * SCALE) / position.quantity);
    const markPrice = marks[position.market] ?? position.markPrice;
    if (!Number.isFinite(markPrice) || markPrice < 0) throw new Error("PAPER_LEDGER_INVALID_MARK");
    return Object.freeze({
      market: position.market,
      quantity,
      averageEntryPrice,
      realizedPnL: unscaled(position.realizedPnL),
      unrealizedPnL: round8(quantity * (markPrice - averageEntryPrice)),
      markPrice
    });
  });
  const canonical = JSON.stringify({ version: 1, initialCapital: round8(initialCapital), journal, positions: projectedPositions, cash: unscaled(cash), realizedPnL: unscaled(realized) });
  return Object.freeze({
    cash: unscaled(cash),
    realizedPnL: unscaled(realized),
    positions: Object.freeze(projectedPositions),
    journal: Object.freeze(journal),
    fingerprintSha256: createHash("sha256").update(canonical, "utf8").digest("hex")
  });
}

export function assertPaperAccountingReconciled(input: {
  readonly initialCapital: number;
  readonly fills: readonly PaperFillRecord[];
  readonly cash: number;
  readonly realizedPnL: number;
  readonly positions: readonly PaperAccountPosition[];
}): PaperAccountingProjection {
  const marks = Object.fromEntries(input.positions.map((position) => [position.market, position.markPrice]));
  const projection = projectPaperAccounting(input.initialCapital, input.fills, marks);
  const actual = [...input.positions].sort((a, b) => a.market.localeCompare(b.market));
  if (round8(input.cash) !== round8(projection.cash) || round8(input.realizedPnL) !== round8(projection.realizedPnL) || JSON.stringify(actual) !== JSON.stringify(projection.positions)) {
    throw new Error("PAPER_LEDGER_RECONCILIATION_REQUIRED");
  }
  return projection;
}


export interface DurablePaperAccountingSource {
  readonly durableCompleteJournal: true;
  readonly reconciled: true;
  readonly historyStartAt: number;
  readonly historyEndAt: number;
  readonly fills: readonly PaperFillRecord[];
  readonly projection: PaperAccountingProjection;
  readonly ledgerFingerprintSha256: string;
}

function fillIdentity(fill: PaperFillRecord): string {
  return JSON.stringify(fill);
}

export function buildDurablePaperAccountingSource(
  history: readonly PaperAccountState[],
  throughAt?: number,
): DurablePaperAccountingSource {
  if (!Array.isArray(history) || history.length === 0) throw new Error("PAPER_LEDGER_HISTORY_UNAVAILABLE");
  const ordered = [...history]
    .filter((state) => throughAt === undefined || state.updatedAt <= throughAt)
    .sort((left, right) => left.updatedAt - right.updatedAt);
  if (ordered.length === 0) throw new Error("PAPER_LEDGER_HISTORY_BOUNDARY_MISSING");
  for (let index = 1; index < ordered.length; index += 1) {
    if (ordered[index]!.updatedAt <= ordered[index - 1]!.updatedAt) throw new Error("PAPER_LEDGER_HISTORY_CHRONOLOGY_INVALID");
  }
  const end = ordered.at(-1)!;
  if (throughAt !== undefined && end.updatedAt !== throughAt) throw new Error("PAPER_LEDGER_HISTORY_BOUNDARY_MISSING");
  if (ordered.some((state) => state.version !== 1 || state.initialCapital !== end.initialCapital)) throw new Error("PAPER_LEDGER_HISTORY_ACCOUNT_IDENTITY_MISMATCH");

  const idempotencyToOrderId = new Map<string, string>();
  const fillsById = new Map<string, PaperFillRecord>();
  const fillIdentityById = new Map<string, string>();
  for (const state of ordered) {
    for (const order of [...state.orders, ...(state.workingOrders ?? [])]) {
      const previous = idempotencyToOrderId.get(order.idempotencyKey);
      if (previous != null && previous !== order.id) throw new Error("PAPER_LEDGER_HISTORY_IDEMPOTENCY_CONFLICT");
      idempotencyToOrderId.set(order.idempotencyKey, order.id);
    }
    for (const fill of state.fills) {
      const identity = fillIdentity(fill);
      const previous = fillIdentityById.get(fill.id);
      if (previous != null && previous !== identity) throw new Error("PAPER_LEDGER_HISTORY_FILL_CONFLICT");
      fillIdentityById.set(fill.id, identity);
      fillsById.set(fill.id, fill);
    }
  }
  if (end.processedIdempotencyKeys.some((key) => !idempotencyToOrderId.has(key))) throw new Error("PAPER_LEDGER_HISTORY_INCOMPLETE");

  const fills = Object.freeze([...fillsById.values()].sort((left, right) => left.filledAt - right.filledAt || left.id.localeCompare(right.id)));
  const projection = assertPaperAccountingReconciled({
    initialCapital: end.initialCapital,
    fills,
    cash: end.cash,
    realizedPnL: end.realizedPnL,
    positions: end.positions,
  });
  return Object.freeze({
    durableCompleteJournal: true as const,
    reconciled: true as const,
    historyStartAt: ordered[0]!.updatedAt,
    historyEndAt: end.updatedAt,
    fills,
    projection,
    ledgerFingerprintSha256: projection.fingerprintSha256,
  });
}
