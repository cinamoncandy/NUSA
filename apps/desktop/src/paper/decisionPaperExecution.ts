import {
  DecisionAction,
  DecisionAuditEnvelope,
  DecisionExecutionAuthorization,
  DecisionExecutionIntent,
  DecisionExecutionReceipt,
  DecisionExecutionReceiptStatus,
  assertUniqueDecisionExecutionReceipt,
  createDecisionExecutionReceipt,
  verifyDecisionExecutionIntent
} from "../../../../packages/contracts/src";
import { PaperBroker, PaperOrder, PaperSide } from "./paperBroker";

export interface ExecuteSpotPaperDecisionInput {
  readonly broker: PaperBroker;
  readonly envelope: DecisionAuditEnvelope;
  readonly authorization: DecisionExecutionAuthorization;
  readonly intent: DecisionExecutionIntent;
  readonly markPrice: number;
  readonly now: Date;
  readonly existingReceipts?: readonly DecisionExecutionReceipt[];
}

export interface SpotPaperDecisionExecution {
  readonly order: PaperOrder;
  readonly receipt: DecisionExecutionReceipt;
}

function sideForSpotAction(action: DecisionAction): PaperSide {
  if (action === DecisionAction.LONG) return "BUY";
  if (action === DecisionAction.EXIT) return "SELL";
  if (action === DecisionAction.SHORT) throw new Error("SHORT is not supported by the spot Paper broker");
  throw new Error(`decision action ${action} is not executable on spot Paper trading`);
}

function assertIntentUnused(existing: readonly DecisionExecutionReceipt[], intent: DecisionExecutionIntent): void {
  if (existing.some((receipt) => receipt.intentId === intent.intentId)) {
    throw new Error("execution intent already has a receipt");
  }
  if (existing.some((receipt) => receipt.idempotencyKey === intent.idempotencyKey)) {
    throw new Error("idempotency key already recorded");
  }
}

export function executeSpotPaperDecision(input: ExecuteSpotPaperDecisionInput): SpotPaperDecisionExecution {
  const nowIso = input.now.toISOString();
  if (!verifyDecisionExecutionIntent(input.intent, input.authorization, input.envelope, nowIso)) {
    throw new Error("decision execution intent is invalid or expired");
  }
  if (input.intent.market !== input.envelope.record.market) throw new Error("decision market mismatch");
  if (!Number.isFinite(input.markPrice) || input.markPrice <= 0) throw new Error("markPrice must be positive");

  const existingReceipts = input.existingReceipts ?? [];
  assertIntentUnused(existingReceipts, input.intent);

  const quantity = Number(input.intent.quantity);
  if (!Number.isFinite(quantity) || quantity <= 0) throw new Error("intent quantity must be positive");

  const side = sideForSpotAction(input.intent.action);
  const order = input.broker.execute(side, quantity, input.markPrice, input.now);
  const receipt = createDecisionExecutionReceipt({
    receiptId: `receipt:${input.intent.intentId}:${order.id}`,
    intent: input.intent,
    status: DecisionExecutionReceiptStatus.FILLED,
    paperOrderId: order.id,
    paperFillIds: [`fill:${order.id}`],
    filledQuantity: order.quantity.toString(),
    recordedAt: order.filledAt
  });

  assertUniqueDecisionExecutionReceipt(existingReceipts, receipt);
  return Object.freeze({ order, receipt });
}
