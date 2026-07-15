import { createHash } from "node:crypto";
import { DecisionExecutionMode } from "./decisionAuthorization";
import { DecisionExecutionIntent } from "./decisionExecutionIntent";

export enum DecisionExecutionReceiptStatus {
  ACCEPTED = "ACCEPTED",
  PARTIALLY_FILLED = "PARTIALLY_FILLED",
  FILLED = "FILLED",
  REJECTED = "REJECTED",
  CANCELLED = "CANCELLED"
}

export interface DecisionExecutionReceipt {
  readonly receiptId: string;
  readonly intentId: string;
  readonly intentChecksum: string;
  readonly idempotencyKey: string;
  readonly decisionId: string;
  readonly mode: DecisionExecutionMode.PAPER;
  readonly market: string;
  readonly status: DecisionExecutionReceiptStatus;
  readonly paperOrderId?: string;
  readonly paperFillIds: readonly string[];
  readonly requestedQuantity: string;
  readonly filledQuantity: string;
  readonly reason?: string;
  readonly recordedAt: string;
  readonly checksum: string;
}

export interface CreateDecisionExecutionReceiptInput {
  readonly receiptId: string;
  readonly intent: DecisionExecutionIntent;
  readonly status: DecisionExecutionReceiptStatus;
  readonly paperOrderId?: string;
  readonly paperFillIds?: readonly string[];
  readonly filledQuantity: string;
  readonly reason?: string;
  readonly recordedAt: string;
}

function requireText(value: string, name: string): string {
  if (typeof value !== "string" || value.trim() === "") throw new Error(`${name} is required`);
  return value;
}

function normalizeQuantity(value: string, name: string): string {
  const quantity = requireText(value, name).trim();
  if (!/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(quantity)) throw new Error(`${name} must be a decimal string`);
  const numeric = Number(quantity);
  if (!Number.isFinite(numeric) || numeric < 0) throw new Error(`${name} must be non-negative`);
  return quantity;
}

function canonicalReceipt(value: Omit<DecisionExecutionReceipt, "checksum">): string {
  return JSON.stringify({
    decisionId: value.decisionId,
    filledQuantity: value.filledQuantity,
    idempotencyKey: value.idempotencyKey,
    intentChecksum: value.intentChecksum,
    intentId: value.intentId,
    market: value.market,
    mode: value.mode,
    paperFillIds: value.paperFillIds,
    paperOrderId: value.paperOrderId,
    reason: value.reason,
    receiptId: value.receiptId,
    recordedAt: value.recordedAt,
    requestedQuantity: value.requestedQuantity,
    status: value.status
  });
}

function checksumReceipt(value: Omit<DecisionExecutionReceipt, "checksum">): string {
  return createHash("sha256").update(canonicalReceipt(value), "utf8").digest("hex");
}

function validateStatusFields(input: CreateDecisionExecutionReceiptInput, filledQuantity: string): void {
  const filled = Number(filledQuantity);
  const requested = Number(input.intent.quantity);
  if (filled > requested) throw new Error("filledQuantity cannot exceed requestedQuantity");

  if (input.status === DecisionExecutionReceiptStatus.FILLED && filled !== requested) {
    throw new Error("FILLED requires the requested quantity to be fully filled");
  }
  if (input.status === DecisionExecutionReceiptStatus.PARTIALLY_FILLED && !(filled > 0 && filled < requested)) {
    throw new Error("PARTIALLY_FILLED requires a positive partial quantity");
  }
  if ((input.status === DecisionExecutionReceiptStatus.REJECTED || input.status === DecisionExecutionReceiptStatus.CANCELLED) && filled !== 0) {
    throw new Error(`${input.status} requires zero filled quantity`);
  }
  if (input.status === DecisionExecutionReceiptStatus.ACCEPTED && filled !== 0) {
    throw new Error("ACCEPTED requires zero filled quantity");
  }
  if ((input.status === DecisionExecutionReceiptStatus.REJECTED || input.status === DecisionExecutionReceiptStatus.CANCELLED) && !input.reason?.trim()) {
    throw new Error(`${input.status} requires a reason`);
  }
}

export function createDecisionExecutionReceipt(input: CreateDecisionExecutionReceiptInput): DecisionExecutionReceipt {
  const filledQuantity = normalizeQuantity(input.filledQuantity, "filledQuantity");
  validateStatusFields(input, filledQuantity);
  const paperFillIds = [...new Set((input.paperFillIds ?? []).map((id) => requireText(id, "paperFillId")))];
  if (paperFillIds.length !== (input.paperFillIds ?? []).length) throw new Error("duplicate paper fill id");
  if (Number(filledQuantity) > 0 && paperFillIds.length === 0) throw new Error("filled receipt requires at least one paper fill id");

  const unsigned = Object.freeze({
    receiptId: requireText(input.receiptId, "receiptId"),
    intentId: input.intent.intentId,
    intentChecksum: input.intent.checksum,
    idempotencyKey: input.intent.idempotencyKey,
    decisionId: input.intent.decisionId,
    mode: DecisionExecutionMode.PAPER,
    market: input.intent.market,
    status: input.status,
    paperOrderId: input.paperOrderId == null ? undefined : requireText(input.paperOrderId, "paperOrderId"),
    paperFillIds: Object.freeze(paperFillIds),
    requestedQuantity: input.intent.quantity,
    filledQuantity,
    reason: input.reason?.trim() || undefined,
    recordedAt: requireText(input.recordedAt, "recordedAt")
  });

  return Object.freeze({ ...unsigned, checksum: checksumReceipt(unsigned) });
}

export function verifyDecisionExecutionReceipt(receipt: DecisionExecutionReceipt, intent: DecisionExecutionIntent): boolean {
  if (receipt.mode !== DecisionExecutionMode.PAPER) return false;
  if (receipt.intentId !== intent.intentId || receipt.intentChecksum !== intent.checksum) return false;
  if (receipt.idempotencyKey !== intent.idempotencyKey || receipt.decisionId !== intent.decisionId) return false;
  if (receipt.market !== intent.market || receipt.requestedQuantity !== intent.quantity) return false;
  try {
    const recreated = createDecisionExecutionReceipt({
      receiptId: receipt.receiptId,
      intent,
      status: receipt.status,
      paperOrderId: receipt.paperOrderId,
      paperFillIds: receipt.paperFillIds,
      filledQuantity: receipt.filledQuantity,
      reason: receipt.reason,
      recordedAt: receipt.recordedAt
    });
    return recreated.checksum === receipt.checksum;
  } catch {
    return false;
  }
}

export function assertUniqueDecisionExecutionReceipt(
  existing: readonly DecisionExecutionReceipt[],
  candidate: DecisionExecutionReceipt
): void {
  if (existing.some((receipt) => receipt.receiptId === candidate.receiptId)) throw new Error("duplicate execution receipt id");
  if (existing.some((receipt) => receipt.intentId === candidate.intentId)) throw new Error("execution intent already has a receipt");
  if (existing.some((receipt) => receipt.idempotencyKey === candidate.idempotencyKey)) throw new Error("idempotency key already recorded");
}
