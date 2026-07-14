import { createHash } from "node:crypto";
import type { FundingPersistenceStrategyDecision } from "./FundingPersistenceStrategy";
import type { FundingPersistenceStressSummary } from "./FundingPersistenceStress";
import type { FundingPersistenceWalkForwardSummary } from "./FundingPersistenceWalkForward";

export type FundingPersistencePaperOrderState =
  | "NEW"
  | "QUEUED"
  | "ACCEPTED"
  | "PARTIAL_FILL"
  | "FILLED"
  | "CANCELLED"
  | "REJECTED"
  | "CLOSED"
  | "ARCHIVED";

export type FundingPersistencePaperEventType =
  | "ORDER_CREATED"
  | "ORDER_QUEUED"
  | "ORDER_ACCEPTED"
  | "ORDER_PARTIALLY_FILLED"
  | "ORDER_FILLED"
  | "ORDER_CANCELLED"
  | "ORDER_REJECTED"
  | "POSITION_CLOSED"
  | "ORDER_ARCHIVED";

export interface FundingPersistencePaperOrder {
  readonly orderId: string;
  readonly decisionId: string;
  readonly market: string;
  readonly side: "BUY" | "SELL";
  readonly requestedQuantity: number;
  readonly filledQuantity: number;
  readonly averageFillPrice: number | null;
  readonly state: FundingPersistencePaperOrderState;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface FundingPersistencePaperEvent {
  readonly eventId: string;
  readonly sequence: number;
  readonly orderId: string;
  readonly type: FundingPersistencePaperEventType;
  readonly occurredAt: string;
  readonly quantity: number | null;
  readonly price: number | null;
  readonly fee: number;
  readonly slippageCost: number;
  readonly realizedPnl: number;
  readonly reason: string;
  readonly previousHash: string | null;
  readonly contentHash: string;
}

export interface FundingPersistencePaperLedger {
  readonly engineVersion: number;
  readonly market: string;
  readonly events: readonly FundingPersistencePaperEvent[];
  readonly headHash: string | null;
  readonly contentHash: string;
}

export interface FundingPersistencePaperDailyReport {
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

export interface FundingPersistenceChampionPolicy {
  readonly minimumPaperDays: number;
  readonly minimumClosedPositions: number;
  readonly minimumNetRealizedPnl: number;
  readonly maximumRejectedOrderRatio: number;
  readonly requireWalkForwardPass: boolean;
  readonly requireStressPass: boolean;
}

export interface FundingPersistenceChampionCandidateReport {
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

const SHA256 = /^[a-f0-9]{64}$/;
const round = (value: number): number => Math.round(value * 1_000_000_000) / 1_000_000_000;
const finite = (value: number, label: string): void => {
  if (!Number.isFinite(value)) throw new Error(`${label} must be finite`);
};
const parseTime = (value: string, label: string): number => {
  const result = Date.parse(value);
  if (!Number.isFinite(result)) throw new Error(`${label} must be a valid ISO timestamp`);
  return result;
};
const canonical = (value: unknown): string => {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.entries(value as Record<string, unknown>)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`)
    .join(",")}}`;
};
const hash = (value: unknown): string => createHash("sha256").update(canonical(value)).digest("hex");

const transitionByEvent: Readonly<Record<FundingPersistencePaperEventType, readonly FundingPersistencePaperOrderState[]>> = Object.freeze({
  ORDER_CREATED: Object.freeze([]),
  ORDER_QUEUED: Object.freeze(["NEW"]),
  ORDER_ACCEPTED: Object.freeze(["QUEUED"]),
  ORDER_PARTIALLY_FILLED: Object.freeze(["ACCEPTED", "PARTIAL_FILL"]),
  ORDER_FILLED: Object.freeze(["ACCEPTED", "PARTIAL_FILL"]),
  ORDER_CANCELLED: Object.freeze(["NEW", "QUEUED", "ACCEPTED", "PARTIAL_FILL"]),
  ORDER_REJECTED: Object.freeze(["NEW", "QUEUED"]),
  POSITION_CLOSED: Object.freeze(["FILLED"]),
  ORDER_ARCHIVED: Object.freeze(["CANCELLED", "REJECTED", "CLOSED"])
});

const stateByEvent: Readonly<Record<FundingPersistencePaperEventType, FundingPersistencePaperOrderState>> = Object.freeze({
  ORDER_CREATED: "NEW",
  ORDER_QUEUED: "QUEUED",
  ORDER_ACCEPTED: "ACCEPTED",
  ORDER_PARTIALLY_FILLED: "PARTIAL_FILL",
  ORDER_FILLED: "FILLED",
  ORDER_CANCELLED: "CANCELLED",
  ORDER_REJECTED: "REJECTED",
  POSITION_CLOSED: "CLOSED",
  ORDER_ARCHIVED: "ARCHIVED"
});

const freezeEvent = (event: FundingPersistencePaperEvent): FundingPersistencePaperEvent => Object.freeze(event);

export const createFundingPersistencePaperOrder = (
  orderId: string,
  decision: FundingPersistenceStrategyDecision,
  requestedQuantity: number,
  createdAt: string
): FundingPersistencePaperOrder => {
  if (!orderId.trim()) throw new Error("orderId is required");
  finite(requestedQuantity, "requestedQuantity");
  if (requestedQuantity <= 0) throw new Error("requestedQuantity must be positive");
  parseTime(createdAt, "createdAt");
  if (!decision.eligible || !["ENTER_LONG", "ENTER_SHORT", "EXIT"].includes(decision.action)) {
    throw new Error("decision is not eligible for a paper order");
  }
  return Object.freeze({
    orderId: orderId.trim(),
    decisionId: decision.decisionId,
    market: decision.market,
    side: decision.action === "ENTER_SHORT" || decision.action === "EXIT" && decision.targetPosition === "FLAT" ? "SELL" : "BUY",
    requestedQuantity: round(requestedQuantity),
    filledQuantity: 0,
    averageFillPrice: null,
    state: "NEW",
    createdAt,
    updatedAt: createdAt
  });
};

export interface AppendPaperEventInput {
  readonly eventId: string;
  readonly orderId: string;
  readonly type: FundingPersistencePaperEventType;
  readonly occurredAt: string;
  readonly quantity?: number | null;
  readonly price?: number | null;
  readonly fee?: number;
  readonly slippageCost?: number;
  readonly realizedPnl?: number;
  readonly reason: string;
}

export const appendFundingPersistencePaperEvent = (
  ledger: FundingPersistencePaperLedger,
  input: AppendPaperEventInput
): FundingPersistencePaperLedger => {
  verifyFundingPersistencePaperLedger(ledger);
  if (!input.eventId.trim() || !input.orderId.trim() || !input.reason.trim()) throw new Error("eventId, orderId, and reason are required");
  if (ledger.events.some((event) => event.eventId === input.eventId)) throw new Error(`duplicate event ${input.eventId}`);
  const quantity = input.quantity ?? null;
  const price = input.price ?? null;
  const fee = input.fee ?? 0;
  const slippageCost = input.slippageCost ?? 0;
  const realizedPnl = input.realizedPnl ?? 0;
  parseTime(input.occurredAt, "occurredAt");
  if (quantity !== null) { finite(quantity, "quantity"); if (quantity <= 0) throw new Error("quantity must be positive"); }
  if (price !== null) { finite(price, "price"); if (price <= 0) throw new Error("price must be positive"); }
  for (const [label, value] of [["fee", fee], ["slippageCost", slippageCost], ["realizedPnl", realizedPnl]] as const) finite(value, label);
  if (fee < 0 || slippageCost < 0) throw new Error("fee and slippageCost must be non-negative");
  const existingState = replayFundingPersistencePaperLedger(ledger).orders.find((order) => order.orderId === input.orderId)?.state;
  if (input.type === "ORDER_CREATED") {
    if (existingState) throw new Error("ORDER_CREATED requires a new orderId");
  } else {
    if (!existingState) throw new Error("order does not exist");
    if (!transitionByEvent[input.type].includes(existingState)) throw new Error(`invalid transition ${existingState} -> ${input.type}`);
  }
  if (["ORDER_PARTIALLY_FILLED", "ORDER_FILLED"].includes(input.type) && (quantity === null || price === null)) {
    throw new Error("fill events require quantity and price");
  }
  const payload = {
    eventId: input.eventId.trim(),
    sequence: ledger.events.length + 1,
    orderId: input.orderId.trim(),
    type: input.type,
    occurredAt: input.occurredAt,
    quantity: quantity === null ? null : round(quantity),
    price: price === null ? null : round(price),
    fee: round(fee),
    slippageCost: round(slippageCost),
    realizedPnl: round(realizedPnl),
    reason: input.reason.trim(),
    previousHash: ledger.headHash
  };
  const event = freezeEvent({ ...payload, contentHash: hash(payload) });
  const events = Object.freeze([...ledger.events, event]);
  const resultPayload = { engineVersion: ledger.engineVersion, market: ledger.market, events, headHash: event.contentHash };
  return Object.freeze({ ...resultPayload, contentHash: hash(resultPayload) });
};

export const createFundingPersistencePaperLedger = (engineVersion: number, market: string): FundingPersistencePaperLedger => {
  if (!Number.isInteger(engineVersion) || engineVersion < 1) throw new Error("engineVersion must be a positive integer");
  if (!market.trim()) throw new Error("market is required");
  const payload = { engineVersion, market: market.trim(), events: Object.freeze([] as FundingPersistencePaperEvent[]), headHash: null };
  return Object.freeze({ ...payload, contentHash: hash(payload) });
};

export const verifyFundingPersistencePaperLedger = (ledger: FundingPersistencePaperLedger): void => {
  if (!SHA256.test(ledger.contentHash)) throw new Error("ledger contentHash is invalid");
  let previousHash: string | null = null;
  const eventIds = new Set<string>();
  for (let index = 0; index < ledger.events.length; index += 1) {
    const event = ledger.events[index];
    if (!event) throw new Error("ledger event missing");
    if (event.sequence !== index + 1) throw new Error("ledger sequence is invalid");
    if (eventIds.has(event.eventId)) throw new Error(`duplicate event ${event.eventId}`);
    eventIds.add(event.eventId);
    if (event.previousHash !== previousHash) throw new Error("ledger hash chain is broken");
    const { contentHash, ...payload } = event;
    if (hash(payload) !== contentHash) throw new Error("event contentHash mismatch");
    previousHash = contentHash;
  }
  if (ledger.headHash !== previousHash) throw new Error("ledger headHash mismatch");
  const { contentHash, ...payload } = ledger;
  if (hash(payload) !== contentHash) throw new Error("ledger contentHash mismatch");
};

export const replayFundingPersistencePaperLedger = (
  ledger: FundingPersistencePaperLedger
): { readonly orders: readonly FundingPersistencePaperOrder[]; readonly replayHash: string } => {
  verifyFundingPersistencePaperLedger(ledger);
  const orders = new Map<string, FundingPersistencePaperOrder>();
  for (const event of ledger.events) {
    const existing = orders.get(event.orderId);
    if (event.type === "ORDER_CREATED") {
      orders.set(event.orderId, Object.freeze({
        orderId: event.orderId,
        decisionId: event.reason,
        market: ledger.market,
        side: "BUY",
        requestedQuantity: event.quantity ?? 0,
        filledQuantity: 0,
        averageFillPrice: null,
        state: "NEW",
        createdAt: event.occurredAt,
        updatedAt: event.occurredAt
      }));
      continue;
    }
    if (!existing) throw new Error("replay encountered missing order");
    let filledQuantity = existing.filledQuantity;
    let averageFillPrice = existing.averageFillPrice;
    if (event.type === "ORDER_PARTIALLY_FILLED" || event.type === "ORDER_FILLED") {
      const nextQuantity = event.quantity ?? 0;
      const nextPrice = event.price ?? 0;
      const totalCost = (averageFillPrice ?? 0) * filledQuantity + nextPrice * nextQuantity;
      filledQuantity = round(filledQuantity + nextQuantity);
      averageFillPrice = round(totalCost / filledQuantity);
    }
    orders.set(event.orderId, Object.freeze({
      ...existing,
      filledQuantity,
      averageFillPrice,
      state: stateByEvent[event.type],
      updatedAt: event.occurredAt
    }));
  }
  const result = Object.freeze([...orders.values()].sort((a, b) => a.orderId.localeCompare(b.orderId)));
  return Object.freeze({ orders: result, replayHash: hash(result) });
};

export const createFundingPersistencePaperDailyReport = (
  ledger: FundingPersistencePaperLedger,
  reportDate: string
): FundingPersistencePaperDailyReport => {
  verifyFundingPersistencePaperLedger(ledger);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(reportDate)) throw new Error("reportDate must be YYYY-MM-DD");
  const events = ledger.events.filter((event) => event.occurredAt.slice(0, 10) === reportDate);
  const count = (type: FundingPersistencePaperEventType): number => events.filter((event) => event.type === type).length;
  const gross = events.reduce((sum, event) => sum + event.realizedPnl, 0);
  const fees = events.reduce((sum, event) => sum + event.fee, 0);
  const slippage = events.reduce((sum, event) => sum + event.slippageCost, 0);
  const payload = {
    reportDate,
    market: ledger.market,
    createdOrders: count("ORDER_CREATED"),
    filledOrders: count("ORDER_FILLED"),
    rejectedOrders: count("ORDER_REJECTED"),
    cancelledOrders: count("ORDER_CANCELLED"),
    closedPositions: count("POSITION_CLOSED"),
    grossRealizedPnl: round(gross),
    fees: round(fees),
    slippageCost: round(slippage),
    netRealizedPnl: round(gross - fees - slippage),
    tradedQuantity: round(events.reduce((sum, event) => sum + (event.quantity ?? 0), 0)),
    ledgerHeadHash: ledger.headHash
  };
  return Object.freeze({ ...payload, contentHash: hash(payload) });
};

export const createFundingPersistenceChampionCandidateReport = (
  ledger: FundingPersistencePaperLedger,
  dailyReports: readonly FundingPersistencePaperDailyReport[],
  walkForward: FundingPersistenceWalkForwardSummary,
  stress: FundingPersistenceStressSummary,
  generatedAt: string,
  policy: FundingPersistenceChampionPolicy
): FundingPersistenceChampionCandidateReport => {
  verifyFundingPersistencePaperLedger(ledger);
  parseTime(generatedAt, "generatedAt");
  if (!Number.isInteger(policy.minimumPaperDays) || policy.minimumPaperDays < 1) throw new Error("minimumPaperDays must be positive");
  if (!Number.isInteger(policy.minimumClosedPositions) || policy.minimumClosedPositions < 0) throw new Error("minimumClosedPositions must be non-negative");
  finite(policy.minimumNetRealizedPnl, "minimumNetRealizedPnl");
  finite(policy.maximumRejectedOrderRatio, "maximumRejectedOrderRatio");
  if (policy.maximumRejectedOrderRatio < 0 || policy.maximumRejectedOrderRatio > 1) throw new Error("maximumRejectedOrderRatio must be between 0 and 1");
  const uniqueDays = new Set(dailyReports.map((report) => report.reportDate)).size;
  const createdOrders = dailyReports.reduce((sum, report) => sum + report.createdOrders, 0);
  const rejectedOrders = dailyReports.reduce((sum, report) => sum + report.rejectedOrders, 0);
  const closedPositions = dailyReports.reduce((sum, report) => sum + report.closedPositions, 0);
  const netRealizedPnl = round(dailyReports.reduce((sum, report) => sum + report.netRealizedPnl, 0));
  const rejectedOrderRatio = createdOrders === 0 ? 0 : rejectedOrders / createdOrders;
  const reasons: string[] = [];
  if (uniqueDays < policy.minimumPaperDays) reasons.push("PAPER_DAYS_INSUFFICIENT");
  if (closedPositions < policy.minimumClosedPositions) reasons.push("CLOSED_POSITIONS_INSUFFICIENT");
  if (netRealizedPnl < policy.minimumNetRealizedPnl) reasons.push("NET_REALIZED_PNL_LOW");
  if (rejectedOrderRatio > policy.maximumRejectedOrderRatio) reasons.push("REJECTED_ORDER_RATIO_HIGH");
  if (policy.requireWalkForwardPass && !walkForward.passed) reasons.push("WALK_FORWARD_NOT_PASSED");
  if (policy.requireStressPass && !stress.passed) reasons.push("STRESS_NOT_PASSED");
  if (reasons.length === 0) reasons.push("CHAMPION_CANDIDATE_POLICY_PASSED");
  const payload = {
    generatedAt,
    eligible: reasons.length === 1 && reasons[0] === "CHAMPION_CANDIDATE_POLICY_PASSED",
    reasons: Object.freeze(reasons),
    paperDays: uniqueDays,
    closedPositions,
    netRealizedPnl,
    rejectedOrderRatio: round(rejectedOrderRatio),
    walkForwardPassed: walkForward.passed,
    stressPassed: stress.passed,
    ledgerHeadHash: ledger.headHash
  };
  return Object.freeze({ ...payload, contentHash: hash(payload) });
};
