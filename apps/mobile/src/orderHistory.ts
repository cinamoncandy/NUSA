export type OrderHistoryFilter = "ALL" | "FILLED" | "CANCELLED";
export type OrderHistorySort = "TIME_DESC" | "TIME_ASC" | "PRICE_DESC" | "QUANTITY_DESC";
export type OrderHistoryStatus = "FILLED" | "CANCELLED" | "OPEN" | "FAILED";

export interface OrderHistoryEntry {
  readonly id: string;
  readonly market: string;
  readonly side: "BUY" | "SELL";
  readonly quantity: number;
  readonly price: number;
  readonly fee: number;
  readonly filledAt: string;
  readonly status: OrderHistoryStatus;
}

export interface OrderHistoryViewModel {
  readonly state: "LOADING" | "EMPTY" | "READY" | "ERROR";
  readonly error: string | null;
  readonly query: string;
  readonly filter: OrderHistoryFilter;
  readonly sort: OrderHistorySort;
  readonly page: number;
  readonly pageCount: number;
  readonly total: number;
  readonly orders: readonly OrderHistoryEntry[];
}

const freeze = <T>(value: T): Readonly<T> => Object.freeze(value);
const marketPattern = /^[A-Z0-9]+-[A-Z0-9]+$/;
const statuses = new Set<OrderHistoryStatus>(["FILLED", "CANCELLED", "OPEN", "FAILED"]);

function validDate(value: string): boolean {
  return value.length > 0 && Number.isFinite(Date.parse(value));
}

export function parseOrderHistory(raw: unknown): readonly OrderHistoryEntry[] {
  if (!Array.isArray(raw)) throw new Error("order history is invalid");
  const entries = raw.map((value, index) => {
    if (value === null || typeof value !== "object") throw new Error(`order ${index} is invalid`);
    const row = value as Record<string, unknown>;
    const id = typeof row.id === "string" ? row.id.trim() : "";
    const market = typeof row.market === "string" ? row.market.trim().toUpperCase() : "";
    const side = row.side;
    const status = row.status === undefined ? "FILLED" : row.status;
    if (!id || !marketPattern.test(market) || (side !== "BUY" && side !== "SELL") || !statuses.has(status as OrderHistoryStatus) || !Number.isFinite(row.quantity) || (row.quantity as number) <= 0 || !Number.isFinite(row.price) || (row.price as number) <= 0 || !Number.isFinite(row.fee) || (row.fee as number) < 0 || typeof row.filledAt !== "string" || !validDate(row.filledAt)) throw new Error(`order ${index} is invalid`);
    return freeze({ id, market, side: side as "BUY" | "SELL", quantity: row.quantity as number, price: row.price as number, fee: row.fee as number, filledAt: row.filledAt, status: status as OrderHistoryStatus });
  });
  const ids = new Set<string>();
  for (const entry of entries) {
    if (ids.has(entry.id)) throw new Error(`duplicate order ${entry.id}`);
    ids.add(entry.id);
  }
  return freeze(entries);
}

function compare(left: OrderHistoryEntry, right: OrderHistoryEntry, sort: OrderHistorySort): number {
  if (sort === "TIME_ASC") return left.filledAt.localeCompare(right.filledAt) || left.id.localeCompare(right.id);
  if (sort === "PRICE_DESC") return right.price - left.price || right.filledAt.localeCompare(left.filledAt) || left.id.localeCompare(right.id);
  if (sort === "QUANTITY_DESC") return right.quantity - left.quantity || right.filledAt.localeCompare(left.filledAt) || left.id.localeCompare(right.id);
  return right.filledAt.localeCompare(left.filledAt) || left.id.localeCompare(right.id);
}

export function buildOrderHistoryViewModel(input: { readonly rawOrders: readonly unknown[] | null; readonly query: string; readonly filter: OrderHistoryFilter; readonly sort: OrderHistorySort; readonly page: number; readonly pageSize?: number }): OrderHistoryViewModel {
  const pageSize = input.pageSize ?? 20;
  const empty = (state: OrderHistoryViewModel["state"], error: string | null): OrderHistoryViewModel => freeze({ state, error, query: input.query, filter: input.filter, sort: input.sort, page: 1, pageCount: 0, total: 0, orders: [] });
  if (input.rawOrders === null) return empty("LOADING", null);
  if (!Number.isSafeInteger(pageSize) || pageSize <= 0) return empty("ERROR", "PAGE_SIZE_INVALID");
  let parsed: readonly OrderHistoryEntry[];
  try { parsed = parseOrderHistory(input.rawOrders); } catch (error) { return empty("ERROR", error instanceof Error ? error.message : "ORDER_HISTORY_INVALID"); }
  const query = input.query.trim().toUpperCase();
  const filtered = parsed.filter((order) => (input.filter === "ALL" || order.status === input.filter) && (query === "" || order.id.toUpperCase().includes(query) || order.market.includes(query)));
  const sorted = [...filtered].sort((left, right) => compare(left, right, input.sort));
  const pageCount = Math.ceil(sorted.length / pageSize);
  if (sorted.length === 0) return empty("EMPTY", "NO_MATCHING_ORDERS");
  const page = Math.min(Math.max(Number.isSafeInteger(input.page) ? input.page : 1, 1), pageCount);
  return freeze({ state: "READY", error: null, query: input.query, filter: input.filter, sort: input.sort, page, pageCount, total: sorted.length, orders: freeze(sorted.slice((page - 1) * pageSize, page * pageSize)) });
}
