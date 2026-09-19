import { createHash } from "node:crypto";

export interface CanonicalPaperFill {
  readonly fillId: string;
  readonly orderId: string;
  readonly market: string;
  readonly side: "BUY" | "SELL";
  readonly quantity: number;
  readonly price: number;
  readonly fee: number;
  readonly filledAt: number;
}

export interface CanonicalPaperMark {
  readonly market: string;
  readonly markPrice: number;
}

export interface CanonicalPaperLedgerEntry {
  readonly fillId: string;
  readonly orderId: string;
  readonly market: string;
  readonly side: "BUY" | "SELL";
  readonly quantity: number;
  readonly price: number;
  readonly fee: number;
  readonly grossNotional: number;
  readonly cashDelta: number;
  readonly realizedPnL: number;
  readonly filledAt: number;
}

export interface CanonicalPaperLedger {
  readonly schemaVersion: 1;
  readonly source: "PAPER_CANONICAL_FILLS";
  readonly initialCapital: number;
  readonly entries: readonly CanonicalPaperLedgerEntry[];
  readonly cash: number;
  readonly positions: Readonly<Record<string, { readonly quantity: number; readonly averageEntryPrice: number }>>;
  readonly realizedPnL: number;
  readonly unrealizedPnL: number;
  readonly equity: number;
  readonly fingerprintSha256: string;
}

const finiteNonNegative = (value: number, name: string): void => {
  if (!Number.isFinite(value) || value < 0) throw new Error(`${name} must be non-negative`);
};

function canonical(value: unknown): string {
  return JSON.stringify(value, (_key, item) => typeof item === "number" && !Number.isFinite(item) ? (() => { throw new Error("ledger contains non-finite value"); })() : item);
}

function fingerprint(value: unknown): string {
  return createHash("sha256").update(canonical(value), "utf8").digest("hex");
}

function assertFill(fill: CanonicalPaperFill): void {
  if (!fill.fillId.trim() || !fill.orderId.trim() || !fill.market.trim()) throw new Error("fill identity is required");
  if (!Number.isSafeInteger(fill.filledAt) || fill.filledAt < 0) throw new Error("fill timestamp is invalid");
  finiteNonNegative(fill.quantity, "fill quantity");
  finiteNonNegative(fill.price, "fill price");
  finiteNonNegative(fill.fee, "fill fee");
  if (fill.quantity <= 0 || fill.price <= 0) throw new Error("fill quantity and price must be positive");
}

export function projectCanonicalPaperLedger(
  initialCapital: number,
  fills: readonly CanonicalPaperFill[],
  marks: readonly CanonicalPaperMark[],
): CanonicalPaperLedger {
  if (!Number.isFinite(initialCapital) || initialCapital < 0) throw new Error("initialCapital must be non-negative");
  const ids = new Set<string>();
  for (const fill of fills) {
    assertFill(fill);
    if (ids.has(fill.fillId)) throw new Error(`duplicate fill: ${fill.fillId}`);
    ids.add(fill.fillId);
  }
  const ordered = [...fills].sort((a, b) => a.filledAt - b.filledAt || a.fillId.localeCompare(b.fillId));
  const state = new Map<string, { quantity: number; averageEntryPrice: number }>();
  let cash = initialCapital;
  let realizedPnL = 0;
  const entries: CanonicalPaperLedgerEntry[] = [];

  for (const fill of ordered) {
    const prior = state.get(fill.market) ?? { quantity: 0, averageEntryPrice: 0 };
    const grossNotional = fill.quantity * fill.price;
    let realized = 0;
    if (fill.side === "BUY") {
      const nextQuantity = prior.quantity + fill.quantity;
      const nextAverage = (prior.averageEntryPrice * prior.quantity + grossNotional + fill.fee) / nextQuantity;
      state.set(fill.market, { quantity: nextQuantity, averageEntryPrice: nextAverage });
      cash -= grossNotional + fill.fee;
    } else {
      if (fill.quantity > prior.quantity + Number.EPSILON) throw new Error(`insufficient position for fill: ${fill.fillId}`);
      realized = (fill.price - prior.averageEntryPrice) * fill.quantity - fill.fee;
      const nextQuantity = Math.max(0, prior.quantity - fill.quantity);
      state.set(fill.market, { quantity: nextQuantity, averageEntryPrice: nextQuantity === 0 ? 0 : prior.averageEntryPrice });
      cash += grossNotional - fill.fee;
      realizedPnL += realized;
    }
    entries.push(Object.freeze({
      fillId: fill.fillId,
      orderId: fill.orderId,
      market: fill.market,
      side: fill.side,
      quantity: fill.quantity,
      price: fill.price,
      fee: fill.fee,
      grossNotional,
      cashDelta: fill.side === "BUY" ? -(grossNotional + fill.fee) : grossNotional - fill.fee,
      realizedPnL: realized,
      filledAt: fill.filledAt,
    }));
  }

  const markMap = new Map<string, number>();
  for (const mark of marks) {
    if (!mark.market.trim() || !Number.isFinite(mark.markPrice) || mark.markPrice <= 0) throw new Error("invalid mark");
    if (markMap.has(mark.market)) throw new Error(`duplicate mark: ${mark.market}`);
    markMap.set(mark.market, mark.markPrice);
  }
  let unrealizedPnL = 0;
  for (const [market, position] of state) {
    if (position.quantity === 0) continue;
    const mark = markMap.get(market);
    if (mark == null) throw new Error(`missing mark: ${market}`);
    unrealizedPnL += (mark - position.averageEntryPrice) * position.quantity;
  }
  const positionValue = [...state.entries()].reduce((sum, [market, position]) => sum + position.quantity * (markMap.get(market) ?? 0), 0);
  const equity = cash + positionValue;
  const fingerprintSha256 = fingerprint({ schemaVersion: 1, source: "PAPER_CANONICAL_FILLS", initialCapital, entries, cash, positions: Object.fromEntries([...state.entries()].sort(([a], [b]) => a.localeCompare(b))), realizedPnL, unrealizedPnL, equity });
  return Object.freeze({
    schemaVersion: 1,
    source: "PAPER_CANONICAL_FILLS",
    initialCapital,
    entries: Object.freeze(entries),
    cash,
    positions: Object.freeze(Object.fromEntries([...state.entries()].sort(([a], [b]) => a.localeCompare(b)))),
    realizedPnL,
    unrealizedPnL,
    equity,
    fingerprintSha256,
  });
}
