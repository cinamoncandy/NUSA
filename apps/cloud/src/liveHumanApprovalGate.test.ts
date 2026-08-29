import assert from "node:assert/strict";
import test from "node:test";
import { evaluateLiveHumanApproval, fingerprintLiveOrderIntent, type LiveHumanApprovalReceipt, type LiveOrderIntent } from "./liveHumanApprovalGate";

const intent: LiveOrderIntent = {
  intentId: "live-order-1",
  market: "KRW-BTC",
  side: "BUY",
  quantity: 0.001,
  limitPrice: 100_000_000,
  accountFingerprint: "acct-1",
  environmentFingerprint: "env-1",
  createdAt: "2026-08-29T14:00:00.000Z",
};

function receipt(method: "BIOMETRIC" | "PASSWORD" = "BIOMETRIC"): LiveHumanApprovalReceipt {
  return {
    schemaVersion: 1,
    intentFingerprintSha256: fingerprintLiveOrderIntent(intent),
    ownerPrincipalId: "owner-1",
    method,
    userVerified: true,
    issuedAt: "2026-08-29T14:00:05.000Z",
    expiresAt: "2026-08-29T14:01:05.000Z",
    verifierReceiptId: "platform-auth-session-1",
  };
}

test("requires explicit human approval for every exact LIVE order intent", () => {
  const result = evaluateLiveHumanApproval(intent, undefined, "2026-08-29T14:00:10.000Z");
  assert.equal(result.approved, false);
  assert.deepEqual(result.blockers, ["HUMAN_APPROVAL_REQUIRED"]);
  assert.equal(result.liveAuthority, "NONE");
  assert.equal(result.productionMutationAllowed, false);
});

test("accepts a fresh biometric verification receipt but grants no LIVE authority", () => {
  const result = evaluateLiveHumanApproval(intent, receipt(), "2026-08-29T14:00:10.000Z");
  assert.equal(result.approved, true);
  assert.deepEqual(result.blockers, []);
  assert.equal(result.liveAuthority, "NONE");
  assert.equal(result.productionMutationAllowed, false);
});

test("supports password fallback without accepting a password secret", () => {
  const result = evaluateLiveHumanApproval(intent, receipt("PASSWORD"), "2026-08-29T14:00:10.000Z");
  assert.equal(result.approved, true);
  assert.equal("password" in receipt("PASSWORD"), false);
});

test("approval cannot be replayed for a changed quantity", () => {
  const changed = { ...intent, quantity: 0.002 };
  const result = evaluateLiveHumanApproval(changed, receipt(), "2026-08-29T14:00:10.000Z");
  assert.equal(result.approved, false);
  assert.ok(result.blockers.includes("APPROVAL_INTENT_MISMATCH"));
});

test("expired approval fails closed", () => {
  const result = evaluateLiveHumanApproval(intent, receipt(), "2026-08-29T14:02:00.000Z");
  assert.equal(result.approved, false);
  assert.ok(result.blockers.includes("APPROVAL_EXPIRED_OR_INVALID"));
});
