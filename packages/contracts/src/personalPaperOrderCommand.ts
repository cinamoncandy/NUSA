import type { PersonalPaperOrderProjection, PersonalPaperOperationsSnapshot } from "./personalPaperOperations";

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

export function validatePersonalPaperOrderCommand(command: PersonalPaperOrderCommand): PersonalPaperOrderCommand {
  if (command.schemaVersion !== 1) throw new Error("unsupported PAPER order command schemaVersion");
  if (command.authority !== "PAPER_ONLY" || command.productionMutationAllowed !== false) throw new Error("PAPER order authority invariant violated");
  const idempotencyKey = command.idempotencyKey.trim();
  if (idempotencyKey.length < 16 || idempotencyKey.length > 160) throw new Error("idempotencyKey is invalid");
  const market = command.market.trim().toUpperCase();
  if (!/^KRW-[A-Z0-9-]+$/.test(market)) throw new Error("market is invalid");
  if (command.side !== "BUY" && command.side !== "SELL") throw new Error("side is invalid");
  if (command.orderType !== "MARKET" && command.orderType !== "LIMIT") throw new Error("orderType is invalid");
  const quantity = finitePositive(command.quantity, "quantity");
  const limitPrice = command.orderType === "LIMIT" ? finitePositive(command.limitPrice ?? Number.NaN, "limitPrice") : undefined;
  return Object.freeze({
    schemaVersion: 1,
    authority: "PAPER_ONLY",
    productionMutationAllowed: false,
    idempotencyKey,
    market,
    side: command.side,
    orderType: command.orderType,
    quantity,
    ...(limitPrice === undefined ? {} : { limitPrice })
  });
}

export function validatePersonalPaperOrderCommandResult(result: PersonalPaperOrderCommandResult): PersonalPaperOrderCommandResult {
  if (result.schemaVersion !== 1) throw new Error("unsupported PAPER order result schemaVersion");
  if (result.liveAuthority !== "NONE" || result.productionMutationAllowed !== false) throw new Error("PAPER order result authority invariant violated");
  if (!["FILLED", "REJECTED", "BLOCKED", "DUPLICATE"].includes(result.status)) throw new Error("PAPER order result status is invalid");
  if (result.status === "FILLED" && (result.order == null || result.snapshot == null)) throw new Error("FILLED PAPER order result requires order and snapshot");
  if (result.snapshot != null && (result.snapshot.liveAuthority !== "NONE" || result.snapshot.productionMutationAllowed !== false)) throw new Error("PAPER order snapshot authority invariant violated");
  return Object.freeze({ ...result });
}
