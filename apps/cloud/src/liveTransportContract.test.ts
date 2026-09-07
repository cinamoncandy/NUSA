import assert from "node:assert/strict";
import test from "node:test";
import { LiveExecutionConsumeOnce, type ConsumeOnceTransaction } from "./liveExecutionConsumeOnce";
import { prepareLiveTransportRequest } from "./liveTransportContract";
import type { LiveAutonomousPreExecutionEnvelope } from "./liveAutonomousPreExecutionGate";

class MemoryTransaction implements ConsumeOnceTransaction {
  public constructor(private readonly values: Map<string, unknown>) {}
  public async get<T>(key: string): Promise<T | undefined> { return this.values.get(key) as T | undefined; }
  public async put<T>(key: string, value: T): Promise<void> { this.values.set(key, value); }
}

class MemoryStorage {
  private readonly values = new Map<string, unknown>();
  public async transaction<T>(callback: (transaction: ConsumeOnceTransaction) => Promise<T>): Promise<T> {
    return callback(new MemoryTransaction(this.values));
  }
}

const envelope: LiveAutonomousPreExecutionEnvelope = Object.freeze({
  schemaVersion: 1,
  status: "READY",
  liveAuthority: "NONE",
  productionMutationAllowed: false,
  ownerPrincipalId: "owner-1",
  market: "BTC-USD",
  side: "BUY",
  requestedNotionalUsd: 100,
  ownerCapitalCeilingUsd: 500,
  riskApprovedNotionalUsd: 250,
  maxAuthorizedNotionalUsd: 250,
  issuedAt: 1_000,
  expiresAt: 2_000,
  authorizationFingerprintSha256: "a".repeat(64),
  blockers: Object.freeze([]),
});

test("prepares a transport request only after one-time consumption", async () => {
  const consumer = new LiveExecutionConsumeOnce(new MemoryStorage());
  const result = await prepareLiveTransportRequest(envelope, consumer, 1_100);
  assert.deepEqual(result, {
    status: "READY",
    request: {
      ownerPrincipalId: "owner-1",
      market: "BTC-USD",
      side: "BUY",
      requestedNotionalUsd: 100,
      authorizationFingerprintSha256: "a".repeat(64),
    },
  });
});

test("prevents a second transport preparation for the same fingerprint", async () => {
  const consumer = new LiveExecutionConsumeOnce(new MemoryStorage());
  assert.equal((await prepareLiveTransportRequest(envelope, consumer, 1_100)).status, "READY");
  assert.deepEqual(await prepareLiveTransportRequest(envelope, consumer, 1_101), {
    status: "REJECTED",
    reason: "ENVELOPE_ALREADY_CONSUMED",
  });
});

test("rejects expired and rejected envelopes before consumption", async () => {
  const consumer = new LiveExecutionConsumeOnce(new MemoryStorage());
  assert.deepEqual(await prepareLiveTransportRequest({ ...envelope, expiresAt: 1_000 }, consumer, 1_000), {
    status: "REJECTED",
    reason: "ENVELOPE_EXPIRED",
  });
  assert.deepEqual(await prepareLiveTransportRequest({ ...envelope, status: "REJECTED", blockers: ["RISK_REJECTED"] }, consumer, 1_100), {
    status: "REJECTED",
    reason: "ENVELOPE_REJECTED",
  });
});
