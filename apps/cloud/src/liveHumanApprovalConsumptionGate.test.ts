import assert from "node:assert/strict";
import test from "node:test";
import {
  consumeLiveHumanApprovalReceipt,
  type LiveHumanApprovalConsumptionStore,
} from "./liveHumanApprovalConsumptionGate";
import {
  fingerprintLiveOrderIntent,
  type LiveHumanApprovalReceipt,
  type LiveOrderIntent,
} from "./liveHumanApprovalGate";

const intent: LiveOrderIntent = {
  intentId: "live-order-single-use-1",
  market: "KRW-BTC",
  side: "BUY",
  quantity: 0.001,
  limitPrice: 100_000_000,
  ownerPrincipalId: "owner-1",
  accountFingerprint: "acct-1",
  environmentFingerprint: "env-1",
  createdAt: "2026-08-29T15:00:00.000Z",
};

const approval: LiveHumanApprovalReceipt = {
  schemaVersion: 1,
  intentFingerprintSha256: fingerprintLiveOrderIntent(intent),
  ownerPrincipalId: intent.ownerPrincipalId,
  method: "BIOMETRIC",
  userVerified: true,
  issuedAt: "2026-08-29T15:00:05.000Z",
  expiresAt: "2026-08-29T15:01:05.000Z",
  verifierReceiptId: "platform-auth-session-single-use-1",
};

class MemoryConsumptionStore implements LiveHumanApprovalConsumptionStore {
  readonly consumed = new Set<string>();
  calls = 0;

  async consumeOnce(key: string): Promise<"CONSUMED" | "ALREADY_CONSUMED"> {
    this.calls += 1;
    if (this.consumed.has(key)) return "ALREADY_CONSUMED";
    this.consumed.add(key);
    return "CONSUMED";
  }
}

test("consumes a valid human approval exactly once without granting LIVE authority", async () => {
  const store = new MemoryConsumptionStore();
  const result = await consumeLiveHumanApprovalReceipt(intent, approval, store, "2026-08-29T15:00:10.000Z");

  assert.equal(result.approved, true);
  assert.deepEqual(result.blockers, []);
  assert.match(result.consumptionKeySha256 ?? "", /^[a-f0-9]{64}$/);
  assert.equal(store.calls, 1);
  assert.equal(result.liveAuthority, "NONE");
  assert.equal(result.productionMutationAllowed, false);
});

test("rejects replay of the exact same approval receipt", async () => {
  const store = new MemoryConsumptionStore();
  const first = await consumeLiveHumanApprovalReceipt(intent, approval, store, "2026-08-29T15:00:10.000Z");
  const replay = await consumeLiveHumanApprovalReceipt(intent, approval, store, "2026-08-29T15:00:11.000Z");

  assert.equal(first.approved, true);
  assert.equal(replay.approved, false);
  assert.deepEqual(replay.blockers, ["APPROVAL_ALREADY_CONSUMED"]);
  assert.equal(first.consumptionKeySha256, replay.consumptionKeySha256);
});

test("does not touch consumption storage when approval validation already fails", async () => {
  const store = new MemoryConsumptionStore();
  const changedIntent = { ...intent, quantity: 0.002 };
  const result = await consumeLiveHumanApprovalReceipt(changedIntent, approval, store, "2026-08-29T15:00:10.000Z");

  assert.equal(result.approved, false);
  assert.ok(result.blockers.includes("APPROVAL_INTENT_MISMATCH"));
  assert.equal(result.consumptionKeySha256, null);
  assert.equal(store.calls, 0);
});

test("fails closed when the consumption store reports uncertainty", async () => {
  const store: LiveHumanApprovalConsumptionStore = {
    async consumeOnce() {
      return "FAILED";
    },
  };

  const result = await consumeLiveHumanApprovalReceipt(intent, approval, store, "2026-08-29T15:00:10.000Z");
  assert.equal(result.approved, false);
  assert.deepEqual(result.blockers, ["APPROVAL_CONSUMPTION_UNCERTAIN"]);
});

test("fails closed when the consumption store throws", async () => {
  const store: LiveHumanApprovalConsumptionStore = {
    async consumeOnce() {
      throw new Error("storage unavailable");
    },
  };

  const result = await consumeLiveHumanApprovalReceipt(intent, approval, store, "2026-08-29T15:00:10.000Z");
  assert.equal(result.approved, false);
  assert.deepEqual(result.blockers, ["APPROVAL_CONSUMPTION_UNCERTAIN"]);
});

test("missing approval fails before consumption", async () => {
  const store = new MemoryConsumptionStore();
  const result = await consumeLiveHumanApprovalReceipt(intent, undefined, store, "2026-08-29T15:00:10.000Z");

  assert.equal(result.approved, false);
  assert.deepEqual(result.blockers, ["HUMAN_APPROVAL_REQUIRED"]);
  assert.equal(result.consumptionKeySha256, null);
  assert.equal(store.calls, 0);
});
