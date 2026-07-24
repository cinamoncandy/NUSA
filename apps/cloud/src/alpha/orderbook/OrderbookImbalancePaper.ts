import { createHash } from "node:crypto";

export type OrderbookImbalancePaperOrderState =
  | "NEW" | "QUEUED" | "ACCEPTED" | "PARTIAL_FILL" | "FILLED"
  | "CANCELLED" | "REJECTED" | "CLOSED" | "ARCHIVED";

export type OrderbookImbalancePaperEventType =
  | "ORDER_CREATED" | "ORDER_QUEUED" | "ORDER_ACCEPTED"
  | "ORDER_PARTIALLY_FILLED" | "ORDER_FILLED" | "ORDER_CANCELLED"
  | "ORDER_REJECTED" | "POSITION_CLOSED" | "ORDER_ARCHIVED";

export interface OrderbookImbalancePaperEvent {
  readonly eventId: string;
  readonly sequence: number;
  readonly orderId: string;
  readonly type: OrderbookImbalancePaperEventType;
  readonly occurredAt: string;
  readonly side: "BUY" | "SELL" | null;
  readonly quantity: number | null;
  readonly price: number | null;
  readonly fee: number;
  readonly slippageCost: number;
  readonly realizedPnl: number;
  readonly featureHash: string | null;
  readonly decisionHash: string | null;
  readonly reason: string;
  readonly previousHash: string | null;
  readonly contentHash: string;
}

export interface OrderbookImbalancePaperLedger {
  readonly engineVersion: number;
  readonly market: string;
  readonly events: readonly OrderbookImbalancePaperEvent[];
  readonly headHash: string | null;
  readonly contentHash: string;
}

export interface OrderbookImbalancePaperOrderSnapshot {
  readonly orderId: string;
  readonly state: OrderbookImbalancePaperOrderState;
  readonly side: "BUY" | "SELL";
  readonly requestedQuantity: number;
  readonly filledQuantity: number;
  readonly averageFillPrice: number | null;
  readonly updatedAt: string;
}

export interface AppendOrderbookImbalancePaperEventInput {
  readonly eventId: string;
  readonly orderId: string;
  readonly type: OrderbookImbalancePaperEventType;
  readonly occurredAt: string;
  readonly side?: "BUY" | "SELL" | null;
  readonly quantity?: number | null;
  readonly price?: number | null;
  readonly fee?: number;
  readonly slippageCost?: number;
  readonly realizedPnl?: number;
  readonly featureHash?: string | null;
  readonly decisionHash?: string | null;
  readonly reason: string;
}

export interface OrderbookImbalancePaperDailyReport {
  readonly reportDate: string;
  readonly market: string;
  readonly createdOrders: number;
  readonly filledOrders: number;
  readonly rejectedOrders: number;
  readonly cancelledOrders: number;
  readonly closedPositions: number;
  readonly grossRealizedPnl: number;
  readonly fees: number;
  readonly slippageCost: number;
  readonly netRealizedPnl: number;
  readonly tradedQuantity: number;
  readonly ledgerHeadHash: string | null;
  readonly contentHash: string;
}

export interface OrderbookImbalanceChampionPolicy {
  readonly minimumPaperDays: number;
  readonly minimumClosedPositions: number;
  readonly minimumNetRealizedPnl: number;
  readonly maximumRejectedOrderRatio: number;
  readonly requireWalkForwardPass: boolean;
  readonly requireStressPass: boolean;
}

export interface OrderbookImbalanceChampionCandidateReport {
  readonly generatedAt: string;
  readonly eligible: boolean;
  readonly reasons: readonly string[];
  readonly paperDays: number;
  readonly closedPositions: number;
  readonly netRealizedPnl: number;
  readonly rejectedOrderRatio: number;
  readonly walkForwardPassed: boolean;
  readonly stressPassed: boolean;
  readonly ledgerHeadHash: string | null;
  readonly contentHash: string;
}

export interface OrderbookImbalanceWalkForwardGate { readonly aggregate: { readonly passed: boolean } }
export interface OrderbookImbalanceStressGate { readonly passed: boolean }

