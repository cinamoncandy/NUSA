import { createHash } from "node:crypto";
import { DecisionAction } from "./decision";
import {
  DecisionExecutionAuthorization,
  DecisionExecutionMode,
  verifyDecisionExecutionAuthorization
} from "./decisionAuthorization";
import { DecisionAuditEnvelope } from "./decisionAudit";

export interface DecisionExecutionIntent {
  readonly intentId: string;
  readonly idempotencyKey: string;
  readonly authorizationId: string;
  readonly authorizationChecksum: string;
  readonly decisionId: string;
  readonly auditChecksum: string;
  readonly mode: DecisionExecutionMode.PAPER;
  readonly market: string;
  readonly action: DecisionAction.LONG | DecisionAction.SHORT | DecisionAction.EXIT;
  readonly quantity: string;
  readonly createdAt: string;
  readonly checksum: string;
}

export interface CreateDecisionExecutionIntentInput {
  readonly intentId: string;
  readonly authorization: DecisionExecutionAuthorization;
  readonly envelope: DecisionAuditEnvelope;
  readonly quantity: string;
  readonly createdAt: string;
}

function requireText(value: string, name: string): string {
  if (typeof value !== "string" || value.trim() === "") throw new Error(`${name} is required`);
  return value;
}

function normalizeQuantity(value: string): string {
  const quantity = requireText(value, "quantity").trim();
  if (!/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(quantity)) throw new Error("quantity must be a positive decimal string");
  const numeric = Number(quantity);
  if (!Number.isFinite(numeric) || numeric <= 0) throw new Error("quantity must be positive");
  return quantity;
}

function canonicalIntent(value: Omit<DecisionExecutionIntent, "checksum">): string {
  return JSON.stringify({
    action: value.action,
    auditChecksum: value.auditChecksum,
    authorizationChecksum: value.authorizationChecksum,
    authorizationId: value.authorizationId,
    createdAt: value.createdAt,
    decisionId: value.decisionId,
    idempotencyKey: value.idempotencyKey,
    intentId: value.intentId,
    market: value.market,
    mode: value.mode,
    quantity: value.quantity
  });
}

function checksumIntent(value: Omit<DecisionExecutionIntent, "checksum">): string {
  return createHash("sha256").update(canonicalIntent(value), "utf8").digest("hex");
}

function makeIdempotencyKey(authorization: DecisionExecutionAuthorization): string {
  return createHash("sha256")
    .update(`${authorization.decisionId}:${authorization.authorizationId}:${authorization.nonce}`, "utf8")
    .digest("hex");
}

export function createDecisionExecutionIntent(input: CreateDecisionExecutionIntentInput): DecisionExecutionIntent {
  const createdAt = requireText(input.createdAt, "createdAt");
  if (!verifyDecisionExecutionAuthorization(input.authorization, input.envelope, createdAt)) {
    throw new Error("decision execution authorization is invalid or expired");
  }

  const unsigned = Object.freeze({
    intentId: requireText(input.intentId, "intentId"),
    idempotencyKey: makeIdempotencyKey(input.authorization),
    authorizationId: input.authorization.authorizationId,
    authorizationChecksum: input.authorization.checksum,
    decisionId: input.authorization.decisionId,
    auditChecksum: input.authorization.auditChecksum,
    mode: DecisionExecutionMode.PAPER,
    market: input.authorization.market,
    action: input.authorization.action,
    quantity: normalizeQuantity(input.quantity),
    createdAt
  });

  return Object.freeze({ ...unsigned, checksum: checksumIntent(unsigned) });
}

export function verifyDecisionExecutionIntent(
  intent: DecisionExecutionIntent,
  authorization: DecisionExecutionAuthorization,
  envelope: DecisionAuditEnvelope,
  now: string
): boolean {
  if (!verifyDecisionExecutionAuthorization(authorization, envelope, now)) return false;
  if (intent.mode !== DecisionExecutionMode.PAPER) return false;
  if (intent.authorizationId !== authorization.authorizationId) return false;
  if (intent.authorizationChecksum !== authorization.checksum) return false;
  if (intent.decisionId !== authorization.decisionId) return false;
  if (intent.auditChecksum !== authorization.auditChecksum) return false;
  if (intent.market !== authorization.market || intent.action !== authorization.action) return false;
  if (intent.idempotencyKey !== makeIdempotencyKey(authorization)) return false;
  try {
    normalizeQuantity(intent.quantity);
  } catch {
    return false;
  }
  return intent.checksum === checksumIntent(intent);
}

export function assertUniqueDecisionExecutionIntent(
  existing: readonly DecisionExecutionIntent[],
  candidate: DecisionExecutionIntent
): void {
  if (existing.some((intent) => intent.intentId === candidate.intentId)) {
    throw new Error("duplicate execution intent id");
  }
  if (existing.some((intent) => intent.idempotencyKey === candidate.idempotencyKey)) {
    throw new Error("authorization has already produced an execution intent");
  }
}
