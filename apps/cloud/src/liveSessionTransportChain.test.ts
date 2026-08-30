import assert from "node:assert/strict";
import test from "node:test";
import { LiveExecutionConsumeOnce, type ConsumeOnceTransaction } from "./liveExecutionConsumeOnce";
import { prepareSessionBoundLiveTransport } from "./liveSessionTransportChain";
import type { LiveSessionBoundPreExecutionRequest } from "./liveSessionBoundPreExecution";

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

function request(overrides: Partial<LiveSessionBoundPreExecutionRequest> = {}): LiveSessionBoundPreExecutionRequest {
  return {
    ownerPrincipalId: "owner-1",
    policyOwnerPrincipalId: "owner-1",
    market: "BTC-USD",
    side: "BUY",
    requestedNotionalUsd: 100,
    totalEquityUsd: 1_000,
    riskApprovedNotionalUsd: 200,
    riskDecision: "ALLOW",
    tradingAllowed: true,
    overallHealth: "HEALTHY",
    marketTrusted: true,
    observedAt: 1_000,
    decidedAt: 1_000,
    now: 1_100,
    session: {
      state: "ACTIVE",
      sessionId: "session-1",
      ownerPrincipalId: "owner-1",
      investmentCapitalWeight: 0.25,
      killSwitchEngaged: false,
      activatedAtMs: 900,
      expiresAtMs: 2_000,
    },
    ...overrides,
  };
}

test("carries an active owner-bound session through consume-once transport preparation", async () => {
  const consumer = new LiveExecutionConsumeOnce(new MemoryStorage());
  const result = await prepareSessionBoundLiveTransport(request(), consumer);
  assert.equal(result.preExecutionStatus, "READY");
  assert.equal(result.transport.status, "READY");
  if (result.transport.status === "READY") {
    assert.equal(result.transport.request.ownerPrincipalId, "owner-1");
    assert.equal(result.transport.request.requestedNotionalUsd, 100);
  }
});

test("fails closed for an expired session before transport", async () => {
  const consumer = new LiveExecutionConsumeOnce(new MemoryStorage());
  const result = await prepareSessionBoundLiveTransport(request({
    session: { ...request().session, expiresAtMs: 1_100 },
  }), consumer);
  assert.equal(result.preExecutionStatus, "REJECTED");
  assert.deepEqual(result.transport, { status: "REJECTED", reason: "ENVELOPE_REJECTED" });
});

test("fails closed for an owner-mismatched session", async () => {
  const consumer = new LiveExecutionConsumeOnce(new MemoryStorage());
  const result = await prepareSessionBoundLiveTransport(request({
    session: { ...request().session, ownerPrincipalId: "other-owner" },
  }), consumer);
  assert.equal(result.preExecutionStatus, "REJECTED");
  assert.equal(result.transport.status, "REJECTED");
});

test("prevents transport replay for the same exact execution fingerprint", async () => {
  const consumer = new LiveExecutionConsumeOnce(new MemoryStorage());
  assert.equal((await prepareSessionBoundLiveTransport(request(), consumer)).transport.status, "READY");
  const replay = await prepareSessionBoundLiveTransport(request(), consumer);
  assert.deepEqual(replay.transport, { status: "REJECTED", reason: "ENVELOPE_ALREADY_CONSUMED" });
});
