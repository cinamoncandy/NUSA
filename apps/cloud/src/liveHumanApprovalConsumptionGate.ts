import { createHash } from "node:crypto";
import {
  evaluateLiveHumanApproval,
  type LiveHumanApprovalReceipt,
  type LiveOrderIntent,
} from "./liveHumanApprovalGate";

export type LiveHumanApprovalConsumptionStoreResult = "CONSUMED" | "ALREADY_CONSUMED" | "FAILED";

export interface LiveHumanApprovalConsumptionStore {
  /**
   * Atomically marks one approval receipt as consumed.
   * Implementations must never turn an existing key back into an unused key.
   */
  consumeOnce(consumptionKeySha256: string): Promise<LiveHumanApprovalConsumptionStoreResult>;
}

export interface LiveHumanApprovalConsumptionResult {
  readonly approved: boolean;
  readonly blockers: readonly string[];
  readonly consumptionKeySha256: string | null;
  readonly liveAuthority: "NONE";
  readonly productionMutationAllowed: false;
}

function fingerprintApprovalConsumption(
  intent: LiveOrderIntent,
  receipt: LiveHumanApprovalReceipt,
): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        intentFingerprintSha256: receipt.intentFingerprintSha256,
        ownerPrincipalId: receipt.ownerPrincipalId,
        verifierReceiptId: receipt.verifierReceiptId,
        issuedAt: receipt.issuedAt,
        expiresAt: receipt.expiresAt,
        intentId: intent.intentId,
      }),
      "utf8",
    )
    .digest("hex");
}

/**
 * Validates and atomically consumes one human approval receipt.
 *
 * The underlying store is the anti-replay authority for receipt consumption. The caller must
 * provide an implementation with atomic insert-if-absent semantics backed by durable state.
 * Any replay or storage uncertainty fails closed. This gate still grants no LIVE authority and
 * performs no broker/exchange mutation.
 */
export async function consumeLiveHumanApprovalReceipt(
  intent: LiveOrderIntent,
  receipt: LiveHumanApprovalReceipt | undefined,
  store: LiveHumanApprovalConsumptionStore,
  nowIso = new Date().toISOString(),
): Promise<LiveHumanApprovalConsumptionResult> {
  const validation = evaluateLiveHumanApproval(intent, receipt, nowIso);
  if (!validation.approved || receipt == null) {
    return Object.freeze({
      approved: false,
      blockers: validation.blockers,
      consumptionKeySha256: null,
      liveAuthority: "NONE",
      productionMutationAllowed: false,
    });
  }

  const consumptionKeySha256 = fingerprintApprovalConsumption(intent, receipt);
  let storeResult: LiveHumanApprovalConsumptionStoreResult;
  try {
    storeResult = await store.consumeOnce(consumptionKeySha256);
  } catch {
    storeResult = "FAILED";
  }

  const blockers: string[] = [];
  if (storeResult === "ALREADY_CONSUMED") blockers.push("APPROVAL_ALREADY_CONSUMED");
  else if (storeResult !== "CONSUMED") blockers.push("APPROVAL_CONSUMPTION_UNCERTAIN");

  return Object.freeze({
    approved: blockers.length === 0,
    blockers: Object.freeze(blockers),
    consumptionKeySha256,
    liveAuthority: "NONE",
    productionMutationAllowed: false,
  });
}
