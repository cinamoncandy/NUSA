import {
  validatePersonalPaperOperationsSnapshot,
  type PersonalPaperOrderProjection,
  type PersonalPaperOperationsSnapshot
} from "./personalPaperOperations";

export type PersonalPaperOrderSide = "BUY" | "SELL";
export type PersonalPaperOrderType = "MARKET" | "LIMIT";

export interface PersonalPaperOrderCommand {
  readonly schemaVersion: 1;
  readonly authority: "PAPER_ONLY";
  readonly productionMutationAllowed: false;
  readonly idempotencyKey: string;
  readonly market: string;
  readonly side: PersonalPaperOrderSide;
  readonly orderType: PersonalPaperOrderType;
  readonly quantity: number;
  readonly limitPrice?: number;
}

export interface PersonalPaperOrderCommandResult {
  readonly schemaVersion: 1;
  readonly status: "FILLED" | "REJECTED" | "BLOCKED" | "DUPLICATE";
  readonly idempotencyKey?: string;
  readonly market?: string;
  readonly side?: PersonalPaperOrderSide;
  readonly orderType?: PersonalPaperOrderType;
  readonly quantity?: number;
  readonly limitPrice?: number;
  readonly reason?: string;
  readonly order?: PersonalPaperOrderProjection;
  readonly snapshot?: PersonalPaperOperationsSnapshot;
  readonly liveAuthority: "NONE";
  readonly productionMutationAllowed: false;
}

const finitePositive = (value: number, name: string): number => {
  if (!Number.isFinite(value) || value <= 0) throw new Error(`${name} must be positive`);
  return value;
};

const safeIdempotencyKey = (value: string): string => {
  if (typeof value !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:-]{15,159}$/.test(value)) throw new Error("idempotencyKey is invalid");
  return value;
};

function validateOrderProjection(order: PersonalPaperOrderProjection): PersonalPaperOrderProjection {
  if (!order.id.trim() || !order.market.trim() || (order.side !== "BUY" && order.side !== "SELL") || order.status !== "FILLED" || !Number.isFinite(Date.parse(order.filledAt))) throw new Error("invalid PAPER order projection");
  if (!Number.isFinite(order.quantity) || order.quantity <= 0 || !Number.isFinite(order.price) || order.price <= 0 || !Number.isFinite(order.fee) || order.fee < 0) throw new Error("invalid PAPER order value");
  const fills = order.fills.map((fill) => {
    if (!fill.id.trim() || !Number.isFinite(fill.quantity) || fill.quantity <= 0 || !Number.isFinite(fill.price) || fill.price <= 0 || !Number.isFinite(Date.parse(fill.filledAt))) throw new Error("invalid PAPER fill projection");
    return Object.freeze({ id: fill.id, quantity: fill.quantity, price: fill.price, filledAt: fill.filledAt });
  });
  return Object.freeze({ id: order.id, market: order.market, side: order.side, quantity: order.quantity, price: order.price, fee: order.fee, filledAt: order.filledAt, status: "FILLED", fills: Object.freeze(fills) });
}

const sameOrder = (left: PersonalPaperOrderProjection, right: PersonalPaperOrderProjection): boolean =>
  left.id === right.id && left.market === right.market && left.side === right.side && left.quantity === right.quantity &&
  left.price === right.price && left.fee === right.fee && left.filledAt === right.filledAt && left.status === right.status &&
  left.fills.length === right.fills.length && left.fills.every((fill, index) => {
    const other = right.fills[index];
    return other != null && fill.id === other.id && fill.quantity === other.quantity && fill.price === other.price && fill.filledAt === other.filledAt;
  });

const sameCommandBinding = (result: PersonalPaperOrderCommandResult, command: PersonalPaperOrderCommand): boolean =>
  result.idempotencyKey === command.idempotencyKey && result.market === command.market && result.side === command.side &&
  result.orderType === command.orderType && result.quantity === command.quantity &&
  (command.orderType === "LIMIT" ? result.limitPrice === command.limitPrice : result.limitPrice === undefined);