const SHA256 = /^[a-f0-9]{64}$/;
const round = (value: number): number => Math.round(value * 1_000_000_000) / 1_000_000_000;
const finite = (value: number, label: string): void => { if (!Number.isFinite(value)) throw new Error(`${label} must be finite`); };
const parseTime = (value: string, label: string): number => {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) throw new Error(`${label} must be a valid ISO timestamp`);
  return parsed;
};
const canonical = (value: unknown): string => {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(",")}}`;
};
const hash = (value: unknown): string => createHash("sha256").update(canonical(value)).digest("hex");

const stateAfter = (type: OrderbookImbalancePaperEventType): OrderbookImbalancePaperOrderState => {
  switch (type) {
    case "ORDER_CREATED": return "NEW";
    case "ORDER_QUEUED": return "QUEUED";
    case "ORDER_ACCEPTED": return "ACCEPTED";
    case "ORDER_PARTIALLY_FILLED": return "PARTIAL_FILL";
    case "ORDER_FILLED": return "FILLED";
    case "ORDER_CANCELLED": return "CANCELLED";
    case "ORDER_REJECTED": return "REJECTED";
    case "POSITION_CLOSED": return "CLOSED";
    case "ORDER_ARCHIVED": return "ARCHIVED";
  }
};

const canTransition = (state: OrderbookImbalancePaperOrderState, type: OrderbookImbalancePaperEventType): boolean => {
  switch (type) {
    case "ORDER_CREATED": return false;
    case "ORDER_QUEUED": return state === "NEW";
    case "ORDER_ACCEPTED": return state === "QUEUED";
    case "ORDER_PARTIALLY_FILLED": return state === "ACCEPTED" || state === "PARTIAL_FILL";
    case "ORDER_FILLED": return state === "ACCEPTED" || state === "PARTIAL_FILL";
    case "ORDER_CANCELLED": return state === "NEW" || state === "QUEUED" || state === "ACCEPTED" || state === "PARTIAL_FILL";
    case "ORDER_REJECTED": return state === "NEW" || state === "QUEUED";
    case "POSITION_CLOSED": return state === "FILLED";
    case "ORDER_ARCHIVED": return state === "CANCELLED" || state === "REJECTED" || state === "CLOSED";
  }
};

export const createOrderbookImbalancePaperLedger = (engineVersion: number, market: string): OrderbookImbalancePaperLedger => {
  if (!Number.isInteger(engineVersion) || engineVersion < 1) throw new Error("engineVersion must be a positive integer");
  if (!market.trim()) throw new Error("market is required");
  const payload = { engineVersion, market: market.trim(), events: Object.freeze([] as OrderbookImbalancePaperEvent[]) as readonly OrderbookImbalancePaperEvent[], headHash: null as string | null };
  return Object.freeze({ ...payload, contentHash: hash(payload) });
};

export const verifyOrderbookImbalancePaperLedger = (ledger: OrderbookImbalancePaperLedger): void => {
  if (!SHA256.test(ledger.contentHash)) throw new Error("ledger contentHash is invalid");
  const ids = new Set<string>();
  let previous: string | null = null;
  ledger.events.forEach((event, index) => {
    if (event.sequence !== index + 1) throw new Error("ledger sequence is invalid");
    if (ids.has(event.eventId)) throw new Error(`duplicate event ${event.eventId}`);
    ids.add(event.eventId);
    if (event.previousHash !== previous) throw new Error("ledger hash chain is broken");
    const { contentHash, ...payload } = event;
    if (hash(payload) !== contentHash) throw new Error("event contentHash mismatch");
    previous = contentHash;
  });
  if (ledger.headHash !== previous) throw new Error("ledger headHash mismatch");
  const { contentHash, ...payload } = ledger;
  if (hash(payload) !== contentHash) throw new Error("ledger contentHash mismatch");
};

export const replayOrderbookImbalancePaperLedger = (ledger: OrderbookImbalancePaperLedger): { readonly orders: readonly OrderbookImbalancePaperOrderSnapshot[]; readonly replayHash: string } => {
  verifyOrderbookImbalancePaperLedger(ledger);
  const orders = new Map<string, OrderbookImbalancePaperOrderSnapshot>();
  for (const event of ledger.events) {
    const current = orders.get(event.orderId);
    if (event.type === "ORDER_CREATED") {
      if (current) throw new Error("duplicate order creation");
      if (event.side === null) throw new Error("created order requires side");
      orders.set(event.orderId, Object.freeze({ orderId: event.orderId, state: "NEW", side: event.side, requestedQuantity: event.quantity ?? 0, filledQuantity: 0, averageFillPrice: null, updatedAt: event.occurredAt }));
      continue;
    }
    if (!current) throw new Error("order does not exist");
    if (!canTransition(current.state, event.type)) throw new Error(`invalid transition ${current.state} -> ${event.type}`);
    let filledQuantity = current.filledQuantity;
    let averageFillPrice = current.averageFillPrice;
    if (event.type === "ORDER_PARTIALLY_FILLED" || event.type === "ORDER_FILLED") {
      const quantity = event.quantity ?? 0;
      const price = event.price ?? 0;
      const totalCost = (averageFillPrice ?? 0) * filledQuantity + price * quantity;
      filledQuantity = round(filledQuantity + quantity);
      averageFillPrice = round(totalCost / filledQuantity);
      if (filledQuantity - current.requestedQuantity > 1e-9) throw new Error("filled quantity exceeds requested quantity");
      if (event.type === "ORDER_FILLED" && Math.abs(filledQuantity - current.requestedQuantity) > 1e-9) throw new Error("ORDER_FILLED must complete requested quantity");
    }
    orders.set(event.orderId, Object.freeze({ ...current, state: stateAfter(event.type), filledQuantity, averageFillPrice, updatedAt: event.occurredAt }));
  }
  const snapshots = Object.freeze([...orders.values()].sort((a, b) => a.orderId.localeCompare(b.orderId)));
  return Object.freeze({ orders: snapshots, replayHash: hash(snapshots) });
};

export const appendOrderbookImbalancePaperEvent = (ledger: OrderbookImbalancePaperLedger, input: AppendOrderbookImbalancePaperEventInput): OrderbookImbalancePaperLedger => {
  verifyOrderbookImbalancePaperLedger(ledger);
  if (!input.eventId.trim() || !input.orderId.trim() || !input.reason.trim()) throw new Error("eventId, orderId, and reason are required");
  if (ledger.events.some((event) => event.eventId === input.eventId)) throw new Error(`duplicate event ${input.eventId}`);
  parseTime(input.occurredAt, "occurredAt");
  const side = input.side ?? null;
  const quantity = input.quantity ?? null;
  const price = input.price ?? null;
  const fee = input.fee ?? 0;
  const slippageCost = input.slippageCost ?? 0;
  const realizedPnl = input.realizedPnl ?? 0;
  const featureHash = input.featureHash ?? null;
  const decisionHash = input.decisionHash ?? null;
  if (quantity !== null) { finite(quantity, "quantity"); if (quantity <= 0) throw new Error("quantity must be positive"); }
  if (price !== null) { finite(price, "price"); if (price <= 0) throw new Error("price must be positive"); }
  finite(fee, "fee"); finite(slippageCost, "slippageCost"); finite(realizedPnl, "realizedPnl");
  if (fee < 0 || slippageCost < 0) throw new Error("fee and slippageCost must be non-negative");
  if (featureHash !== null && !SHA256.test(featureHash)) throw new Error("featureHash must be SHA-256");
  if (decisionHash !== null && !SHA256.test(decisionHash)) throw new Error("decisionHash must be SHA-256");
  if ((input.type === "ORDER_PARTIALLY_FILLED" || input.type === "ORDER_FILLED") && (quantity === null || price === null)) throw new Error("fill events require quantity and price");
  const current = replayOrderbookImbalancePaperLedger(ledger).orders.find((order) => order.orderId === input.orderId);
  if (input.type === "ORDER_CREATED") {
    if (current) throw new Error("ORDER_CREATED requires a new orderId");
    if (quantity === null || side === null) throw new Error("ORDER_CREATED requires side and requested quantity");
  } else {
    if (!current) throw new Error("order does not exist");
    if (!canTransition(current.state, input.type)) throw new Error(`invalid transition ${current.state} -> ${input.type}`);
    if (side !== null && side !== current.side) throw new Error("event side does not match order side");
  }
  const payload = {
    eventId: input.eventId.trim(), sequence: ledger.events.length + 1, orderId: input.orderId.trim(), type: input.type,
    occurredAt: input.occurredAt, side, quantity: quantity === null ? null : round(quantity), price: price === null ? null : round(price),
    fee: round(fee), slippageCost: round(slippageCost), realizedPnl: round(realizedPnl), featureHash, decisionHash,
    reason: input.reason.trim(), previousHash: ledger.headHash
  };
  const event: OrderbookImbalancePaperEvent = Object.freeze({ ...payload, contentHash: hash(payload) });
  const events = Object.freeze([...ledger.events, event]);
  const resultPayload = { engineVersion: ledger.engineVersion, market: ledger.market, events, headHash: event.contentHash };
  const result: OrderbookImbalancePaperLedger = Object.freeze({ ...resultPayload, contentHash: hash(resultPayload) });
  replayOrderbookImbalancePaperLedger(result);
  return result;
};

export const createOrderbookImbalancePaperDailyReport = (ledger: OrderbookImbalancePaperLedger, reportDate: string): OrderbookImbalancePaperDailyReport => {
  verifyOrderbookImbalancePaperLedger(ledger);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(reportDate)) throw new Error("reportDate must be YYYY-MM-DD");
  const events = ledger.events.filter((event) => event.occurredAt.slice(0, 10) === reportDate);
  const count = (type: OrderbookImbalancePaperEventType): number => events.filter((event) => event.type === type).length;
  const gross = events.reduce((sum, event) => sum + event.realizedPnl, 0);
  const fees = events.reduce((sum, event) => sum + event.fee, 0);
  const slippage = events.reduce((sum, event) => sum + event.slippageCost, 0);
  const payload = {
    reportDate, market: ledger.market, createdOrders: count("ORDER_CREATED"), filledOrders: count("ORDER_FILLED"), rejectedOrders: count("ORDER_REJECTED"),
    cancelledOrders: count("ORDER_CANCELLED"), closedPositions: count("POSITION_CLOSED"), grossRealizedPnl: round(gross), fees: round(fees),
    slippageCost: round(slippage), netRealizedPnl: round(gross - fees - slippage), tradedQuantity: round(events.reduce((sum, event) => sum + (event.quantity ?? 0), 0)), ledgerHeadHash: ledger.headHash
  };
  return Object.freeze({ ...payload, contentHash: hash(payload) });
};

export const createOrderbookImbalanceChampionCandidateReport = (
  ledger: OrderbookImbalancePaperLedger,
  dailyReports: readonly OrderbookImbalancePaperDailyReport[],
  walkForward: OrderbookImbalanceWalkForwardGate,
  stress: OrderbookImbalanceStressGate,
  generatedAt: string,
  policy: OrderbookImbalanceChampionPolicy
): OrderbookImbalanceChampionCandidateReport => {
  verifyOrderbookImbalancePaperLedger(ledger);
  parseTime(generatedAt, "generatedAt");
  if (!Number.isInteger(policy.minimumPaperDays) || policy.minimumPaperDays < 1) throw new Error("minimumPaperDays must be positive");
  if (!Number.isInteger(policy.minimumClosedPositions) || policy.minimumClosedPositions < 0) throw new Error("minimumClosedPositions must be non-negative");
  finite(policy.minimumNetRealizedPnl, "minimumNetRealizedPnl");
  finite(policy.maximumRejectedOrderRatio, "maximumRejectedOrderRatio");
  if (policy.maximumRejectedOrderRatio < 0 || policy.maximumRejectedOrderRatio > 1) throw new Error("maximumRejectedOrderRatio must be between 0 and 1");
  const paperDays = new Set(dailyReports.map((report) => report.reportDate)).size;
  const createdOrders = dailyReports.reduce((sum, report) => sum + report.createdOrders, 0);
  const rejectedOrders = dailyReports.reduce((sum, report) => sum + report.rejectedOrders, 0);
  const closedPositions = dailyReports.reduce((sum, report) => sum + report.closedPositions, 0);
  const netRealizedPnl = round(dailyReports.reduce((sum, report) => sum + report.netRealizedPnl, 0));
  const rejectedOrderRatio = createdOrders === 0 ? 0 : rejectedOrders / createdOrders;
  const reasons: string[] = [];
  if (paperDays < policy.minimumPaperDays) reasons.push("PAPER_DAYS_INSUFFICIENT");
  if (closedPositions < policy.minimumClosedPositions) reasons.push("CLOSED_POSITIONS_INSUFFICIENT");
  if (netRealizedPnl < policy.minimumNetRealizedPnl) reasons.push("NET_REALIZED_PNL_LOW");
  if (rejectedOrderRatio > policy.maximumRejectedOrderRatio) reasons.push("REJECTED_ORDER_RATIO_HIGH");
  if (policy.requireWalkForwardPass && !walkForward.aggregate.passed) reasons.push("WALK_FORWARD_NOT_PASSED");
  if (policy.requireStressPass && !stress.passed) reasons.push("STRESS_NOT_PASSED");
  if (reasons.length === 0) reasons.push("CHAMPION_CANDIDATE_POLICY_PASSED");
  const payload = {
    generatedAt, eligible: reasons.length === 1 && reasons[0] === "CHAMPION_CANDIDATE_POLICY_PASSED", reasons: Object.freeze(reasons),
    paperDays, closedPositions, netRealizedPnl, rejectedOrderRatio: round(rejectedOrderRatio), walkForwardPassed: walkForward.aggregate.passed,
    stressPassed: stress.passed, ledgerHeadHash: ledger.headHash
  };
  return Object.freeze({ ...payload, contentHash: hash(payload) });
};
