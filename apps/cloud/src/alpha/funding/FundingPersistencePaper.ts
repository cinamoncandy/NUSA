import { createHash } from "node:crypto";
import type { FundingPersistenceStressSummary } from "./FundingPersistenceStress";
import type { FundingPersistenceWalkForwardResult } from "./FundingPersistenceWalkForward";

export type FundingPersistencePaperOrderState = "NEW" | "QUEUED" | "ACCEPTED" | "PARTIAL_FILL" | "FILLED" | "CANCELLED" | "REJECTED" | "CLOSED" | "ARCHIVED";
export type FundingPersistencePaperEventType = "ORDER_CREATED" | "ORDER_QUEUED" | "ORDER_ACCEPTED" | "ORDER_PARTIALLY_FILLED" | "ORDER_FILLED" | "ORDER_CANCELLED" | "ORDER_REJECTED" | "POSITION_CLOSED" | "ORDER_ARCHIVED";

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

export interface FundingPersistencePaperOrderSnapshot {
  readonly orderId: string;
  readonly state: FundingPersistencePaperOrderState;
  readonly requestedQuantity: number;
  readonly filledQuantity: number;
  readonly averageFillPrice: number | null;
  readonly updatedAt: string;
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

export interface AppendFundingPersistencePaperEventInput {
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

const SHA256 = /^[a-f0-9]{64}$/;
const round = (value: number): number => Math.round(value * 1_000_000_000) / 1_000_000_000;
const finite = (value: number, label: string): void => { if (!Number.isFinite(value)) throw new Error(`${label} must be finite`); };
const parseTime = (value: string, label: string): number => { const parsed = Date.parse(value); if (!Number.isFinite(parsed)) throw new Error(`${label} must be a valid ISO timestamp`); return parsed; };
const canonical = (value: unknown): string => {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(",")}}`;
};
const hash = (value: unknown): string => createHash("sha256").update(canonical(value)).digest("hex");

const nextState: Readonly<Record<FundingPersistencePaperEventType, FundingPersistencePaperOrderState>> = Object.freeze({
  ORDER_CREATED: "NEW", ORDER_QUEUED: "QUEUED", ORDER_ACCEPTED: "ACCEPTED", ORDER_PARTIALLY_FILLED: "PARTIAL_FILL", ORDER_FILLED: "FILLED", ORDER_CANCELLED: "CANCELLED", ORDER_REJECTED: "REJECTED", POSITION_CLOSED: "CLOSED", ORDER_ARCHIVED: "ARCHIVED"
});
const allowedFrom: Readonly<Record<FundingPersistencePaperEventType, readonly FundingPersistencePaperOrderState[]>> = Object.freeze({
  ORDER_CREATED: Object.freeze([] as FundingPersistencePaperOrderState[]), ORDER_QUEUED: Object.freeze(["NEW"]), ORDER_ACCEPTED: Object.freeze(["QUEUED"]), ORDER_PARTIALLY_FILLED: Object.freeze(["ACCEPTED", "PARTIAL_FILL"]), ORDER_FILLED: Object.freeze(["ACCEPTED", "PARTIAL_FILL"]), ORDER_CANCELLED: Object.freeze(["NEW", "QUEUED", "ACCEPTED", "PARTIAL_FILL"]), ORDER_REJECTED: Object.freeze(["NEW", "QUEUED"]), POSITION_CLOSED: Object.freeze(["FILLED"]), ORDER_ARCHIVED: Object.freeze(["CANCELLED", "REJECTED", "CLOSED"])
});

export const createFundingPersistencePaperLedger = (engineVersion: number, market: string): FundingPersistencePaperLedger => {
  if (!Number.isInteger(engineVersion) || engineVersion < 1) throw new Error("engineVersion must be a positive integer");
  if (!market.trim()) throw new Error("market is required");
  const payload: Omit<FundingPersistencePaperLedger, "contentHash"> = { engineVersion, market: market.trim(), events: Object.freeze([] as FundingPersistencePaperEvent[]), headHash: null };
  return Object.freeze({ ...payload, contentHash: hash(payload) });
};

export const verifyFundingPersistencePaperLedger = (ledger: FundingPersistencePaperLedger): void => {
  if (!SHA256.test(ledger.contentHash)) throw new Error("ledger contentHash is invalid");
  const ids = new Set<string>();
  let previous: string | null = null;
  for (let index = 0; index < ledger.events.length; index += 1) {
    const event = ledger.events[index];
    if (!event) throw new Error("ledger event missing");
    if (event.sequence !== index + 1) throw new Error("ledger sequence is invalid");
    if (ids.has(event.eventId)) throw new Error(`duplicate event ${event.eventId}`);
    ids.add(event.eventId);
    if (event.previousHash !== previous) throw new Error("ledger hash chain is broken");
    const { contentHash, ...payload } = event;
    if (hash(payload) !== contentHash) throw new Error("event contentHash mismatch");
    previous = contentHash;
  }
  if (ledger.headHash !== previous) throw new Error("ledger headHash mismatch");
  const { contentHash, ...payload } = ledger;
  if (hash(payload) !== contentHash) throw new Error("ledger contentHash mismatch");
};

export const replayFundingPersistencePaperLedger = (ledger: FundingPersistencePaperLedger): { readonly orders: readonly FundingPersistencePaperOrderSnapshot[]; readonly replayHash: string } => {
  verifyFundingPersistencePaperLedger(ledger);
  const orders = new Map<string, FundingPersistencePaperOrderSnapshot>();
  for (const event of ledger.events) {
    const current = orders.get(event.orderId);
    if (event.type === "ORDER_CREATED") {
      if (current) throw new Error("duplicate order creation");
      const created: FundingPersistencePaperOrderSnapshot = Object.freeze({ orderId: event.orderId, state: "NEW", requestedQuantity: event.quantity ?? 0, filledQuantity: 0, averageFillPrice: null, updatedAt: event.occurredAt });
      orders.set(event.orderId, created);
      continue;
    }
    if (!current) throw new Error("order does not exist");
    if (!allowedFrom[event.type].includes(current.state)) throw new Error(`invalid transition ${current.state} -> ${event.type}`);
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
    const updated: FundingPersistencePaperOrderSnapshot = Object.freeze({ ...current, state: nextState[event.type], filledQuantity, averageFillPrice, updatedAt: event.occurredAt });
    orders.set(event.orderId, updated);
  }
  const snapshots: readonly FundingPersistencePaperOrderSnapshot[] = Object.freeze([...orders.values()].sort((a, b) => a.orderId.localeCompare(b.orderId)));
  return Object.freeze({ orders: snapshots, replayHash: hash(snapshots) });
};

export const appendFundingPersistencePaperEvent = (ledger: FundingPersistencePaperLedger, input: AppendFundingPersistencePaperEventInput): FundingPersistencePaperLedger => {
  verifyFundingPersistencePaperLedger(ledger);
  if (!input.eventId.trim() || !input.orderId.trim() || !input.reason.trim()) throw new Error("eventId, orderId, and reason are required");
  if (ledger.events.some((event) => event.eventId === input.eventId)) throw new Error(`duplicate event ${input.eventId}`);
  parseTime(input.occurredAt, "occurredAt");
  const quantity = input.quantity ?? null;
  const price = input.price ?? null;
  const fee = input.fee ?? 0;
  const slippageCost = input.slippageCost ?? 0;
  const realizedPnl = input.realizedPnl ?? 0;
  if (quantity !== null) { finite(quantity, "quantity"); if (quantity <= 0) throw new Error("quantity must be positive"); }
  if (price !== null) { finite(price, "price"); if (price <= 0) throw new Error("price must be positive"); }
  for (const [label, value] of [["fee", fee], ["slippageCost", slippageCost], ["realizedPnl", realizedPnl]] as const) finite(value, label);
  if (fee < 0 || slippageCost < 0) throw new Error("fee and slippageCost must be non-negative");
  if ((input.type === "ORDER_PARTIALLY_FILLED" || input.type === "ORDER_FILLED") && (quantity === null || price === null)) throw new Error("fill events require quantity and price");
  const current = replayFundingPersistencePaperLedger(ledger).orders.find((order) => order.orderId === input.orderId);
  if (input.type === "ORDER_CREATED") { if (current) throw new Error("ORDER_CREATED requires a new orderId"); if (quantity === null) throw new Error("ORDER_CREATED requires requested quantity"); }
  else { if (!current) throw new Error("order does not exist"); if (!allowedFrom[input.type].includes(current.state)) throw new Error(`invalid transition ${current.state} -> ${input.type}`); }
  const payload: Omit<FundingPersistencePaperEvent, "contentHash"> = { eventId: input.eventId.trim(), sequence: ledger.events.length + 1, orderId: input.orderId.trim(), type: input.type, occurredAt: input.occurredAt, quantity: quantity === null ? null : round(quantity), price: price === null ? null : round(price), fee: round(fee), slippageCost: round(slippageCost), realizedPnl: round(realizedPnl), reason: input.reason.trim(), previousHash: ledger.headHash };
  const event: FundingPersistencePaperEvent = Object.freeze({ ...payload, contentHash: hash(payload) });
  const events: readonly FundingPersistencePaperEvent[] = Object.freeze([...ledger.events, event]);
  const resultPayload: Omit<FundingPersistencePaperLedger, "contentHash"> = { engineVersion: ledger.engineVersion, market: ledger.market, events, headHash: event.contentHash };
  const result: FundingPersistencePaperLedger = Object.freeze({ ...resultPayload, contentHash: hash(resultPayload) });
  replayFundingPersistencePaperLedger(result);
  return result;
};

export const createFundingPersistencePaperDailyReport = (ledger: FundingPersistencePaperLedger, reportDate: string): FundingPersistencePaperDailyReport => {
  verifyFundingPersistencePaperLedger(ledger);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(reportDate)) throw new Error("reportDate must be YYYY-MM-DD");
  const events = ledger.events.filter((event) => event.occurredAt.slice(0, 10) === reportDate);
  const count = (type: FundingPersistencePaperEventType): number => events.filter((event) => event.type === type).length;
  const gross = events.reduce((sum, event) => sum + event.realizedPnl, 0);
  const fees = events.reduce((sum, event) => sum + event.fee, 0);
  const slippage = events.reduce((sum, event) => sum + event.slippageCost, 0);
  const payload: Omit<FundingPersistencePaperDailyReport, "contentHash"> = { reportDate, market: ledger.market, createdOrders: count("ORDER_CREATED"), filledOrders: count("ORDER_FILLED"), rejectedOrders: count("ORDER_REJECTED"), cancelledOrders: count("ORDER_CANCELLED"), closedPositions: count("POSITION_CLOSED"), grossRealizedPnl: round(gross), fees: round(fees), slippageCost: round(slippage), netRealizedPnl: round(gross - fees - slippage), tradedQuantity: round(events.reduce((sum, event) => sum + (event.quantity ?? 0), 0)), ledgerHeadHash: ledger.headHash };
  return Object.freeze({ ...payload, contentHash: hash(payload) });
};

export const createFundingPersistenceChampionCandidateReport = (ledger: FundingPersistencePaperLedger, dailyReports: readonly FundingPersistencePaperDailyReport[], walkForward: FundingPersistenceWalkForwardResult, stress: FundingPersistenceStressSummary, generatedAt: string, policy: FundingPersistenceChampionPolicy): FundingPersistenceChampionCandidateReport => {
  verifyFundingPersistencePaperLedger(ledger);
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
  const payload: Omit<FundingPersistenceChampionCandidateReport, "contentHash"> = { generatedAt, eligible: reasons.length === 1 && reasons[0] === "CHAMPION_CANDIDATE_POLICY_PASSED", reasons: Object.freeze(reasons), paperDays, closedPositions, netRealizedPnl, rejectedOrderRatio: round(rejectedOrderRatio), walkForwardPassed: walkForward.aggregate.passed, stressPassed: stress.passed, ledgerHeadHash: ledger.headHash };
  return Object.freeze({ ...payload, contentHash: hash(payload) });
};