export function validatePersonalPaperOrderCommand(command: PersonalPaperOrderCommand): PersonalPaperOrderCommand {
  if (command.schemaVersion !== 1) throw new Error("unsupported PAPER order command schemaVersion");
  if (command.authority !== "PAPER_ONLY" || command.productionMutationAllowed !== false) throw new Error("PAPER order authority invariant violated");
  const idempotencyKey = safeIdempotencyKey(command.idempotencyKey);
  const market = command.market.trim().toUpperCase();
  if (!/^KRW-[A-Z0-9-]+$/.test(market)) throw new Error("market is invalid");
  if (command.side !== "BUY" && command.side !== "SELL") throw new Error("side is invalid");
  if (command.orderType !== "MARKET" && command.orderType !== "LIMIT") throw new Error("orderType is invalid");
  const quantity = finitePositive(command.quantity, "quantity");
  const limitPrice = command.orderType === "LIMIT" ? finitePositive(command.limitPrice ?? Number.NaN, "limitPrice") : undefined;
  return Object.freeze({ schemaVersion: 1, authority: "PAPER_ONLY", productionMutationAllowed: false, idempotencyKey, market, side: command.side, orderType: command.orderType, quantity, ...(limitPrice === undefined ? {} : { limitPrice }) });
}

export function validatePersonalPaperOrderCommandResult(
  result: PersonalPaperOrderCommandResult,
  expectedCommand: PersonalPaperOrderCommand,
  now = Date.now(),
  maximumSnapshotAgeMs = 15_000
): PersonalPaperOrderCommandResult {
  const command = validatePersonalPaperOrderCommand(expectedCommand);
  if (result.schemaVersion !== 1) throw new Error("unsupported PAPER order result schemaVersion");
  if (result.liveAuthority !== "NONE" || result.productionMutationAllowed !== false) throw new Error("PAPER order result authority invariant violated");
  if (!["FILLED", "REJECTED", "BLOCKED", "DUPLICATE"].includes(result.status)) throw new Error("PAPER order result status is invalid");
  if (result.idempotencyKey == null) throw new Error("PAPER order result command binding is missing");
  safeIdempotencyKey(result.idempotencyKey);
  if (!sameCommandBinding(result, command)) throw new Error("PAPER order result command binding mismatch");

  const reason = result.reason;
  if (reason != null && (typeof reason !== "string" || !reason.trim())) throw new Error("PAPER order result reason is invalid");
  const snapshot = result.snapshot == null ? undefined : validatePersonalPaperOperationsSnapshot(result.snapshot, now, maximumSnapshotAgeMs);

  let order: PersonalPaperOrderProjection | undefined;
  if (result.order != null) {
    const validatedOrder = validateOrderProjection(result.order);
    if (snapshot != null) {
      const corresponding = snapshot.orders.find((candidate) => candidate.id === validatedOrder.id);
      if (corresponding == null || !sameOrder(validatedOrder, corresponding)) throw new Error("PAPER order result does not match snapshot order");
      order = corresponding;
    } else {
      order = validatedOrder;
    }
    if (order.market !== command.market || order.side !== command.side || order.quantity !== command.quantity) throw new Error("PAPER order result does not match submitted command");
  }

  if (result.status === "FILLED" && (order == null || snapshot == null)) throw new Error("FILLED PAPER order result requires order and snapshot");
  if (result.status === "DUPLICATE" && order == null) throw new Error("DUPLICATE PAPER order result requires prior order");

  return Object.freeze({ schemaVersion: 1, status: result.status, idempotencyKey: command.idempotencyKey, market: command.market, side: command.side, orderType: command.orderType, quantity: command.quantity, ...(command.limitPrice === undefined ? {} : { limitPrice: command.limitPrice }), ...(reason == null ? {} : { reason: reason.trim() }), ...(order == null ? {} : { order }), ...(snapshot == null ? {} : { snapshot }), liveAuthority: "NONE", productionMutationAllowed: false });
}
