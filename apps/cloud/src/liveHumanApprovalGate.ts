import { createHash } from "node:crypto";

export type LiveHumanApprovalMethod = "BIOMETRIC" | "PASSWORD";

export interface LiveOrderIntent {
  readonly intentId: string;
  readonly market: string;
  readonly side: "BUY" | "SELL";
  readonly quantity: number;
  readonly limitPrice?: number;
  readonly ownerPrincipalId: string;
  readonly accountFingerprint: string;
  readonly environmentFingerprint: string;
  readonly createdAt: string;
}

export interface LiveHumanApprovalReceipt {
  readonly schemaVersion: 1;
  readonly intentFingerprintSha256: string;
  readonly ownerPrincipalId: string;
  readonly method: LiveHumanApprovalMethod;
  readonly userVerified: true;
  readonly issuedAt: string;
  readonly expiresAt: string;
  /** Opaque verifier-issued challenge/session identity. Never a password or biometric template. */
  readonly verifierReceiptId: string;
}

export interface LiveHumanApprovalResult {
  readonly approved: boolean;
  readonly blockers: readonly string[];
  readonly intentFingerprintSha256: string;
  readonly liveAuthority: "NONE";
  readonly productionMutationAllowed: false;
}

const SHA256 = /^[a-f0-9]{64}$/;

function canonicalIntent(intent: LiveOrderIntent): string {
  return JSON.stringify({
    accountFingerprint: intent.accountFingerprint,
    createdAt: intent.createdAt,
    environmentFingerprint: intent.environmentFingerprint,
    intentId: intent.intentId,
    limitPrice: intent.limitPrice ?? null,
    market: intent.market,
    ownerPrincipalId: intent.ownerPrincipalId,
    quantity: intent.quantity,
    side: intent.side,
  });
}

export function fingerprintLiveOrderIntent(intent: LiveOrderIntent): string {
  return createHash("sha256").update(canonicalIntent(intent), "utf8").digest("hex");
}

/**
 * Validates a human approval receipt against one exact LIVE order intent.
 *
 * This boundary grants no LIVE authority and performs no exchange mutation. A separate,
 * independently governed transport boundary must still verify readiness/risk/activation.
 * Biometric material is deliberately never accepted here: platform authentication must reduce
 * it to an opaque verifier receipt before this function is called.
 */
export function evaluateLiveHumanApproval(
  intent: LiveOrderIntent,
  receipt: LiveHumanApprovalReceipt | undefined,
  nowIso = new Date().toISOString(),
): LiveHumanApprovalResult {
  const blockers: string[] = [];
  if (!intent.intentId.trim()) blockers.push("INTENT_ID_MISSING");
  if (!/^[A-Z0-9]+-[A-Z0-9]+$/.test(intent.market)) blockers.push("MARKET_INVALID");
  if (intent.side !== "BUY" && intent.side !== "SELL") blockers.push("SIDE_INVALID");
  if (!Number.isFinite(intent.quantity) || intent.quantity <= 0) blockers.push("QUANTITY_INVALID");
  if (intent.limitPrice !== undefined && (!Number.isFinite(intent.limitPrice) || intent.limitPrice <= 0)) blockers.push("LIMIT_PRICE_INVALID");
  if (!intent.ownerPrincipalId.trim()) blockers.push("OWNER_PRINCIPAL_MISSING");
  if (!intent.accountFingerprint.trim()) blockers.push("ACCOUNT_FINGERPRINT_MISSING");
  if (!intent.environmentFingerprint.trim()) blockers.push("ENVIRONMENT_FINGERPRINT_MISSING");
  const createdAt = Date.parse(intent.createdAt);
  const now = Date.parse(nowIso);
  if (!Number.isFinite(createdAt)) blockers.push("INTENT_TIME_INVALID");
  if (!Number.isFinite(now)) blockers.push("CURRENT_TIME_INVALID");

  const fingerprint = fingerprintLiveOrderIntent(intent);
  if (receipt == null) blockers.push("HUMAN_APPROVAL_REQUIRED");
  else {
    const issuedAt = Date.parse(receipt.issuedAt);
    const expiresAt = Date.parse(receipt.expiresAt);
    if (receipt.schemaVersion !== 1) blockers.push("APPROVAL_SCHEMA_INVALID");
    if (!SHA256.test(receipt.intentFingerprintSha256) || receipt.intentFingerprintSha256 !== fingerprint) blockers.push("APPROVAL_INTENT_MISMATCH");
    if (!receipt.ownerPrincipalId.trim()) blockers.push("APPROVAL_PRINCIPAL_MISSING");
    else if (receipt.ownerPrincipalId !== intent.ownerPrincipalId) blockers.push("APPROVAL_PRINCIPAL_MISMATCH");
    if (!receipt.verifierReceiptId.trim()) blockers.push("APPROVAL_VERIFIER_RECEIPT_MISSING");
    if (receipt.userVerified !== true) blockers.push("USER_VERIFICATION_REQUIRED");
    if (receipt.method !== "BIOMETRIC" && receipt.method !== "PASSWORD") blockers.push("APPROVAL_METHOD_INVALID");
    if (!Number.isFinite(issuedAt) || !Number.isFinite(expiresAt) || !Number.isFinite(now) || issuedAt > now || now >= expiresAt || expiresAt <= issuedAt) blockers.push("APPROVAL_EXPIRED_OR_INVALID");
    if (Number.isFinite(createdAt) && Number.isFinite(issuedAt) && issuedAt < createdAt) blockers.push("APPROVAL_PREDATES_INTENT");
  }

  return Object.freeze({
    approved: blockers.length === 0,
    blockers: Object.freeze([...new Set(blockers)]),
    intentFingerprintSha256: fingerprint,
    liveAuthority: "NONE",
    productionMutationAllowed: false,
  });
}
